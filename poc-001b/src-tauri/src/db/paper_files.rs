use super::{attachments::hash, metadata::label, Database, DbError, ErrorKind, Result};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    io::{self, Read, Write},
    path::{Component, Path},
};

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_PAGES: usize = 500;
const FOLDER: &str = "paper-pdfs";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportPaper {
    pub paper_id: Option<String>,
    pub title: String,
    pub subject_id: String,
    pub year: Option<i32>,
    pub region: Option<String>,
    pub source: Option<String>,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct PaperFile {
    pub id: String,
    pub paper_id: String,
    pub role: String,
    pub sha256: String,
    pub byte_size: u32,
    pub page_count: u32,
    pub original_name: String,
    pub source: Option<String>,
    pub imported_at: String,
}

#[derive(Serialize)]
pub struct PaperRecord {
    pub id: String,
    pub title: String,
    pub subject_id: Option<String>,
    pub year: Option<i32>,
    pub region: Option<String>,
    pub source: Option<String>,
    pub files: Vec<PaperFile>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PdfRegion {
    pub page_index: u32,
    pub rect: [f64; 4],
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegionLink {
    pub file_id: String,
    pub source_key: String,
    pub regions: Vec<PdfRegion>,
}

#[derive(Debug, Serialize)]
pub struct Location {
    pub paper_id: String,
    pub title: String,
    pub file_id: String,
    pub source_key: String,
    pub question_id: String,
    pub ordinal: u32,
    #[serde(flatten)]
    pub region: PdfRegion,
}

const FILE_COLUMNS: &str =
    "id, paper_id, role, sha256, byte_size, page_count, original_name, source, imported_at";

fn file_row(row: &Row<'_>) -> rusqlite::Result<PaperFile> {
    Ok(PaperFile {
        id: row.get(0)?,
        paper_id: row.get(1)?,
        role: row.get(2)?,
        sha256: row.get(3)?,
        byte_size: row.get(4)?,
        page_count: row.get(5)?,
        original_name: row.get(6)?,
        source: row.get(7)?,
        imported_at: row.get(8)?,
    })
}

fn invalid(message: impl Into<String>) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}

fn access(error: io::Error) -> DbError {
    DbError::new(
        ErrorKind::FileAccess,
        format!("无法安全访问 PDF 文件。{error}"),
    )
}

fn registered(db: &Connection, id: &str) -> Result<PaperFile> {
    db.query_row(
        &format!("SELECT {FILE_COLUMNS} FROM paper_file WHERE id = ?1"),
        [id],
        file_row,
    )
    .optional()?
    .ok_or_else(|| invalid("该 PDF 版本未登记。"))
}

pub(super) fn open_regular(dir: &Dir, name: &Path) -> io::Result<cap_std::fs::File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    cap_fs_ext::OpenOptionsSyncExt::nonblock(&mut options, true);
    let file = dir.open_with(name, &options)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected a regular file",
        ));
    }
    Ok(file)
}

fn read_bounded(file: impl Read) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(access)?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid("PDF 最大允许 64 MiB。"));
    }
    Ok(bytes)
}

fn read_selected(path: &Path) -> Result<Vec<u8>> {
    // Walk from the local volume root using directory handles so a selected path
    // cannot traverse reparse points or symlinks on the way to the file.
    let mut root = std::path::PathBuf::new();
    let mut components = path.components().peekable();
    #[cfg(windows)]
    match components.next() {
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_)) => {
            root.push(prefix.as_os_str());
        }
        _ => return Err(invalid("请选择本地磁盘上的 PDF。")),
    }
    if components.next() != Some(Component::RootDir) {
        return Err(invalid("PDF 须由本地文件选择器选取。"));
    }
    root.push(std::path::MAIN_SEPARATOR_STR);
    let mut dir = Dir::open_ambient_dir(root, ambient_authority()).map_err(access)?;
    while let Some(Component::Normal(name)) = components.next() {
        if components.peek().is_none() {
            return read_bounded(open_regular(&dir, Path::new(name)).map_err(access)?);
        }
        dir = dir.open_dir_nofollow(name).map_err(access)?;
    }
    Err(invalid("PDF 路径无效。"))
}

fn page_count(bytes: &[u8]) -> Result<usize> {
    validated_pdf_pages(bytes, false)
}

pub(super) fn pack_pdf_pages(bytes: &[u8]) -> Result<usize> {
    validated_pdf_pages(bytes, true)
}

