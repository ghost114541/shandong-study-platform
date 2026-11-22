use super::{Attachment, Database, DbError, ErrorKind, Result, RevisionContent};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use image::{AnimationDecoder, ImageDecoder, ImageFormat, ImageReader};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    io::{self, Cursor, Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_DIMENSION: u32 = 4096;

pub(super) struct AttachmentStore {
    data_directory: PathBuf,
}

#[derive(Serialize)]
pub struct AttachmentIntegrity {
    attachment: Attachment,
    revision_count: i64,
    error: Option<DbError>,
}

impl AttachmentStore {
    pub(super) fn for_database(path: &Path) -> Self {
        Self {
            data_directory: path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new("."))
                .to_owned(),
        }
    }

    fn shard(&self, hash: &str, create: bool) -> io::Result<Dir> {
        self.resource_shard("attachments", hash, create)
    }

    pub(super) fn resource_shard(&self, folder: &str, hash: &str, create: bool) -> io::Result<Dir> {
        let data = self.data_dir()?;
        let child = |parent: &Dir, name: &str| -> io::Result<Dir> {
            if create {
                match parent.create_dir(name) {
                    Ok(()) => {
                        #[cfg(unix)]
                        sync_directory(parent)?;
                    }
                    Err(err) if err.kind() == io::ErrorKind::AlreadyExists => (),
                    Err(err) => return Err(err),
                }
            }
            parent.open_dir_nofollow(name)
        };
        child(&child(&data, folder)?, &hash[..2])
    }

    pub(super) fn base_path(&self) -> &Path {
        &self.data_directory
    }

    pub(super) fn data_dir(&self) -> io::Result<Dir> {
        match (
            self.data_directory.parent(),
            self.data_directory.file_name(),
        ) {
            (Some(parent), Some(name)) => {
                let parent = if parent.as_os_str().is_empty() {
                    Path::new(".")
                } else {
                    parent
                };
                Dir::open_ambient_dir(parent, ambient_authority())?.open_dir_nofollow(name)
            }
            _ => Dir::open_ambient_dir(&self.data_directory, ambient_authority()),
        }
    }

    fn install(&self, item: &Attachment, bytes: &[u8]) -> Result<()> {
        let dir = self
            .shard(&item.sha256, true)
            .map_err(|err| io_error(&item.id, err))?;
        let temporary = format!(".{}.tmp", item.sha256);
        // The SQLite writer lock serializes retries for this store. A crash can
        // leave this reserved name behind. Removing it never touches a final file.
        match dir.remove_file(&temporary) {
            Ok(()) => (),
            Err(err) if err.kind() == io::ErrorKind::NotFound => (),
            Err(err) => return Err(io_error(&item.id, err)),
        }
        match read_blob(&dir, &item.sha256) {
            Ok(existing) if existing == bytes => {
                #[cfg(unix)]
                sync_directory(&dir).map_err(|err| io_error(&item.id, err))?;
                return Ok(());
            }
            Ok(_) => (),
            Err(err) if err.kind() == io::ErrorKind::NotFound => (),
            Err(err) => return Err(io_error(&item.id, err)),
        }
        let write = || -> io::Result<()> {
            let mut file =
                dir.open_with(&temporary, OpenOptions::new().create_new(true).write(true))?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            dir.rename(&temporary, &dir, &item.sha256)?;
            #[cfg(unix)]
            sync_directory(&dir)?;
            Ok(())
        };
        write().map_err(|err| {
            let _ = dir.remove_file(&temporary);
            io_error(&item.id, err)
        })
    }

    fn verified(&self, item: &Attachment) -> Result<Vec<u8>> {
        let bytes = self
            .shard(&item.sha256, false)
            .and_then(|dir| read_blob(&dir, &item.sha256))
            .map_err(|err| io_error(&item.id, err))?;
        if bytes.len() as u64 != item.byte_size || hash(&bytes) != item.sha256 {
            return Err(DbError::new(
                ErrorKind::AttachmentHashMismatch,
                format!("附件 {} 的大小或 SHA-256 不匹配。", item.id),
            ));
        }
        validate_image(&bytes, Some(&item.media_type))?;
        Ok(bytes)
    }

    pub(super) fn verify_declaration(&self, db: &Connection, declared: &Attachment) -> Result<()> {
        let item = registered(db, &declared.id)?;
        if &item != declared {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                format!("附件 {} 的声明与登记不一致。", declared.id),
            ));
        }
        self.verified(&item)?;
        Ok(())
    }
}

