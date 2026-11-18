//! Bounded, read-only ZIP input for the offline resource pack format.
use super::{DbError, ErrorKind, Result};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::{self, BufReader, Read, Seek, SeekFrom, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use zip::{CompressionMethod, ZipArchive};

pub(super) const MAX_ARCHIVE: u64 = 256 * 1024 * 1024;
pub(super) const MAX_TOTAL: u64 = 512 * 1024 * 1024;
pub(super) const MAX_MEMBER: u64 = 64 * 1024 * 1024;
pub(super) const MAX_MEMBERS: usize = 4096;
const MAX_RATIO: u64 = 250;

fn invalid(message: &str) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}

pub(super) fn file_error(error: io::Error) -> DbError {
    DbError::new(
        ErrorKind::FileAccess,
        format!("资源包文件操作失败。{}", error.kind()),
    )
}

fn zip_error(_: zip::result::ZipError) -> DbError {
    invalid("资源包 ZIP 结构无效或采用了不支持的特性。")
}

pub(super) fn safe_path(name: &str) -> bool {
    name.len() <= 160
        && name.split('/').count() <= 4
        && name.split('/').all(|component| {
            let stem = component
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            !component.starts_with('.')
                && !component.ends_with('.')
                && !component.is_empty()
                && component
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
                && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.as_bytes()[3].is_ascii_digit())
        })
}

type Reader = BufReader<File>;

pub(super) struct PackZip {
    archive: ZipArchive<Reader>,
    pub(super) files: BTreeMap<String, (usize, u64)>,
    pub(super) archive_bytes: u64,
    pub(super) digest: String,
}

impl PackZip {
    #[cfg(test)]
    pub(super) fn open(path: &Path) -> Result<Self> {
        Self::open_cancellable(path, &AtomicBool::new(false))
    }

    pub(super) fn open_cancellable(path: &Path, cancel: &AtomicBool) -> Result<Self> {
        check_cancel(cancel)?;
        let selected = File::open(path).map_err(file_error)?;
        let metadata = selected.metadata().map_err(file_error)?;
        if !metadata.is_file() || metadata.len() > MAX_ARCHIVE {
            return Err(invalid("资源包须为不超过 256 MiB 的普通文件。"));
        }
        // All inspection and decompression use a private immutable snapshot.
        let mut snapshot = tempfile::tempfile().map_err(file_error)?;
        let mut selected = BufReader::new(selected).take(MAX_ARCHIVE + 1);
        let mut digest = Sha256::new();
        let bytes = copy_bounded(
            &mut selected,
            &mut snapshot,
            MAX_ARCHIVE,
            &mut digest,
            cancel,
        )?;
        let mut reader = BufReader::new(snapshot);
        let expected = read_footer(&mut reader, bytes)?;
        let mut archive = ZipArchive::new(reader).map_err(zip_error)?;
        if archive.len() != expected || archive.has_duplicate_names() || archive.offset() != 0 {
            return Err(invalid("ZIP 成员重复或成员数量不一致。"));
        }
        let mut files = BTreeMap::new();
        let mut folded = BTreeSet::new();
        let mut declared = 0;
        for index in 0..archive.len() {
            check_cancel(cancel)?;
            let entry = archive.by_index_data(index).map_err(zip_error)?;
            let name = std::str::from_utf8(entry.name_raw())
                .map_err(|_| invalid("ZIP 文件路径必须使用 ASCII。"))?;
            if !safe_path(name)
                || entry.name().map_err(zip_error)?.as_ref() != name
                || entry.is_dir()
                || entry.is_symlink()
                || entry.external_attributes() & 0x410 != 0
                || entry
                    .unix_mode()
                    .is_some_and(|m| !matches!(m & 0o170000, 0 | 0o100000))
            {
                return Err(invalid("ZIP 文件路径不安全或文件类型不受支持。"));
            }
            if !folded.insert(name.to_ascii_lowercase()) {
                return Err(invalid("ZIP 文件路径在 Windows 上冲突。"));
            }
            if entry.encrypted()
                || !matches!(
                    entry.compression(),
                    CompressionMethod::Stored | CompressionMethod::Deflated
                )
            {
                return Err(invalid("ZIP 文件采用了不支持的加密或压缩方式。"));
            }
            let bytes = entry.size();
            declared += bytes.min(MAX_MEMBER + 1);
            if bytes > MAX_MEMBER || bytes > entry.compressed_size().saturating_mul(MAX_RATIO) {
                return Err(invalid("ZIP 单文件超过解压大小或压缩比上限。"));
            }
            if declared > MAX_TOTAL {
                return Err(invalid("ZIP 总解压大小超过上限。"));
            }
            files.insert(name.to_owned(), (index, bytes));
        }
        for name in &folded {
            if name
                .match_indices('/')
                .any(|(at, _)| folded.contains(&name[..at]))
            {
                return Err(invalid("ZIP 文件和目录路径冲突。"));
            }
        }
        archive.validate_header_consistency().map_err(zip_error)?;
        check_cancel(cancel)?;
        Ok(Self {
            archive,
            files,
            archive_bytes: bytes,
            digest: hex(digest),
        })
    }

