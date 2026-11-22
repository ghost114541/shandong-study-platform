use super::{DbError, ErrorKind, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub const CONTENT_VERSION: u32 = 1;
pub const TABLE_CONTENT_VERSION: u32 = 2;
const MAX_TABLE_BYTES: usize = 512 * 1024;

pub(super) fn supported_version(version: u32) -> bool {
    matches!(version, CONTENT_VERSION | TABLE_CONTENT_VERSION)
}
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
const RASTER_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevisionContent {
    pub schema_version: u32,
    pub question_type: String,
    pub score: u32,
    pub stem: Value,
    pub answer: Option<Value>,
    pub analysis: Option<Value>,
    pub parts: Vec<PartContent>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartContent {
    pub id: String,
    pub score: u32,
    pub prompt: Value,
    pub answer: Option<Value>,
    pub analysis: Option<Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attachment {
    pub id: String,
    pub media_type: String,
    pub byte_size: u64,
    pub sha256: String,
}

fn invalid(message: impl Into<String>) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}

fn check_version(version: u64) -> Result<()> {
    if u32::try_from(version).is_ok_and(supported_version) {
        return Ok(());
    }
    Err(DbError::new(
        ErrorKind::UnsupportedContent,
        format!("不支持的富文本内容版本 {version}。"),
    ))
}

impl RevisionContent {
    pub fn from_json(json: &str) -> Result<Self> {
        Self::decode(json, false)
    }

    pub(super) fn validate_draft(value: &Value) -> Result<()> {
        Self::decode(&value.to_string(), true).map(|_| ())
    }

    fn decode(json: &str, draft: bool) -> Result<Self> {
        if json.len() > MAX_BYTES {
            return Err(invalid("题目修订超过 32 MiB。"));
        }
        let mut value: Value =
            serde_json::from_str(json).map_err(|error| invalid(error.to_string()))?;
        check_version(
            value
                .get("schema_version")
                .and_then(json_integer)
                .ok_or_else(|| invalid("缺少整数内容版本 schema_version。"))?,
        )?;
        normalize_integer(&mut value, "schema_version");
        normalize_integer(&mut value, "score");
        for (array, field) in [("parts", "score"), ("attachments", "byte_size")] {
            if let Some(items) = value.get_mut(array).and_then(Value::as_array_mut) {
                for item in items {
                    normalize_integer(item, field);
                }
            }
        }
        let result: Self =
            serde_json::from_value(value).map_err(|error| invalid(error.to_string()))?;
        result.validate(draft)?;
        Ok(result)
    }

    pub(crate) fn to_json(&self) -> Result<String> {
        self.validate(false)?;
        let json = serde_json::to_string(self).map_err(|error| invalid(error.to_string()))?;
        if json.len() > MAX_BYTES {
            return Err(invalid("题目修订超过 32 MiB。"));
        }
        Ok(json)
    }

    fn validate(&self, draft: bool) -> Result<()> {
        check_version(u64::from(self.schema_version))?;
        if !draft && self.question_type.trim().is_empty() {
            return Err(invalid("题型不能为空。"));
        }
        if self.schema_version == TABLE_CONTENT_VERSION
            && ![
                Some(&self.stem),
                self.answer.as_ref(),
                self.analysis.as_ref(),
            ]
            .into_iter()
            .chain(self.parts.iter().flat_map(|part| {
                [
                    Some(&part.prompt),
                    part.answer.as_ref(),
                    part.analysis.as_ref(),
                ]
            }))
            .flatten()
            .any(|doc| children(doc).any(|block| kind(block) == Some("table")))
        {
            return Err(invalid("富文本版本 2 仅用于含表格的修订。"));
        }

        let mut attachment_ids = HashSet::new();
        for item in &self.attachments {
            if item.id.is_empty()
                || !item
                    .id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                || !attachment_ids.insert(item.id.as_str())
                || !RASTER_TYPES.contains(&item.media_type.as_str())
                || item.byte_size == 0
                || item.byte_size > MAX_SAFE_INTEGER
                || item.sha256.len() != 64
                || !item.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err(invalid("附件标识、类型、大小或 SHA-256 无效，或标识重复。"));
            }
        }

        let mut part_ids = HashSet::new();
        for part in &self.parts {
            if part.id.trim().is_empty() || !part_ids.insert(part.id.as_str()) {
                return Err(invalid("小问 ID 为空或重复。"));
            }
            validate_documents(
                [
                    Some(&part.prompt),
                    part.answer.as_ref(),
                    part.analysis.as_ref(),
                ],
                &attachment_ids,
                self.schema_version,
            )?;
        }
        if !self.parts.is_empty()
            && self.parts.iter().map(|p| u64::from(p.score)).sum::<u64>() != u64::from(self.score)
        {
            return Err(invalid("小问分值之和与整题分值不一致。"));
        }
        validate_documents(
            [
                Some(&self.stem),
                self.answer.as_ref(),
                self.analysis.as_ref(),
            ],
            &attachment_ids,
            self.schema_version,
        )
    }

    pub(crate) fn has_answers(&self) -> bool {
        if self.parts.is_empty() {
            return self.answer.as_ref().is_some_and(has_content);
        }
        self.parts
            .iter()
            .all(|part| part.answer.as_ref().is_some_and(has_content))
    }
}

fn json_integer(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| {
        let number = value.as_f64()?;
        (number >= 0.0 && number <= MAX_SAFE_INTEGER as f64 && number.fract() == 0.0)
            .then_some(number as u64)
    })
}

