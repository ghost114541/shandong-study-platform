use super::{DbError, ErrorKind, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub const CONTENT_VERSION: u32 = 1;
const MAX_BYTES: usize = 32 * 1024 * 1024;
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
    if version == u64::from(CONTENT_VERSION) {
        return Ok(());
    }
    Err(DbError::new(
        ErrorKind::UnsupportedContent,
        format!("不支持的富文本内容版本 {version}。"),
    ))
}

impl RevisionContent {
    pub fn from_json(json: &str) -> Result<Self> {
        if json.len() > MAX_BYTES {
            return Err(invalid("题目修订超过 32 MiB。"));
        }
        let value: Value =
            serde_json::from_str(json).map_err(|error| invalid(error.to_string()))?;
        check_version(
            value
                .get("schema_version")
                .and_then(Value::as_u64)
                .ok_or_else(|| invalid("缺少整数内容版本 schema_version。"))?,
        )?;
        let result: Self =
            serde_json::from_value(value).map_err(|error| invalid(error.to_string()))?;
        result.validate()?;
        Ok(result)
    }

    pub(crate) fn to_json(&self) -> Result<String> {
        self.validate()?;
        let json = serde_json::to_string(self).map_err(|error| invalid(error.to_string()))?;
        if json.len() > MAX_BYTES {
            return Err(invalid("题目修订超过 32 MiB。"));
        }
        Ok(json)
    }

    fn validate(&self) -> Result<()> {
        check_version(u64::from(self.schema_version))?;
        if self.question_type.trim().is_empty() {
            return Err(invalid("题型不能为空。"));
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

fn validate_documents(documents: [Option<&Value>; 3], attachments: &HashSet<&str>) -> Result<()> {
    for doc in documents.into_iter().flatten() {
        if kind(doc) != Some("doc") {
            return Err(invalid("富文本根节点必须为 doc。"));
        }
        let blocks = doc["content"]
            .as_array()
            .filter(|blocks| !blocks.is_empty())
            .ok_or_else(|| invalid("富文本 doc 必须具有非空 content 数组。"))?;
        for block in blocks {
            match kind(block) {
                Some("paragraph") => {
                    if let Some(inlines) = block.get("content") {
                        for node in inlines
                            .as_array()
                            .ok_or_else(|| invalid("段落 content 必须为数组。"))?
                        {
                            match kind(node) {
                                Some("text")
                                    if node["text"]
                                        .as_str()
                                        .is_some_and(|text| !text.is_empty()) =>
                                {
                                    if let Some(marks) = node.get("marks") {
                                        if !marks.as_array().is_some_and(|items| {
                                            items.iter().all(|mark| {
                                                matches!(kind(mark), Some("bold" | "italic"))
                                            })
                                        }) {
                                            return Err(invalid("文字标记必须为粗体或斜体。"));
                                        }
                                    }
                                }
                                Some("inlineMath") => validate_latex(node)?,
                                Some("hardBreak") => {}
                                _ => return Err(invalid("无效的段落行内节点。")),
                            }
                        }
                    }
                }
                Some("blockMath") => validate_latex(block)?,
                Some("image") => {
                    if !block["attrs"]["src"]
                        .as_str()
                        .is_some_and(|src| valid_image_source(src, attachments))
                    {
                        return Err(invalid(
                            "图片必须引用已登记附件、内置配图或有效的内嵌位图。",
                        ));
                    }
                }
                _ => return Err(invalid("无效的富文本块节点。")),
            }
        }
    }
    Ok(())
}

fn kind(node: &Value) -> Option<&str> {
    node["type"].as_str()
}

fn validate_latex(node: &Value) -> Result<()> {
    if node["attrs"]["latex"]
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

fn has_content(doc: &Value) -> bool {
    doc["content"].as_array().is_some_and(|blocks| {
        blocks.iter().any(|block| {
            matches!(kind(block), Some("blockMath" | "image"))
                || block["content"].as_array().is_some_and(|nodes| {
                    nodes.iter().any(|node| {
                        kind(node) == Some("inlineMath")
                            || node["text"]
                                .as_str()
                                .is_some_and(|text| !text.trim().is_empty())
                    })
                })
        })
    })
}