    pub(super) fn copy(
        &mut self,
        path: &str,
        limit: u64,
        remaining: &mut u64,
        output: &mut impl Write,
        cancel: &AtomicBool,
    ) -> Result<(u64, String)> {
        let &(index, declared) = self
            .files
            .get(path)
            .ok_or_else(|| invalid("ZIP 缺少声明的文件。"))?;
        if declared > limit || declared > *remaining {
            return Err(invalid("ZIP 文件超过解压大小上限。"));
        }
        let mut entry = self.archive.by_index(index).map_err(zip_error)?;
        let mut digest = Sha256::new();
        let actual = copy_bounded(
            &mut entry,
            output,
            declared.min(limit).min(*remaining),
            &mut digest,
            cancel,
        )?;
        if actual != declared {
            return Err(invalid("ZIP 实际解压大小与声明不一致。"));
        }
        *remaining -= actual;
        Ok((actual, hex(digest)))
    }
}

fn hex(digest: Sha256) -> String {
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn copy_bounded(
    mut input: impl Read,
    mut output: impl Write,
    limit: u64,
    digest: &mut Sha256,
    cancel: &AtomicBool,
) -> Result<u64> {
    let mut buffer = [0; 32 * 1024];
    let mut total = 0;
    loop {
        check_cancel(cancel)?;
        let wanted = (limit - total + 1).min(buffer.len() as u64) as usize;
        let read = input
            .read(&mut buffer[..wanted])
            .map_err(|_| invalid("资源包读取或解压校验失败。"))?;
        if read == 0 {
            return Ok(total);
        }
        total += read as u64;
        if total > limit {
            return Err(invalid("资源包实际读取或解压字节超过上限。"));
        }
        digest.update(&buffer[..read]);
        output.write_all(&buffer[..read]).map_err(file_error)?;
    }
}

pub(super) fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Acquire) {
        Err(invalid("资源包校验已取消。"))
    } else {
        Ok(())
    }
}