fn validated_pdf_pages(bytes: &[u8], passive_only: bool) -> Result<usize> {
    if !bytes.starts_with(b"%PDF-")
        || !bytes
            .iter()
            .rev()
            .skip_while(|b| b.is_ascii_whitespace())
            .take(5)
            .copied()
            .eq(b"%%EOF".iter().rev().copied())
    {
        return Err(invalid("文件缺少有效的 PDF 文件头或结束标记。"));
    }
    let pdf = lopdf::Document::load_mem_with_options(
        bytes,
        lopdf::LoadOptions {
            strict: true,
            max_decompressed_size: Some(16 * 1024 * 1024),
            ..Default::default()
        },
    )
    .map_err(|error| match error {
        lopdf::Error::Decryption(_) => invalid("暂不支持加密或密码保护的 PDF。"),
        _ => invalid(format!("无法解析 PDF 结构。{error}")),
    })?;
    if pdf.is_encrypted() || pdf.trailer.has(b"Encrypt") {
        return Err(invalid("暂不支持加密或密码保护的 PDF。"));
    }
    if passive_only && pdf.objects.values().any(pdf_active_object) {
        return Err(invalid("资源包 PDF 不支持脚本、表单、动作或嵌入文件。"));
    }
    let count = pdf.page_iter().take(MAX_PAGES + 1).count();
    if !(1..=MAX_PAGES).contains(&count) {
        return Err(invalid("PDF 必须包含 1–500 页可读取的页面。"));
    }
    Ok(count)
}

fn pdf_active_object(value: &lopdf::Object) -> bool {
    use lopdf::Object;
    fn active_dict(dict: &lopdf::Dictionary) -> bool {
        dict.iter().any(|(key, value)| matches!(key.as_slice(),
            b"OpenAction" | b"AA" | b"A" | b"JS" | b"JavaScript" | b"XFA" |
            b"AcroForm" | b"EmbeddedFiles" | b"EF" | b"RichMediaContent")
            || pdf_active_object(value))
    }
    match value {
        Object::Dictionary(dict) => active_dict(dict),
        Object::Stream(stream) => active_dict(&stream.dict),
        Object::Array(items) => items.iter().any(pdf_active_object),
        Object::Name(name) => matches!(name.as_slice(), b"JavaScript" | b"Launch" |
            b"RichMedia" | b"EmbeddedFile" | b"FileAttachment" | b"GoToR" | b"SubmitForm"),
        _ => false,
    }
}

