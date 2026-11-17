use super::{
    attachments::validate_image, content::has_content, Attachment, Database, DbError, ErrorKind,
    PaperSettings, Result, SavedPaper,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum Mode {
    Paper,
    Answers,
}

#[derive(Serialize)]
struct PrintPart {
    id: String,
    score: u32,
    main: Option<Value>,
    analysis: Option<Value>,
}

#[derive(Serialize)]
struct PrintEntry {
    revision_id: i64,
    subject: String,
    group: String,
    score: u32,
    main: Option<Value>,
    analysis: Option<Value>,
    parts: Vec<PrintPart>,
    attachments: Vec<Attachment>,
}

impl PrintEntry {
    fn documents(&self) -> impl Iterator<Item = &Value> {
        self.main.iter().chain(self.analysis.iter()).chain(
            self.parts
                .iter()
                .flat_map(|part| part.main.iter().chain(part.analysis.iter())),
        )
    }
}

#[derive(Serialize)]
pub struct CompositionPrintSnapshot {
    pub id: String,
    pub previous_id: Option<String>,
    title: String,
    settings: PaperSettings,
    mode: Mode,
    pub identity: String,
    entries: Vec<PrintEntry>,
}

#[derive(Serialize)]
pub struct PrintPair {
    pub identity: String,
    pub paper: CompositionPrintSnapshot,
    pub answers: CompositionPrintSnapshot,
}

pub struct PreparedPrintPair {
    pub pair: PrintPair,
    pub images: BTreeMap<String, String>,
    pub warnings: Vec<String>,
}

impl CompositionPrintSnapshot {
    pub fn manifest(&self) -> Vec<(&str, i64, u32, Vec<u32>)> {
        self.entries
            .iter()
            .map(|entry| {
                (
                    entry.group.as_str(),
                    entry.revision_id,
                    entry.score,
                    entry.parts.iter().map(|part| part.score).collect(),
                )
            })
            .collect()
    }

    pub fn mode(&self) -> &'static str {
        match self.mode {
            Mode::Paper => "paper",
            Mode::Answers => "answers",
        }
    }

    pub fn image_count(&self) -> usize {
        self.entries
            .iter()
            .flat_map(PrintEntry::documents)
            .flat_map(images)
            .count()
    }

    pub fn attachment_ids(&self) -> BTreeSet<&str> {
        self.entries
            .iter()
            .flat_map(|entry| entry.attachments.iter().map(|item| item.id.as_str()))
            .collect()
    }

    fn from_paper(paper: &SavedPaper, mode: Mode) -> Result<Self> {
        let mut entries = Vec::with_capacity(paper.items.len());
        for item in &paper.items {
            let content = &item.question.revision.content;
            let answers = matches!(mode, Mode::Answers);
            let optional =
                |doc: &Option<Value>| doc.as_ref().filter(|doc| has_content(doc)).cloned();
            let mut entry = PrintEntry {
                revision_id: item.question.revision.id,
                subject: item.question.subject.clone(),
                group: item.points.group.clone(),
                score: item.points.score,
                main: if answers {
                    optional(&content.answer)
                } else {
                    Some(content.stem.clone())
                },
                analysis: answers.then(|| optional(&content.analysis)).flatten(),
                parts: content
                    .parts
                    .iter()
                    .zip(&item.points.part_scores)
                    .map(|(part, &score)| PrintPart {
                        id: part.id.clone(),
                        score,
                        main: if answers {
                            optional(&part.answer)
                        } else {
                            Some(part.prompt.clone())
                        },
                        analysis: answers.then(|| optional(&part.analysis)).flatten(),
                    })
                    .collect(),
                attachments: Vec::new(),
            };
            let ids: BTreeSet<_> = entry
                .documents()
                .flat_map(images)
                .filter_map(|src| src.strip_prefix("attachment:"))
                .collect();
            entry.attachments = content
                .attachments
                .iter()
                .filter(|item| ids.contains(item.id.as_str()))
                .cloned()
                .collect();
            entries.push(entry);
        }
        let mut result = Self {
            id: paper.header.id.clone(),
            previous_id: paper.header.previous_id.clone(),
            title: paper.header.title.clone(),
            settings: paper.settings.clone(),
            mode,
            identity: String::new(),
            entries,
        };
        // Hash the versioned canonical Rust serialization with an empty identity field.
        let mut digest = Sha256::new();
        digest.update(b"knowpaper-composition-print-v1\0");
        serde_json::to_writer(DigestWriter(&mut digest), &result)
            .map_err(|error| DbError::new(ErrorKind::Integrity, error.to_string()))?;
        result.identity = URL_SAFE_NO_PAD.encode(digest.finalize());
        Ok(result)
    }
}