#[cfg(unix)]
pub(super) fn sync_directory(dir: &Dir) -> io::Result<()> {
    // Some operating systems open the capability itself with O_PATH.
    use cap_fs_ext::OpenOptionsMaybeDirExt;
    dir.open_with(".", OpenOptions::new().read(true).maybe_dir(true))?
        .sync_all()
}

fn read_blob(dir: &Dir, name: &str) -> io::Result<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    cap_fs_ext::OpenOptionsSyncExt::nonblock(&mut options, true);
    let file = dir.open_with(name, &options)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected a regular attachment file",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn io_error(id: &str, err: io::Error) -> DbError {
    if err.kind() == io::ErrorKind::NotFound {
        DbError::new(
            ErrorKind::AttachmentMissing,
            format!("附件 {id} 的文件缺失。"),
        )
    } else {
        DbError::new(
            ErrorKind::FileAccess,
            format!("无法安全访问附件 {id} 的文件（{err}）。"),
        )
    }
}

pub(super) fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn valid_id(id: &str) -> bool {
    // Older revisions can declare IDs that have no registered file.
    (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub(super) fn registered(db: &Connection, id: &str) -> Result<Attachment> {
    if !valid_id(id) {
        return Err(DbError::new(
            ErrorKind::AttachmentInvalidId,
            "附件 ID 无效。",
        ));
    }
    db.query_row(
        "SELECT media_type, byte_size, sha256 FROM attachment WHERE attachment_id = ?1",
        [id],
        |row| {
            Ok(Attachment {
                id: id.to_owned(),
                media_type: row.get(0)?,
                byte_size: u64::from(row.get::<_, u32>(1)?),
                sha256: row.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| {
        DbError::new(
            ErrorKind::AttachmentUnregistered,
            format!("附件 {id} 未登记。"),
        )
    })
}

pub(super) fn validate_image(bytes: &[u8], claimed: Option<&str>) -> Result<&'static str> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(DbError::new(
            ErrorKind::AttachmentTooLarge,
            "图片超过 5 MiB。",
        ));
    }
    let unsupported = || {
        DbError::new(
            ErrorKind::AttachmentUnsupportedFormat,
            "图片格式不支持。请选择 PNG、JPEG、WebP 或 GIF。",
        )
    };
    let format = image::guess_format(bytes).map_err(|_| unsupported())?;
    let media_type = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        ImageFormat::Gif => "image/gif",
        _ => return Err(unsupported()),
    };
    if let Some(claimed) = claimed {
        if !claimed.is_empty() && claimed != "application/octet-stream" && claimed != media_type {
            return Err(DbError::new(
                ErrorKind::AttachmentUnsupportedFormat,
                "图片声明的媒体类型与实际文件格式不一致。",
            ));
        }
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(128 * 1024 * 1024);
    decode_image(bytes, format, limits).map_err(|err| {
        DbError::new(
            ErrorKind::AttachmentDecode,
            format!("图片无法解码（最大尺寸为 {MAX_DIMENSION} × {MAX_DIMENSION}）：{err}"),
        )
    })?;
    Ok(media_type)
}

fn decode_image(
    bytes: &[u8],
    format: ImageFormat,
    limits: image::Limits,
) -> image::ImageResult<()> {
    use image::codecs::{gif::GifDecoder, png::PngDecoder, webp::WebPDecoder};
    let source = Cursor::new(bytes);
    match format {
        ImageFormat::Gif => {
            let mut decoder = GifDecoder::new(source)?;
            decoder.set_limits(limits)?;
            return verify_frames(decoder.into_frames());
        }
        ImageFormat::WebP => {
            let decoder = WebPDecoder::new(source)?;
            let (width, height) = decoder.dimensions();
            limits.check_dimensions(width, height)?;
            if decoder.has_animation() {
                return verify_frames(decoder.into_frames());
            }
            return image::DynamicImage::from_decoder(decoder).map(|_| ());
        }
        ImageFormat::Png => {
            let decoder = PngDecoder::with_limits(source, limits)?;
            if decoder.is_apng()? {
                return verify_frames(decoder.apng()?.into_frames());
            }
            return image::DynamicImage::from_decoder(decoder).map(|_| ());
        }
        _ => (),
    }
    let mut reader = ImageReader::with_format(source, format);
    reader.limits(limits);
    reader.decode().map(|_| ())
}

fn verify_frames(frames: image::Frames<'_>) -> image::ImageResult<()> {
    use image::error::{LimitError, LimitErrorKind};
    let mut total_pixels = 0;
    for (index, frame) in frames.enumerate() {
        let frame = frame?.into_buffer();
        total_pixels += u64::from(frame.width()) * u64::from(frame.height());
        if index >= 512 || total_pixels > 64 * 1024 * 1024 {
            return Err(image::ImageError::Limits(LimitError::from_kind(
                LimitErrorKind::InsufficientMemory,
            )));
        }
    }
    if total_pixels == 0 {
        return Err(image::ImageError::Limits(LimitError::from_kind(
            LimitErrorKind::DimensionError,
        )));
    }
    Ok(())
}

fn picture_ids<'a>(documents: impl IntoIterator<Item = &'a Value>) -> BTreeSet<&'a str> {
    documents
        .into_iter()
        .flat_map(|doc| doc["content"].as_array().into_iter().flatten())
        .filter(|node| node["type"] == "image")
        .filter_map(|node| node["attrs"]["src"].as_str()?.strip_prefix("attachment:"))
        .collect()
}