impl Database {
    pub fn import_paper_pdf(&mut self, path: &Path, input: &ImportPaper) -> Result<PaperFile> {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.chars().any(char::is_control))
            .ok_or_else(|| invalid("PDF 原始文件名无效。"))?;
        self.import_pdf_bytes(name, &read_selected(path)?, input)
    }

    fn import_pdf_bytes(
        &mut self,
        name: &str,
        bytes: &[u8],
        input: &ImportPaper,
    ) -> Result<PaperFile> {
        if bytes.len() > MAX_BYTES {
            return Err(invalid("PDF 最大允许 64 MiB。"));
        }
        if !matches!(input.role.as_str(), "original" | "answer" | "analysis") {
            return Err(invalid("无效的 PDF 文件角色。"));
        }
        let pages = page_count(bytes)?;
        let digest = hash(bytes);
        let store = &self.attachment_store;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let new_id = || -> Result<String> {
            Ok(tx.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?)
        };
        let paper = match &input.paper_id {
            Some(id) => {
                let exists = tx
                    .query_row("SELECT 1 FROM paper WHERE id = ?1", [id], |_| Ok(()))
                    .optional()?
                    .is_some();
                if !exists {
                    return Err(invalid("选中的试卷已不存在。"));
                }
                id.clone()
            }
            None => {
                let id = new_id()?;
                let title = if input.title.trim().is_empty() {
                    Path::new(name)
                        .file_stem()
                        .and_then(|part| part.to_str())
                        .unwrap_or(name)
                } else {
                    &input.title
                };
                let region = optional_label(input.region.as_deref())?;
                let source = optional_label(input.source.as_deref())?;
                if input.year.is_some_and(|year| !(1..=9999).contains(&year)) {
                    return Err(invalid("年份须为 1–9999 或未标注。"));
                }
                tx.execute(
                    "INSERT INTO paper(id, title, subject_id) VALUES (?1, ?2, ?3)",
                    params![id, label(title)?, input.subject_id],
                )?;
                tx.execute(
                    "INSERT INTO paper_user_metadata(paper_id, year, region, source)
                            VALUES (?1, ?2, ?3, ?4)",
                    params![id, input.year, region, source],
                )?;
                id
            }
        };
        let existing = tx
            .query_row(
                "SELECT id FROM paper_file WHERE paper_id = ?1 AND role = ?2 AND sha256 = ?3",
                params![paper, input.role, digest],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let id = if let Some(id) = existing {
            id
        } else {
            let id = new_id()?;
            tx.execute(
                "INSERT INTO paper_file
                (id, paper_id, role, sha256, byte_size, page_count, original_name, source)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    paper,
                    input.role,
                    digest,
                    bytes.len() as u32,
                    pages as u32,
                    name,
                    optional_label(input.source.as_deref())?
                ],
            )?;
            id
        };
        let file = registered(&tx, &id)?;
        let dir = store
            .resource_shard(FOLDER, &digest, true)
            .map_err(access)?;
        let installed = install(&dir, &digest, bytes).map_err(access)?;
        if let Err(error) = tx.commit() {
            // A complete unreferenced blob is safe if another process needs it or
            // a previous version already references it. A retry reuses it by hash.
            if installed {
                eprintln!("PDF installation needs database reconciliation for hash {digest}");
            }
            return Err(error.into());
        }
        Ok(file)
    }

    pub fn paper_records(&self) -> Result<Vec<PaperRecord>> {
        self.query_paper_records(None)
    }

    pub fn paper_record_for_file(&self, id: &str) -> Result<Option<PaperRecord>> {
        Ok(self.query_paper_records(Some(id))?.pop())
    }

    fn query_paper_records(&self, file: Option<&str>) -> Result<Vec<PaperRecord>> {
        let sql = if file.is_some() {
            "SELECT id,title,subject_id,year,region,source FROM effective_paper
              WHERE id=(SELECT paper_id FROM paper_file WHERE id=?1)"
        } else {
            "SELECT id,title,subject_id,year,region,source FROM visible_paper ORDER BY title,id"
        };
        let mut statement = self.connection.prepare(sql)?;
        let mut files = self.connection.prepare(&format!(
            "SELECT {FILE_COLUMNS} FROM paper_file WHERE paper_id = ?1 ORDER BY imported_at DESC, rowid DESC"
        ))?;
        let mut records = Vec::new();
        let mut rows = match file {
            Some(id) => statement.query([id])?,
            None => statement.query([])?,
        };
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let paper_files = files
                .query_map([&id], file_row)?
                .collect::<rusqlite::Result<_>>()?;
            records.push(PaperRecord {
                id,
                title: row.get(1)?,
                subject_id: row.get(2)?,
                year: row.get(3)?,
                region: row.get(4)?,
                source: row.get(5)?,
                files: paper_files,
            });
        }
        Ok(records)
    }

    pub(super) fn paper_bytes_available(&self, digest: &str, expected_size: u64) -> bool {
        self.attachment_store
            .resource_shard(FOLDER, digest, false)
            .and_then(|dir| open_regular(&dir, Path::new(digest)))
            .and_then(|file| file.metadata())
            .is_ok_and(|metadata| metadata.len() == expected_size)
    }

    pub fn paper_pdf(&self, id: &str) -> Result<(PaperFile, Vec<u8>)> {
        let file = registered(&self.connection, id)?;
        let dir = self
            .attachment_store
            .resource_shard(FOLDER, &file.sha256, false)
            .map_err(access)?;
        let bytes = read_bounded(open_regular(&dir, Path::new(&file.sha256)).map_err(access)?)?;
        if bytes.len() != file.byte_size as usize || hash(&bytes) != file.sha256 {
            return Err(DbError::new(
                ErrorKind::AttachmentHashMismatch,
                "原卷 PDF 的大小或 SHA-256 不匹配。",
            ));
        }
        Ok((file, bytes))
    }

    pub fn link_pdf_regions(
        &mut self,
        question: &str,
        link: &RegionLink,
        correct: bool,
    ) -> Result<()> {
        self.paper_pdf(&link.file_id)?;
        if self.current_revision(question)?.is_none() {
            return Err(invalid("关联的试题修订不存在或无法读取。"));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        save_regions(&tx, question, link, correct)?;
        tx.commit()?;
        Ok(())
    }

    pub fn pdf_locations(
        &self,
        file: Option<&str>,
        question: Option<&str>,
    ) -> Result<Vec<Location>> {
        let (filter, id) = match (file, question) {
            (Some(id), None) => {
                registered(&self.connection, id)?;
                ("r.file_id = ?1", id)
            }
            (None, Some(id)) => (
                "r.question_id IN (SELECT original_id FROM question_members WHERE logical_id =
                    (SELECT logical_id FROM question_identity WHERE original_id = ?1))",
                id,
            ),
            _ => return Err(invalid("请选择一个试题或单个 PDF 版本。")),
        };
        let mut query = self.connection.prepare(&format!(
            "SELECT r.paper_id, p.title, r.file_id, r.source_key, r.question_id, r.ordinal,
                    r.page_index, r.x0, r.y0, r.x1, r.y1
             FROM paper_region r JOIN effective_paper p ON p.id = r.paper_id
             WHERE {filter} ORDER BY r.file_id, r.source_key, r.ordinal"
        ))?;
        let locations = query
            .query_map([id], |row| {
                Ok(Location {
                    paper_id: row.get(0)?,
                    title: row.get(1)?,
                    file_id: row.get(2)?,
                    source_key: row.get(3)?,
                    question_id: row.get(4)?,
                    ordinal: row.get(5)?,
                    region: PdfRegion {
                        page_index: row.get(6)?,
                        rect: [row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?],
                    },
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(locations)
    }

    pub fn region_question(
        &self,
        file: &str,
        key: &str,
        ordinal: u32,
    ) -> Result<super::QuestionSummary> {
        let (id, subject_id): (String, String) = self.connection.query_row(
            "SELECT q.id, q.subject_id FROM paper_region r
             JOIN question_occurrence o ON o.paper_id = r.paper_id AND o.source_key = r.source_key AND o.question_id = r.question_id
             JOIN question q ON q.id = o.question_id
             WHERE r.file_id = ?1 AND r.source_key = ?2 AND r.ordinal = ?3",
            params![file, key, ordinal], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?.ok_or_else(|| invalid("选中的原卷区域已不存在。"))?;
        let revision = self
            .current_revision(&id)?
            .ok_or_else(|| invalid("关联的试题修订不存在或无法读取。"))?;
        Ok(super::QuestionSummary {
            id,
            subject_id,
            current_revision_id: Some(revision.id),
        })
    }
}

fn optional_label(value: Option<&str>) -> Result<Option<&str>> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(label)
        .transpose()
}

fn install(dir: &Dir, digest: &str, bytes: &[u8]) -> io::Result<bool> {
    install_with(dir, digest, bytes, |file| file.write_all(bytes))
}

fn install_with(
    dir: &Dir,
    digest: &str,
    bytes: &[u8],
    write: impl FnOnce(&mut cap_std::fs::File) -> io::Result<()>,
) -> io::Result<bool> {
    let temporary = format!(".{digest}.tmp");
    match dir.remove_file(&temporary) {
        Ok(()) => (),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => return Err(error),
    }
    match open_regular(dir, Path::new(digest)) {
        Ok(file) => {
            let mut existing = Vec::new();
            file.take(MAX_BYTES as u64 + 1).read_to_end(&mut existing)?;
            if existing == bytes {
                return Ok(false);
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => return Err(error),
    }
    let result = (|| {
        let mut file =
            dir.open_with(&temporary, OpenOptions::new().write(true).create_new(true))?;
        write(&mut file)?;
        file.sync_all()?;
        drop(file);
        dir.rename(&temporary, dir, digest)?;
        #[cfg(unix)]
        super::attachments::sync_directory(dir)?;
        Ok(true)
    })();
    if result.is_err() {
        let _ = dir.remove_file(&temporary);
    }
    result
}

pub(super) fn save_regions(
    db: &Connection,
    question: &str,
    link: &RegionLink,
    correct: bool,
) -> Result<()> {
    let file = registered(db, &link.file_id)?;
    if file.role != "original" || !(1..=64).contains(&link.regions.len()) {
        return Err(invalid("请选择原卷及 1–64 个区域。"));
    }
    let key = label(&link.source_key)?;
    for region in &link.regions {
        let [x0, y0, x1, y1] = region.rect;
        if region.page_index >= file.page_count
            || !(0.0 <= x0 && x0 < x1 && x1 <= 1.0 && 0.0 <= y0 && y0 < y1 && y1 <= 1.0)
        {
            return Err(invalid("原卷页索引或归一化区域无效。"));
        }
    }
    if correct {
        let count = db.execute(
            "DELETE FROM paper_region WHERE file_id = ?1 AND paper_id = ?2 AND source_key = ?3 AND question_id = ?4",
            params![file.id, file.paper_id, key, question],
        )?;
        if count == 0 {
            return Err(invalid("该题的区域不属于选中的 PDF 版本，无法更正。"));
        }
    } else {
        db.execute(
            "INSERT INTO question_occurrence(paper_id, source_key, question_id) VALUES (?1, ?2, ?3)
                    ON CONFLICT(paper_id, source_key) DO NOTHING",
            params![file.paper_id, key, question],
        )?;
    }
    for (ordinal, region) in link.regions.iter().enumerate() {
        let [x0, y0, x1, y1] = region.rect;
        db.execute(
            "INSERT INTO paper_region
            (paper_id, source_key, question_id, file_id, ordinal, page_index, x0, y0, x1, y1)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                file.paper_id,
                key,
                question,
                file.id,
                ordinal as u32,
                region.page_index,
                x0,
                y0,
                x1,
                y1
            ],
        )?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "paper_reader_tests.rs"]
mod tests;