fn normalize_integer(object: &mut Value, name: &str) {
    if let Some(field) = object.get_mut(name) {
        if let Some(number) = json_integer(field) {
            *field = number.into();
        }
    }
}

fn only_fields(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}

fn validate_documents(
    documents: [Option<&Value>; 3],
    attachments: &HashSet<&str>,
    version: u32,
) -> Result<()> {
    for doc in documents.into_iter().flatten() {
        if kind(doc) != Some("doc") || !only_fields(doc, &["type", "content"]) {
            return Err(invalid("富文本根节点必须为 doc。"));
        }
        let blocks = doc["content"]
            .as_array()
            .filter(|blocks| !blocks.is_empty())
            .ok_or_else(|| invalid("富文本 doc 必须具有非空 content 数组。"))?;
        let mut tables = Vec::new();
        for block in blocks {
            match kind(block) {
                Some("paragraph") => validate_paragraph(block, false)?,
                Some("table") if version == TABLE_CONTENT_VERSION => {
                    validate_table(block)?;
                    tables.push(block);
                }
                Some("blockMath") => validate_latex(block)?,
                Some("image") => {
                    let attrs = &block["attrs"];
                    if !only_fields(block, &["type", "attrs"])
                        || !only_fields(attrs, &["src", "alt", "title", "width", "height"])
                        || !attrs["src"]
                            .as_str()
                            .is_some_and(|src| valid_image_source(src, attachments))
                    {
                        return Err(invalid(
                            "图片必须引用已登记附件、内置配图或有效的内嵌位图。",
                        ));
                    }
                    if ["alt", "title"]
                        .iter()
                        .any(|name| !attrs[*name].is_null() && !attrs[*name].is_string())
                        || ["width", "height"].iter().any(|name| {
                            !attrs[*name].is_null()
                                && !attrs[*name]
                                    .as_f64()
                                    .is_some_and(|size| size.is_finite() && size > 0.0)
                        })
                    {
                        return Err(invalid("图片说明或尺寸无效。"));
                    }
                }
                _ => return Err(invalid("无效的富文本块节点。")),
            }
        }
        if tables.len() > 16
            || (!tables.is_empty()
                && serde_json::to_vec(&tables)
                    .map_err(|error| invalid(error.to_string()))?
                    .len()
                    > MAX_TABLE_BYTES)
        {
            return Err(invalid("单份文档最多 16 张表格，合计不得超过 512 KiB。"));
        }
    }
    Ok(())
}

