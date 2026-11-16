use serde_json::Value;
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};

const MAX_BYTES: u64 = 32 * 1024 * 1024;

fn check_envelope(data: &Value) -> Result<(), String> {
    let version = data.get("schema_version").and_then(Value::as_u64)
        .ok_or("无效的试题 JSON：缺少整数 schema_version。")?;
    if version != 1 {
        return Err(format!("不兼容的 JSON 数据版本 {version}。"));
    }
    if data.get("document_type").and_then(Value::as_str) != Some("poc001b_question_set")
        || !data.get("questions").and_then(Value::as_array).is_some_and(|items| !items.is_empty())
    {
        return Err("无效的试题 JSON：文档类型或题目列表有误。".into());
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<Option<Value>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("无法读取本地文件 {}：{err}", path.display())),
    };
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|err| format!("读取本地文件失败：{err}"))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("本地试题 JSON 超过 32 MiB。".into());
    }
    let data = serde_json::from_slice(&bytes).map_err(|err| format!("无法解析本地 JSON：{err}"))?;
    check_envelope(&data)?;
    Ok(Some(data))
}

pub fn save(path: &Path, data: &Value) -> Result<(), String> {
    check_envelope(data)?;
    let mut bytes = serde_json::to_vec_pretty(data).map_err(|err| format!("无法编码 JSON：{err}"))?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_BYTES {
        return Err("保存失败：本地试题 JSON 超过 32 MiB。".into());
    }
    save_atomic(path, &bytes).map_err(|err| format!("保存本地 JSON 失败：{err}"))
}

pub fn save_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    // The temporary file lives on the same volume as the destination.
    temp.persist(path).map_err(|err| err.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trip_replacement_preserves_content_and_ids() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("nested").join("questions.json");
        let mut value = json!({
            "schema_version": 1,
            "document_type": "poc001b_question_set",
            "questions": [{
                "id": "poc-math-001",
                "stem": {"type": "doc", "content": [
                    {"type": "blockMath", "attrs": {"latex": "\\sqrt{x}"}},
                    {"type": "image", "attrs": {"src": "data:image/png;base64,AABB"}}
                ]},
                "parts": [{"id": "p1"}]
            }],
        });
        assert_eq!(load(&path).unwrap(), None);
        save(&path, &value).unwrap();
        let mut reopened = load(&path).unwrap().unwrap();
        assert_eq!(reopened, value);
        reopened["questions"][0]["stem"]["content"][0]["attrs"]["latex"] = json!("x^2");
        save(&path, &reopened).unwrap();
        value["questions"][0]["stem"]["content"][0]["attrs"]["latex"] = json!("x^2");
        assert_eq!(load(&path).unwrap(), Some(value));
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn distinguishes_corruption_and_unsupported_versions() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("questions.json");
        fs::write(&path, "{").unwrap();
        assert!(load(&path).unwrap_err().contains("无法解析"));
        fs::write(&path, "{}").unwrap();
        assert!(load(&path).unwrap_err().contains("无效"));
        let future = json!({"schema_version": 9});
        fs::write(&path, future.to_string()).unwrap();
        assert!(load(&path).unwrap_err().contains("不兼容"));
        assert!(save(&path, &json!({"schema_version": 1})).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), future.to_string());
    }
}
