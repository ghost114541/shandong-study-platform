use crate::storage;
use std::{fs, path::Path};
use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
mod windows;

pub async fn print(window: WebviewWindow, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let temporary_pdf = windows::render(window).await?;
    #[cfg(target_os = "macos")]
    let temporary_pdf = macos::render(window).await?;

    let bytes = fs::read(temporary_pdf.path().join("output.pdf"))
        .map_err(|error| format!("无法读取已生成的 PDF：{error}"))?;
    let valid = bytes.starts_with(b"%PDF-")
        && lopdf::Document::load_mem(&bytes)
            .is_ok_and(|document| !document.is_encrypted() && !document.get_pages().is_empty());
    if !valid {
        return Err("打印引擎未生成可读取且含页面的 PDF。".into());
    }
    storage::save_atomic(destination, &bytes).map_err(|error| format!("无法保存 PDF：{error}"))
}
