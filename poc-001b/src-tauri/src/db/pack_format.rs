use super::{
    attachments::{hash, validate_image},
    pack_zip::{check_cancel, file_error, PackZip, MAX_MEMBER, MAX_TOTAL},
    paper_files::pack_pdf_pages,
    DbError, ErrorKind, PaperMetadata, PdfRegion, Result, RevisionContent, CONTENT_VERSION,
    MAX_IMAGE_BYTES,
};
use semver::Version;
use serde::{
    de::{DeserializeOwned, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::Path,
    sync::atomic::AtomicBool,
};

const MANIFEST: &str = "manifest.json";
const RIGHTS: &str = "LICENSES/rights-and-attribution.json";
const MAX_MANIFEST: u64 = 2 * 1024 * 1024;
const MAX_RECORD: u64 = 1024 * 1024;
const MAX_RECORDS: usize = 20_000;
const MAX_JSONL_TOTAL: u64 = 64 * 1024 * 1024;
pub(super) const PACK_SCHEMA: u32 = 8;

pub(super) fn invalid(message: impl Into<String>) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub protocol_version: u32,
    pub pack_id: String,
    pub pack_version: Version,
    pub display_name: String,
    pub source: String,
    pub min_app_version: Version,
    pub db_schema: u32,
    pub content_version: u32,
    pub counts: Counts,
    pub license_manifest: String,
    pub files: Vec<Member>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Counts {
    pub knowledge: usize,
    pub questions: usize,
    pub papers: usize,
    pub images: usize,
    pub pdfs: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Member {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub role: Role,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Knowledge,
    Questions,
    Papers,
    Rights,
    Image,
    Pdf,
}

impl Role {
    pub(super) fn folder(self) -> Option<&'static str> {
        match self {
            Self::Image => Some("attachments"),
            Self::Pdf => Some("paper-pdfs"),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rights {
    pub entries: Vec<Right>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Right {
    pub id: String,
    pub source: String,
    pub author: String,
    pub license: String,
    pub statement: String,
    pub redistribution_claimed: bool,
    pub scope: String,
    pub evidence: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Knowledge {
    pub id: String,
    pub subject_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub sort_order: i32,
    pub aliases: Vec<String>,
    pub rights_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Question {
    pub id: String,
    pub subject_id: String,
    pub revision: String,
    pub content: RevisionContent,
    pub knowledge: Vec<String>,
    pub rights_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Paper {
    pub id: String,
    pub subject_id: String,
    pub title: String,
    pub metadata: PaperMetadata,
    pub files: Vec<PaperPdf>,
    pub occurrences: Vec<Occurrence>,
    pub rights_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PaperPdf {
    pub role: String,
    pub sha256: String,
    pub name: String,
    pub rights_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Occurrence {
    pub source_key: String,
    pub question_id: String,
    pub regions: Vec<PdfRegion>,
}

pub(super) struct Blob {
    pub role: Role,
    pub bytes: u64,
    pub mime: Option<&'static str>,
    pub pages: Option<usize>,
    offset: u64,
}

pub struct ValidatedPack {
    pub(super) manifest: Manifest,
    pub(super) manifest_sha: String,
    pub(super) archive_sha: String,
    pub(super) rights: Rights,
    pub(super) knowledge: BTreeMap<String, Knowledge>,
    pub(super) questions: BTreeMap<String, Question>,
    pub(super) papers: BTreeMap<String, Paper>,
    pub(super) blobs: BTreeMap<String, Blob>,
    pub(super) archive_bytes: u64,
    pub(super) unpacked_bytes: u64,
    pub(super) timings: PackTimings,
    spool: File,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct PackTimings {
    pub zip_ms: u128,
    pub manifest_ms: u128,
    pub validate_ms: u128,
    pub preview_ms: u128,
    pub stage_ms: u128,
    pub commit_ms: u128,
}

pub(super) fn valid_id(value: &str) -> bool {
    (1..=96).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

pub(super) fn valid_sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn label(value: &str, max: usize) -> bool {
    value == value.trim()
        && !value.is_empty()
        && value.chars().count() <= max
        && !value.chars().any(char::is_control)
}

fn unique<'a>(values: impl IntoIterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

impl ValidatedPack {
    pub fn read(path: &Path) -> Result<Self> {
        Self::read_cancellable(path, &AtomicBool::new(false))
    }

    pub fn read_cancellable(path: &Path, cancel: &AtomicBool) -> Result<Self> {
        let started = std::time::Instant::now();
        let mut zip = PackZip::open_cancellable(path, cancel)?;
        let zip_ms = started.elapsed().as_millis();
        let started = std::time::Instant::now();
        let mut remaining = MAX_TOTAL;
        let mut bytes = Vec::new();
        let (_, manifest_sha) =
            zip.copy(MANIFEST, MAX_MANIFEST, &mut remaining, &mut bytes, cancel)?;
        let manifest: Manifest = strict_json(&bytes)?;
        validate_manifest(&manifest, &zip)?;
        let manifest_ms = started.elapsed().as_millis();
        let started = std::time::Instant::now();

        let mut spool = tempfile::tempfile().map_err(file_error)?;
        let mut knowledge = BTreeMap::new();
        let mut questions = BTreeMap::new();
        let mut papers = BTreeMap::new();
        let mut blobs = BTreeMap::new();
        let mut rights = None;
        for member in &manifest.files {
            bytes.clear();
            let (size, sha) = zip.copy(
                &member.path,
                member.bytes,
                &mut remaining,
                &mut bytes,
                cancel,
            )?;
            if size != member.bytes || sha != member.sha256 {
                return Err(invalid(format!(
                    "文件 {} 的字节数或 SHA-256 不匹配。",
                    member.path
                )));
            }
            match member.role {
                Role::Knowledge => knowledge = jsonl(&bytes, |item: &Knowledge| &item.id, cancel)?,
                Role::Questions => questions = jsonl(&bytes, |item: &Question| &item.id, cancel)?,
                Role::Papers => papers = jsonl(&bytes, |item: &Paper| &item.id, cancel)?,
                Role::Rights => rights = Some(strict_json(&bytes)?),
                Role::Image | Role::Pdf => {
                    let mut blob = Blob {
                        role: member.role,
                        bytes: size,
                        mime: None,
                        pages: None,
                        offset: spool.stream_position().map_err(file_error)?,
                    };
                    if member.role == Role::Image {
                        let extension = member.path.rsplit_once('.').unwrap().1;
                        let mime = match extension {
                            "png" => "image/png",
                            "jpeg" => "image/jpeg",
                            "webp" => "image/webp",
                            "gif" => "image/gif",
                            _ => unreachable!("checked in manifest"),
                        };
                        blob.mime = Some(validate_image(&bytes, Some(mime))?);
                    } else {
                        blob.pages = Some(pack_pdf_pages(&bytes)?);
                    }
                    spool.write_all(&bytes).map_err(file_error)?;
                    if blobs.insert(sha, blob).is_some() {
                        return Err(invalid("同一资源文件 SHA-256 重复声明。"));
                    }
                }
            }
        }
        let pack = Self {
            manifest,
            manifest_sha,
            archive_sha: zip.digest,
            rights: rights.ok_or_else(|| invalid("缺少权利与来源清单。"))?,
            knowledge,
            questions,
            papers,
            blobs,
            archive_bytes: zip.archive_bytes,
            unpacked_bytes: MAX_TOTAL - remaining,
            timings: PackTimings {
                zip_ms,
                manifest_ms,
                ..PackTimings::default()
            },
            spool,
        };
        pack.validate_contents(cancel)?;
        check_cancel(cancel)?;
        Ok(Self {
            timings: PackTimings {
                validate_ms: started.elapsed().as_millis(),
                ..pack.timings
            },
            ..pack
        })
    }

    pub(super) fn blob_bytes(&mut self, sha: &str) -> Result<Vec<u8>> {
        let blob = &self.blobs[sha];
        self.spool
            .seek(SeekFrom::Start(blob.offset))
            .map_err(file_error)?;
        let mut out = vec![0; blob.bytes as usize];
        self.spool.read_exact(&mut out).map_err(file_error)?;
        if hash(&out) != sha {
            return Err(invalid("暂存资源 SHA-256 不匹配。"));
        }
        Ok(out)
    }

    fn validate_contents(&self, cancel: &AtomicBool) -> Result<()> {
        let rights = &self.rights.entries;
        let ids: BTreeSet<_> = rights.iter().map(|item| item.id.as_str()).collect();
        if rights.is_empty()
            || rights.len() != ids.len()
            || rights.iter().any(|right| {
                !valid_id(&right.id)
                    || ![
                        &right.source,
                        &right.author,
                        &right.license,
                        &right.statement,
                        &right.scope,
                    ]
                    .into_iter()
                    .all(|text| label(text, 500))
                    || right
                        .evidence
                        .as_ref()
                        .is_some_and(|text| !label(text, 500))
            })
        {
            return Err(invalid("权利与来源清单存在无效字段或重复 ID。"));
        }
        let counts = Counts {
            knowledge: self.knowledge.len(),
            questions: self.questions.len(),
            papers: self.papers.len(),
            images: self
                .blobs
                .values()
                .filter(|blob| blob.role == Role::Image)
                .count(),
            pdfs: self
                .blobs
                .values()
                .filter(|blob| blob.role == Role::Pdf)
                .count(),
        };
        if self.manifest.counts != counts
            || counts.knowledge + counts.questions + counts.papers == 0
        {
            return Err(invalid(
                "Manifest 的资源数量声明与实际记录不一致，或包没有资源。",
            ));
        }
        for point in self.knowledge.values() {
            check_cancel(cancel)?;
            if !valid_id(&point.subject_id)
                || !label(&point.title, 120)
                || !ids.contains(point.rights_id.as_str())
                || point.parent_id.as_ref().is_some_and(|id| !valid_id(id))
                || point.aliases.len() > 40
                || !unique(point.aliases.iter().map(String::as_str))
                || point.aliases.iter().any(|alias| !label(alias, 120))
            {
                return Err(invalid(format!("知识点 {} 字段或权利关联无效。", point.id)));
            }
        }
        let mut used = BTreeSet::new();
        for item in self.questions.values() {
            check_cancel(cancel)?;
            if !valid_id(&item.revision)
                || !valid_id(&item.subject_id)
                || !ids.contains(item.rights_id.as_str())
                || !unique(item.knowledge.iter().map(String::as_str))
                || item.knowledge.len() > 100
                || item.knowledge.iter().any(|id| !valid_id(id))
            {
                return Err(invalid(format!("试题 {} 字段或权利关联无效。", item.id)));
            }
            if item.content.schema_version != self.manifest.content_version {
                return Err(DbError::new(
                    ErrorKind::UnsupportedContent,
                    "资源包内的试题内容版本必须与清单一致，目前资源包仅支持 v1。",
                ));
            }
            item.content.to_json()?;
            for a in &item.content.attachments {
                let blob = self.blobs.get(&a.sha256);
                if a.id != format!("sha256-{}", a.sha256)
                    || !blob.is_some_and(|b| {
                        b.mime == Some(a.media_type.as_str()) && b.bytes == a.byte_size
                    })
                {
                    return Err(invalid(format!(
                        "试题 {} 引用了缺失或声明不符的图片。",
                        item.id
                    )));
                }
                used.insert(a.sha256.as_str());
            }
            let docs = [&item.content.stem]
                .into_iter()
                .chain(item.content.answer.iter())
                .chain(item.content.analysis.iter())
                .chain(item.content.parts.iter().flat_map(|part| {
                    [&part.prompt]
                        .into_iter()
                        .chain(part.answer.iter())
                        .chain(part.analysis.iter())
                }));
            for doc in docs {
                if doc["content"].as_array().into_iter().flatten().any(|node| {
                    node["type"] == "image"
                        && !node["attrs"]["src"]
                            .as_str()
                            .is_some_and(|src| src.starts_with("attachment:"))
                }) {
                    return Err(invalid("资源包图片必须引用经清单验证的附件。"));
                }
            }
        }
        for paper in self.papers.values() {
            check_cancel(cancel)?;
            if !valid_id(&paper.subject_id)
                || !label(&paper.title, 120)
                || !ids.contains(paper.rights_id.as_str())
                || paper
                    .metadata
                    .year
                    .is_some_and(|year| !(1..=9999).contains(&year))
                || [&paper.metadata.region, &paper.metadata.source]
                    .into_iter()
                    .flatten()
                    .any(|text| !label(text, 120))
                || !unique(paper.files.iter().map(|file| file.role.as_str()))
                || !unique(
                    paper
                        .occurrences
                        .iter()
                        .map(|item| item.source_key.as_str()),
                )
            {
                return Err(invalid(format!("试卷 {} 字段或权利关联无效。", paper.id)));
            }
            let mut original = None;
            for file in &paper.files {
                let pages = self
                    .blobs
                    .get(&file.sha256)
                    .and_then(|b| b.pages)
                    .ok_or_else(|| invalid(format!("试卷 {} 引用了缺失的 PDF。", paper.id)))?;
                if !matches!(file.role.as_str(), "original" | "answer" | "analysis")
                    || !label(&file.name, 120)
                    || file.name.contains(['/', '\\'])
                    || !ids.contains(file.rights_id.as_str())
                {
                    return Err(invalid("PDF 的角色、文件名称或权利关联无效。"));
                }
                used.insert(file.sha256.as_str());
                if file.role == "original" {
                    original = Some(pages);
                }
            }
            let pages = original.ok_or_else(|| invalid("每份试卷必须声明原卷 PDF。"))?;
            for occ in &paper.occurrences {
                if !label(&occ.source_key, 120)
                    || !valid_id(&occ.question_id)
                    || occ.regions.len() > 64
                    || occ.regions.iter().any(|r| {
                        let [x0, y0, x1, y1] = r.rect;
                        !(r.page_index < pages as u32
                            && 0.0 <= x0
                            && x0 < x1
                            && x1 <= 1.0
                            && 0.0 <= y0
                            && y0 < y1
                            && y1 <= 1.0)
                    })
                {
                    return Err(invalid("原题出处、PDF 页索引或区域无效。"));
                }
            }
        }
        if used.len() != self.blobs.len() {
            return Err(invalid("资源包包含无引用的图片或 PDF。"));
        }
        Ok(())
    }
}

fn validate_manifest(manifest: &Manifest, zip: &PackZip) -> Result<()> {
    let app = Version::parse(env!("CARGO_PKG_VERSION")).expect("cargo version");
    if manifest.format != "shandong-study-resource-pack"
        || manifest.protocol_version != 1
        || manifest.db_schema != PACK_SCHEMA
        || manifest.content_version != CONTENT_VERSION
        || manifest.min_app_version > app
    {
        return Err(DbError::new(
            ErrorKind::UnsupportedContent,
            "资源包格式、协议、软件版本或 Schema 不兼容。",
        ));
    }
    if !valid_id(&manifest.pack_id)
        || manifest.pack_id != manifest.pack_id.to_ascii_lowercase()
        || !manifest.pack_version.build.is_empty()
        || !manifest.pack_version.pre.is_empty()
        || !label(&manifest.display_name, 120)
        || !label(&manifest.source, 500)
        || manifest.license_manifest != RIGHTS
    {
        return Err(invalid("资源包 ID、版本、名称、来源或权利清单路径无效。"));
    }
    if manifest.files.len() + 1 != zip.files.len()
        || !unique(manifest.files.iter().map(|m| m.path.as_str()))
    {
        return Err(invalid("ZIP 文件与 Manifest 清单数量不一致或有重复路径。"));
    }
    let mut records_bytes = 0;
    for member in &manifest.files {
        let sha = &member.sha256;
        let path = &member.path;
        if !valid_sha(sha) || zip.files.get(path).map(|item| item.1) != Some(member.bytes) {
            return Err(invalid(format!(
                "清单路径、字节数或 SHA-256 无效。{}",
                path.chars().take(160).collect::<String>()
            )));
        }
        let limit = match member.role {
            Role::Rights if path == RIGHTS => MAX_MANIFEST,
            Role::Knowledge if path == "data/knowledge.jsonl" => MAX_JSONL_TOTAL,
            Role::Questions if path == "data/questions.jsonl" => MAX_JSONL_TOTAL,
            Role::Papers if path == "data/papers.jsonl" => MAX_JSONL_TOTAL,
            Role::Pdf if path == &format!("paper-pdfs/{sha}.pdf") => MAX_MEMBER,
            Role::Image
                if ["png", "jpeg", "gif", "webp"]
                    .iter()
                    .any(|ext| path == &format!("attachments/{sha}.{ext}")) =>
            {
                MAX_IMAGE_BYTES as u64
            }
            _ => return Err(invalid("清单路径或内容角色不符合协议。")),
        };
        if member.bytes > limit {
            return Err(invalid("清单成员超过内容角色的字节上限。"));
        }
        if matches!(
            member.role,
            Role::Knowledge | Role::Questions | Role::Papers
        ) {
            records_bytes += member.bytes;
        }
    }
    if records_bytes > MAX_JSONL_TOTAL {
        return Err(invalid("JSONL 总字节超过 64 MiB。"));
    }
    Ok(())
}

fn jsonl<T: DeserializeOwned>(
    bytes: &[u8],
    id: impl Fn(&T) -> &str,
    cancel: &AtomicBool,
) -> Result<BTreeMap<String, T>> {
    let mut result = BTreeMap::new();
    let mut reader = BufReader::new(bytes);
    let mut line = Vec::new();
    loop {
        check_cancel(cancel)?;
        line.clear();
        let read = (&mut reader)
            .take(MAX_RECORD + 1)
            .read_until(b'\n', &mut line)
            .map_err(file_error)?;
        if read == 0 {
            return Ok(result);
        }
        if read as u64 > MAX_RECORD || result.len() == MAX_RECORDS {
            return Err(invalid("JSONL 单条大小或记录数超过上限。"));
        }
        let item = strict_json(&line)?;
        let key = id(&item);
        if !valid_id(key) || result.contains_key(key) {
            return Err(invalid("JSONL 资源 ID 无效或重复。"));
        }
        result.insert(key.to_owned(), item);
    }
}

// Typed structs reject unknown fields. The first pass also rejects duplicate keys
// in nested, dynamically typed rich-text nodes.
fn strict_json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice::<NoDuplicateKeys>(bytes).map_err(json_error)?;
    serde_json::from_slice(bytes).map_err(json_error)
}

fn json_error(error: serde_json::Error) -> DbError {
    invalid(format!(
        "资源包 JSON 无效（第 {} 行，第 {} 列）。",
        error.line(),
        error.column()
    ))
}

struct NoDuplicateKeys;

impl<'de> Deserialize<'de> for NoDuplicateKeys {
    fn deserialize<D: Deserializer<'de>>(reader: D) -> std::result::Result<Self, D::Error> {
        struct Check;
        impl<'de> Visitor<'de> for Check {
            type Value = NoDuplicateKeys;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("JSON")
            }
            fn visit_bool<E: serde::de::Error>(
                self,
                _: bool,
            ) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateKeys)
            }
            fn visit_i64<E: serde::de::Error>(self, _: i64) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateKeys)
            }
            fn visit_u64<E: serde::de::Error>(self, _: u64) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateKeys)
            }
            fn visit_f64<E: serde::de::Error>(self, _: f64) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateKeys)
            }
            fn visit_str<E: serde::de::Error>(
                self,
                _: &str,
            ) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateKeys)
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateKeys)
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                while sequence.next_element::<NoDuplicateKeys>()?.is_some() {}
                Ok(NoDuplicateKeys)
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut keys = BTreeSet::new();
                while let Some(key) = map.next_key::<String>()? {
                    if !keys.insert(key) {
                        return Err(serde::de::Error::custom("duplicate JSON key"));
                    }
                    map.next_value::<NoDuplicateKeys>()?;
                }
                Ok(NoDuplicateKeys)
            }
        }
        reader.deserialize_any(Check)
    }
}