// v1 uses single-volume ZIP32, with a terminal EOCD and no archive comment.
// Screen the directory count/size before asking the ZIP library to allocate.
fn read_footer(file: &mut Reader, bytes: u64) -> Result<usize> {
    let error = || invalid("ZIP 目录范围无效，或成员数量超过上限。");
    let end = bytes.checked_sub(22).ok_or_else(error)?;
    file.seek(SeekFrom::Start(end)).map_err(file_error)?;
    let mut footer = [0; 22];
    file.read_exact(&mut footer).map_err(file_error)?;
    let short = |i| u16::from_le_bytes([footer[i], footer[i + 1]]);
    let word = |i| u32::from_le_bytes(footer[i..i + 4].try_into().unwrap()) as u64;
    let count = short(10) as usize;
    let size = word(12);
    if &footer[..4] != b"PK\x05\x06"
        || short(4) != 0
        || short(6) != 0
        || short(20) != 0
        || short(8) != short(10)
        || !(1..=MAX_MEMBERS).contains(&count)
        || size > 4 * 1024 * 1024
        || word(16) + size != end
    {
        return Err(error());
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn sample(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let mut zip = ZipWriter::new(file.as_file_mut());
        for (name, bytes) in entries {
            zip.start_file(
                *name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        file
    }

    #[test]
    fn poc003_reads_real_zip_and_hashes_stream() {
        let file = sample(&[("manifest.json", b"{}"), ("data/questions.jsonl", b"{}\n")]);
        let mut pack = PackZip::open(file.path()).unwrap();
        let mut bytes = Vec::new();
        assert_eq!(
            pack.copy(
                "manifest.json",
                64,
                &mut 64,
                &mut bytes,
                &AtomicBool::new(false)
            )
            .unwrap(),
            (2, super::super::attachments::hash(b"{}"))
        );
        assert_eq!(bytes, b"{}");
    }

    #[test]
    fn poc003_refuses_nonportable_members() {
        for path in [
            "../escape",
            "/absolute",
            "C:/drive",
            "a\\b",
            "data/CON.json",
            "file.",
        ] {
            let file = sample(&[("manifest.json", b"{}"), (path, b"ignored")]);
            assert!(PackZip::open(file.path()).is_err(), "{path}");
        }
        for entries in [
            [("data/A", &b"a"[..]), ("data/a", &b"b"[..])],
            [("data", &b"a"[..]), ("data/file", &b"b"[..])],
        ] {
            assert!(PackZip::open(sample(&entries).path()).is_err());
        }
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let mut zip = ZipWriter::new(file.as_file_mut());
        zip.add_symlink("attachments/link", "../file", SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        assert!(PackZip::open(file.path()).is_err());
    }

    #[test]
    fn poc003_output_budget_checks_actual_read() {
        let mut output = Vec::new();
        let result = copy_bounded(
            &b"exceeds"[..],
            &mut output,
            1,
            &mut Sha256::new(),
            &AtomicBool::new(false),
        );
        assert!(result.unwrap_err().message.contains("实际"));
        assert!(output.is_empty());
    }

    #[test]
    fn poc003_refuses_high_ratio_before_decompressing() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let mut zip = ZipWriter::new(file.as_file_mut());
        zip.start_file(
            "data/zeros",
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(&vec![0; 1024 * 1024]).unwrap();
        zip.finish().unwrap();
        assert!(PackZip::open(file.path())
            .err()
            .unwrap()
            .message
            .contains("压缩比"));
    }

    #[test]
    fn poc003_crash_worker() {
        let Some(root) = std::env::var_os("KNOWPAPER_POC003_WORKER") else {
            return;
        };
        let root = std::path::PathBuf::from(root);
        let pack_file = sample(&[("attachments/demo.png", b"original fixture bytes")]);
        let mut zip = PackZip::open(pack_file.path()).unwrap();
        let mut db = rusqlite::Connection::open(root.join("test.sqlite3")).unwrap();
        db.execute_batch(
            "CREATE TABLE operation (id INTEGER PRIMARY KEY, status TEXT);
            CREATE TABLE resource (id INTEGER PRIMARY KEY, digest TEXT);
            INSERT INTO operation VALUES (1, 'staged');",
        )
        .unwrap();
        let mut staged = File::create(root.join("stage")).unwrap();
        let (_, hash) = zip
            .copy(
                "attachments/demo.png",
                256,
                &mut 256,
                &mut staged,
                &AtomicBool::new(false),
            )
            .unwrap();
        staged.sync_all().unwrap();
        drop(staged);
        let tx = db.transaction().unwrap();
        std::fs::hard_link(root.join("stage"), root.join("blob")).unwrap();
        tx.execute("INSERT INTO resource VALUES (1, ?1)", [&hash])
            .unwrap();
        tx.execute("UPDATE operation SET status='installed' WHERE id=1", [])
            .unwrap();
        if root.join("commit").is_file() {
            tx.commit().unwrap();
        }
        std::fs::write(root.join("ready"), hash).unwrap();
        loop {
            std::thread::park();
        }
    }

    #[test]
    fn poc003_kills_child_before_and_after_commit() {
        for committed in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path();
            if committed {
                std::fs::write(root.join("commit"), []).unwrap();
            }
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "db::pack_zip::tests::poc003_crash_worker"])
                .env("KNOWPAPER_POC003_WORKER", root)
                .spawn()
                .unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while !root.join("ready").is_file() && std::time::Instant::now() < deadline {
                if child.try_wait().unwrap().is_some() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            let killed = child.kill();
            assert!(!child.wait().unwrap().success());
            killed.unwrap();
            let db = rusqlite::Connection::open(root.join("test.sqlite3")).unwrap();
            let count: i32 = db
                .query_row("SELECT count(*) FROM resource", [], |r| r.get(0))
                .unwrap();
            let status: String = db
                .query_row("SELECT status FROM operation", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, i32::from(committed));
            assert_eq!(status, if committed { "installed" } else { "staged" });
            let expected = std::fs::read_to_string(root.join("ready")).unwrap();
            assert_eq!(
                super::super::attachments::hash(&std::fs::read(root.join("blob")).unwrap()),
                expected
            );
            std::fs::remove_file(root.join("stage")).unwrap();
            if !committed {
                std::fs::remove_file(root.join("blob")).unwrap();
                db.execute("UPDATE operation SET status='interrupted' WHERE id=1", [])
                    .unwrap();
            }
            assert_eq!(root.join("blob").exists(), committed);
            println!("POC003 child pid={} killed, committed={committed}, status={status}, visible={count}, sha256={expected}", child.id());
        }
    }
}