struct DigestWriter<'a>(&'a mut Sha256);

impl std::io::Write for DigestWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn images(doc: &Value) -> impl Iterator<Item = &str> {
    doc["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "image")
        .filter_map(|block| block["attrs"]["src"].as_str())
}

impl Database {
    pub fn composition_print_pair(&mut self, id: &str) -> Result<PrintPair> {
        let saved = self.load_paper(id)?;
        let paper = CompositionPrintSnapshot::from_paper(&saved, Mode::Paper)?;
        let answers = CompositionPrintSnapshot::from_paper(&saved, Mode::Answers)?;
        let identity = URL_SAFE_NO_PAD.encode(Sha256::digest(format!(
            "{}:{}",
            paper.identity, answers.identity
        )));
        Ok(PrintPair {
            identity,
            paper,
            answers,
        })
    }

    pub fn prepare_composition_print(
        &mut self,
        id: &str,
        preview_identity: &str,
    ) -> Result<PreparedPrintPair> {
        let pair = self.composition_print_pair(id)?;
        if pair.identity != preview_identity {
            return Err(DbError::new(
                ErrorKind::Conflict,
                "组卷内容与这次预览不一致，请重新生成预览。",
            ));
        }
        let mut files = BTreeMap::new();
        let mut inline = BTreeSet::new();
        let mut warnings = Vec::new();
        let mut total_bytes = 0;
        for entry in pair.paper.entries.iter().chain(&pair.answers.entries) {
            for attachment in &entry.attachments {
                let linked: bool = self.connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM revision_attachment WHERE revision_id = ?1 AND attachment_id = ?2)",
                    rusqlite::params![entry.revision_id, attachment.id], |row| row.get(0),
                )?;
                if !linked {
                    return Err(DbError::new(
                        ErrorKind::Integrity,
                        format!(
                            "修订 #{} 缺少附件 {} 的关联登记。",
                            entry.revision_id, attachment.id
                        ),
                    ));
                }
                if let Some((declared, _)) = files.get(&attachment.id) {
                    if attachment != declared {
                        return Err(DbError::new(
                            ErrorKind::Integrity,
                            "不同修订的附件登记不一致。",
                        ));
                    }
                    continue;
                }
                let (declared, bytes) = self.read_attachment(&attachment.id, Some(attachment))?;
                total_bytes += bytes.len();
                if total_bytes > 64 * 1024 * 1024 {
                    return Err(DbError::new(
                        ErrorKind::AttachmentTooLarge,
                        "本次打印的独立附件超过 64 MiB。",
                    ));
                }
                check_resolution(
                    &bytes,
                    &format!(
                        "修订 #{} 的附件 {}",
                        entry.revision_id,
                        &declared.sha256[..12]
                    ),
                    &mut warnings,
                )?;
                let data_url = format!(
                    "data:{};base64,{}",
                    declared.media_type,
                    STANDARD.encode(&bytes)
                );
                files.insert(attachment.id.clone(), (declared, data_url));
            }
            for src in entry
                .documents()
                .flat_map(images)
                .filter(|src| src.starts_with("data:"))
            {
                if !inline.insert(src) {
                    continue;
                }
                let (mime, data) = src[5..].split_once(";base64,").ok_or_else(|| {
                    DbError::new(ErrorKind::InvalidContent, "历史内嵌图片声明不完整。")
                })?;
                let bytes = STANDARD.decode(data).map_err(|error| {
                    DbError::new(
                        ErrorKind::AttachmentDecode,
                        format!("历史内嵌图片无法解码：{error}"),
                    )
                })?;
                validate_image(&bytes, Some(mime))?;
                check_resolution(
                    &bytes,
                    &format!(
                        "修订 #{} 的历史内嵌图片 {}",
                        entry.revision_id,
                        inline.len()
                    ),
                    &mut warnings,
                )?;
            }
        }
        let images = files.into_iter().map(|(id, (_, url))| (id, url)).collect();
        Ok(PreparedPrintPair {
            pair,
            images,
            warnings,
        })
    }
}

fn check_resolution(bytes: &[u8], label: &str, warnings: &mut Vec<String>) -> Result<()> {
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| DbError::new(ErrorKind::AttachmentDecode, error.to_string()))?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| DbError::new(ErrorKind::AttachmentDecode, error.to_string()))?;
    if width < 600 || height < 300 {
        warnings.push(format!(
            "{label}仅 {width} × {height} 像素，打印可能不够清晰。"
        ));
    }
    Ok(())
}