impl Database {
    pub fn import_attachment(&mut self, bytes: &[u8], claimed: Option<&str>) -> Result<Attachment> {
        let media_type = validate_image(bytes, claimed)?;
        let sha256 = hash(bytes);
        let item = Attachment {
            id: format!("sha256-{sha256}"),
            byte_size: bytes.len() as u64,
            media_type: media_type.into(),
            sha256,
        };
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        self.attachment_store.install(&item, bytes)?;
        let key = format!("{}/{}", &item.sha256[..2], item.sha256);
        tx.execute(
            "INSERT INTO attachment(attachment_id, sha256, media_type, byte_size, storage_key)
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(attachment_id) DO NOTHING",
            params![
                item.id,
                item.sha256,
                item.media_type,
                item.byte_size as i64,
                key
            ],
        )?;
        if registered(&tx, &item.id)? != item {
            return Err(DbError::new(
                ErrorKind::Integrity,
                "现有附件登记与导入文件不一致。",
            ));
        }
        tx.commit()?;
        Ok(item)
    }

    pub fn read_attachment(
        &self,
        id: &str,
        expected: Option<&Attachment>,
    ) -> Result<(Attachment, Vec<u8>)> {
        let item = registered(&self.connection, id)?;
        if expected.is_some_and(|declared| declared != &item) {
            return Err(DbError::new(
                ErrorKind::InvalidContent,
                format!("附件 {id} 的声明与登记不一致。"),
            ));
        }
        let bytes = self.attachment_store.verified(&item)?;
        Ok((item, bytes))
    }