fn validate_paragraph(block: &Value, in_cell: bool) -> Result<()> {
    if kind(block) != Some("paragraph") || !only_fields(block, &["type", "content"]) {
        return Err(invalid("无效的段落节点。"));
    }
    if let Some(inlines) = block.get("content") {
        let inlines = inlines
            .as_array()
            .ok_or_else(|| invalid("段落 content 必须为数组。"))?;
        if in_cell && inlines.len() > 256 {
            return Err(invalid("单元格段落最多包含 256 个行内节点。"));
        }
        for node in inlines {
            match kind(node) {
                Some("text")
                    if only_fields(node, &["type", "text", "marks"])
                        && node["text"].as_str().is_some_and(|text| !text.is_empty()) =>
                {
                    if let Some(marks) = node.get("marks") {
                        if !marks.as_array().is_some_and(|items| {
                            items.iter().all(|mark| {
                                matches!(kind(mark), Some("bold" | "italic"))
                                    && only_fields(mark, &["type"])
                            })
                        }) {
                            return Err(invalid("文字标记必须为粗体或斜体。"));
                        }
                    }
                }
                Some("inlineMath") => validate_latex(node)?,
                Some("hardBreak") if only_fields(node, &["type"]) => {}
                _ => return Err(invalid("无效的段落行内节点。")),
            }
        }
    }
    Ok(())
}

fn table_children(node: &Value, limit: usize) -> Result<&[Value]> {
    node["content"]
        .as_array()
        .filter(|children| !children.is_empty() && children.len() <= limit)
        .filter(|_| only_fields(node, &["type", "content"]))
        .map(Vec::as_slice)
        .ok_or_else(|| invalid("表格节点字段或尺寸无效。"))
}

fn validate_table(table: &Value) -> Result<()> {
    let rows = table_children(table, 120)?;
    let columns = table_children(&rows[0], 8)?.len();
    if rows.len() * columns > 480 {
        return Err(invalid("单张表格最多 480 格。"));
    }
    for (index, row) in rows.iter().enumerate() {
        let cells = table_children(row, 8)?;
        if kind(row) != Some("tableRow") || cells.len() != columns {
            return Err(invalid("表格必须由等宽的行组成。"));
        }
        for cell in cells {
            if kind(cell) != Some("tableCell") && !(index == 0 && kind(cell) == Some("tableHeader"))
            {
                return Err(invalid("无效的单元格节点，表头限首行。"));
            }
            for paragraph in table_children(cell, 16)? {
                validate_paragraph(paragraph, true)?;
            }
        }
    }
    Ok(())
}

pub(super) fn table_paragraphs(doc: &Value) -> impl Iterator<Item = &Value> {
    children(doc)
        .filter(|node| kind(node) == Some("table"))
        .flat_map(children)
        .flat_map(children)
        .flat_map(children)
}

fn children(node: &Value) -> impl Iterator<Item = &Value> {
    node["content"].as_array().into_iter().flatten()
}

fn kind(node: &Value) -> Option<&str> {
    node["type"].as_str()
}

fn validate_latex(node: &Value) -> Result<()> {
    if only_fields(node, &["type", "attrs"])
        && only_fields(&node["attrs"], &["latex"])
        && node["attrs"]["latex"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 4000)
    {
        return Ok(());
    }
    Err(invalid("公式必须包含 1–4000 字符的原始 LaTeX。"))
}

fn valid_image_source(src: &str, attachments: &HashSet<&str>) -> bool {
    if src == "poc001:parabola" {
        return true;
    }
    if let Some(id) = src.strip_prefix("attachment:") {
        return attachments.contains(id);
    }
    let Some((mime, payload)) = src
        .strip_prefix("data:")
        .and_then(|data| data.split_once(";base64,"))
    else {
        return false;
    };
    let body = payload.trim_end_matches('=');
    RASTER_TYPES.contains(&mime)
        && !body.is_empty()
        && payload.len() % 4 == 0
        && payload.len() - body.len() <= 2
        && body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
}

pub(super) fn has_content(doc: &Value) -> bool {
    children(doc).any(|block| matches!(kind(block), Some("blockMath" | "image")))
        || children(doc)
            .filter(|block| kind(block) == Some("paragraph"))
            .chain(table_paragraphs(doc))
            .flat_map(children)
            .any(|node| {
                kind(node) == Some("inlineMath")
                    || node["text"]
                        .as_str()
                        .is_some_and(|text| !text.trim().is_empty())
            })
}

pub(super) fn table_search_text(content: &RevisionContent) -> String {
    let mut result = String::new();
    for paragraph in std::iter::once(&content.stem)
        .chain(content.parts.iter().map(|part| &part.prompt))
        .flat_map(table_paragraphs)
    {
        result.push('\n');
        for node in children(paragraph) {
            if let Some(text) = node["text"].as_str() {
                result.push_str(text);
            } else {
                result.push('\n');
            }
        }
    }
    result
}