    pub fn check_attachment(&self, id: &str) -> Result<AttachmentIntegrity> {
        let attachment = registered(&self.connection, id)?;
        let error = self.attachment_store.verified(&attachment).err();
        let revision_count = self.connection.query_row(
            "SELECT count(*) FROM revision_attachment WHERE attachment_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        Ok(AttachmentIntegrity {
            attachment,
            revision_count,
            error,
        })
    }

    pub fn verify_print_attachments(&self, content: &RevisionContent, answers: bool) -> Result<()> {
        let ids = if answers {
            picture_ids(
                content
                    .answer
                    .iter()
                    .chain(content.analysis.iter())
                    .chain(content.parts.iter().flat_map(|part| part.answer.iter().chain(part.analysis.iter()))),
            )
        } else {
            picture_ids(
                std::iter::once(&content.stem).chain(content.parts.iter().map(|part| &part.prompt)),
            )
        };
        for item in &content.attachments {
            if ids.contains(item.id.as_str()) {
                self.attachment_store
                    .verify_declaration(&self.connection, item)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::db::{Scope, DATABASE_FILENAME};
    use serde_json::json;
    use std::fs;

    pub(crate) fn fixture(format: ImageFormat) -> Vec<u8> {
        let sample =
            image::RgbImage::from_fn(32, 24, |x, y| image::Rgb([x as u8 * 4, y as u8 * 5, 170]));
        let mut output = Cursor::new(Vec::new());
        sample.write_to(&mut output, format).unwrap();
        output.into_inner()
    }

    fn setup() -> (tempfile::TempDir, Database) {
        let directory = tempfile::tempdir().unwrap();
        let db = Database::open(&directory.path().join(DATABASE_FILENAME)).unwrap();
        (directory, db)
    }

    fn location(directory: &Path, sha256: &str) -> PathBuf {
        directory
            .join("attachments")
            .join(&sha256[..2])
            .join(sha256)
    }

    #[test]
    fn dev005_t03_t04_imports_four_formats_and_reuses_physical_files() {
        let (directory, mut db) = setup();
        for (format, mime) in [
            (ImageFormat::Png, "image/png"),
            (ImageFormat::Jpeg, "image/jpeg"),
            (ImageFormat::WebP, "image/webp"),
            (ImageFormat::Gif, "image/gif"),
        ] {
            let bytes = fixture(format);
            let item = db.import_attachment(&bytes, Some(mime)).unwrap();
            assert_eq!(item, db.import_attachment(&bytes, None).unwrap());
            assert_eq!(item.sha256, hash(&bytes));
            assert_eq!(item.media_type, mime);
            assert_eq!(item.byte_size, bytes.len() as u64);
            let file = location(directory.path(), &item.sha256);
            assert_eq!(fs::read(&file).unwrap(), bytes);
            assert_eq!(db.read_attachment(&item.id, None).unwrap(), (item, bytes));
        }
        let count = fs::read_dir(directory.path().join("attachments"))
            .unwrap()
            .map(|shard| fs::read_dir(shard.unwrap().path()).unwrap().count())
            .sum::<usize>();
        assert_eq!(count, 4);
        assert_eq!(
            db.connection
                .query_row("SELECT count(*) FROM attachment", [], |r| r
                    .get::<_, u32>(0))
                .unwrap(),
            4
        );
    }

    #[test]
    fn dev005_t03_animated_gif_is_decoded_beyond_the_first_frame() {
        let (_directory, mut db) = setup();
        let mut bytes = Vec::new();
        let frame =
            |color| image::Frame::new(image::RgbaImage::from_pixel(16, 16, image::Rgba(color)));
        image::codecs::gif::GifEncoder::new(&mut bytes)
            .encode_frames([frame([255, 0, 0, 255]), frame([0, 255, 0, 255])])
            .unwrap();
        db.import_attachment(&bytes, Some("image/gif")).unwrap();
        let truncated = &bytes[..bytes.len() - 8];
        assert_eq!(
            db.import_attachment(truncated, None).unwrap_err().kind,
            ErrorKind::AttachmentDecode
        );
    }

    #[test]
    fn dev005_t05_invalid_formats_sizes_ids_permissions_and_path_escape() {
        let (directory, mut db) = setup();
        let bytes = fixture(ImageFormat::Png);
        assert_eq!(
            db.import_attachment(b"not an image", None)
                .unwrap_err()
                .kind,
            ErrorKind::AttachmentUnsupportedFormat
        );
        assert_eq!(
            db.import_attachment(&bytes[..12], None).unwrap_err().kind,
            ErrorKind::AttachmentDecode
        );
        assert_eq!(
            db.import_attachment(&bytes, Some("image/jpeg"))
                .unwrap_err()
                .kind,
            ErrorKind::AttachmentUnsupportedFormat
        );
        assert_eq!(
            db.import_attachment(&vec![0; MAX_IMAGE_BYTES + 1], None)
                .unwrap_err()
                .kind,
            ErrorKind::AttachmentTooLarge
        );
        for id in ["", "..", "../file", r"C:\file", "abc/def", "x:stream"] {
            assert_eq!(
                db.read_attachment(id, None).unwrap_err().kind,
                ErrorKind::AttachmentInvalidId
            );
        }
        assert_eq!(
            db.read_attachment("legacy", None).unwrap_err().kind,
            ErrorKind::AttachmentUnregistered
        );
        let item = db.import_attachment(&bytes, None).unwrap();
        let path = location(directory.path(), &item.sha256);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            let _locked = fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(&path)
                .unwrap();
            assert_eq!(
                db.read_attachment(&item.id, None).unwrap_err().kind,
                ErrorKind::FileAccess
            );
        }
        let shard = path.parent().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::rename(shard, outside.path().join("old-shard")).unwrap();
        fs::write(outside.path().join(&item.sha256), b"outside").unwrap();
        #[cfg(windows)]
        {
            let exit = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command",
                    "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:KP_TEST_LINK -Target $env:KP_TEST_OUTSIDE | Out-Null"])
                .env("KP_TEST_LINK", shard).env("KP_TEST_OUTSIDE", outside.path())
                .status().unwrap();
            assert!(exit.success());
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), shard).unwrap();
        assert!(db.read_attachment(&item.id, None).is_err());
        assert!(db.import_attachment(&bytes, None).is_err());
        assert_eq!(
            fs::read(outside.path().join(&item.sha256)).unwrap(),
            b"outside"
        );
        #[cfg(windows)]
        fs::remove_dir(shard).unwrap();
        #[cfg(unix)]
        fs::remove_file(shard).unwrap();
    }

    #[test]
    fn dev005_t06_registration_failure_and_interrupted_stage_are_retryable() {
        let (directory, mut db) = setup();
        let bytes = fixture(ImageFormat::Png);
        let digest = hash(&bytes);
        let path = location(directory.path(), &digest);
        let stage = path.with_file_name(format!(".{digest}.tmp"));
        fs::create_dir_all(&stage).unwrap();
        assert_eq!(
            db.import_attachment(&bytes, None).unwrap_err().kind,
            ErrorKind::FileAccess
        );
        assert!(!path.exists());
        let id = format!("sha256-{digest}");
        assert_eq!(
            db.read_attachment(&id, None).unwrap_err().kind,
            ErrorKind::AttachmentUnregistered
        );
        fs::remove_dir(&stage).unwrap();
        fs::write(&stage, &bytes[..12]).unwrap();
        db.connection
            .execute_batch(
                "CREATE TRIGGER simulate_failed_registration BEFORE INSERT ON attachment
             BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
            )
            .unwrap();
        drop(db);
        let mut db = Database::open(&directory.path().join(DATABASE_FILENAME)).unwrap();
        assert_eq!(
            db.import_attachment(&bytes, None).unwrap_err().kind,
            ErrorKind::Constraint
        );
        assert_eq!(
            db.read_attachment(&id, None).unwrap_err().kind,
            ErrorKind::AttachmentUnregistered
        );
        assert!(!stage.exists());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        db.connection
            .execute_batch("DROP TRIGGER simulate_failed_registration")
            .unwrap();
        assert_eq!(db.import_attachment(&bytes, None).unwrap().id, id);
        assert_eq!(db.read_attachment(&id, None).unwrap().1, bytes);
    }

    #[test]
    fn dev005_t08_t10_fixed_revisions_and_missing_or_corrupt_files() {
        let (directory, mut db) = setup();
        let bytes = fixture(ImageFormat::Png);
        let item = db.import_attachment(&bytes, None).unwrap();
        let content = RevisionContent::from_json(&json!({
            "schema_version":1,"question_type":"解答题","score":0,"parts":[],
            "stem":{"type":"doc","content":[{"type":"image","attrs":{
                "src":format!("attachment:{}", item.id),"alt":"配图","title":"标题","width":32,"height":24
            }}]},"attachments":[item]
        }).to_string()).unwrap();
        let mut mismatched = content.clone();
        mismatched.attachments[0].byte_size += 1;
        assert_eq!(
            db.create_question_with_revision("rejected", "math", &mismatched)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidContent
        );
        let a = db
            .create_question_with_revision("q", "math", &content)
            .unwrap();
        let second = db
            .create_question_with_revision("other", "math", &content)
            .unwrap();
        assert_ne!(a, second);
        db.save_composition("paper", "历史题卷", &[a]).unwrap();
        let blank = RevisionContent::from_json(
            r#"{
            "schema_version":1,"question_type":"解答题","score":0,"parts":[],
            "stem":{"type":"doc","content":[{"type":"paragraph"}]}
        }"#,
        )
        .unwrap();
        let b = db.append_user_revision("q", Some(a), &blank).unwrap();
        db.append_revision("q", Scope::Public, None, &blank)
            .unwrap();
        drop(db);

        let mut db = Database::open(&directory.path().join(DATABASE_FILENAME)).unwrap();
        assert_eq!(db.current_revision("q").unwrap().unwrap().id, b);
        assert_eq!(
            db.load_composition("paper").unwrap().items[0]
                .revision
                .content,
            content
        );
        assert_eq!(db.check_attachment(&item.id).unwrap().revision_count, 2);
        let path = location(directory.path(), &item.sha256);
        fs::remove_file(&path).unwrap();
        let check = db.check_attachment(&item.id).unwrap();
        assert_eq!(check.revision_count, 2);
        assert_eq!(check.error.unwrap().kind, ErrorKind::AttachmentMissing);
        assert_eq!(
            db.read_attachment(&item.id, None).unwrap_err().kind,
            ErrorKind::AttachmentMissing
        );
        fs::write(&path, vec![0; bytes.len()]).unwrap();
        assert_eq!(
            db.verify_print_attachments(&content, false)
                .unwrap_err()
                .kind,
            ErrorKind::AttachmentHashMismatch
        );
        assert_eq!(db.import_attachment(&bytes, None).unwrap(), item);
        assert_eq!(db.read_attachment(&item.id, None).unwrap().1, bytes);
        db.integrity_check().unwrap();
    }
}
