use std::{ffi::{c_int, c_void, CString}, os::unix::ffi::OsStrExt, time::Duration};
use tauri::WebviewWindow;
use tempfile::TempDir;
use tokio::sync::oneshot;

extern "C" {
    fn knowpaper_webview_pdf(view: *mut c_void, path: *const std::ffi::c_char) -> c_int;
    fn knowpaper_source_print(bytes: *const u8, length: usize, first: u32, last: u32) -> c_int;
}

pub async fn render(window: WebviewWindow) -> Result<TempDir, String> {
    let directory = tempfile::tempdir().map_err(|error| format!("无法创建 PDF 临时目录：{error}"))?;
    let path = CString::new(directory.path().join("output.pdf").as_os_str().as_bytes())
        .map_err(|_| "PDF 临时路径无效。")?;
    let (sender, reply) = oneshot::channel();
    window.with_webview(move |view| {
        if sender.is_closed() {
            return;
        }
        // Tauri supplies the live WKWebView on its UI thread. The path and staging
        // directory stay alive until the native operation has actually returned.
        let status = unsafe { knowpaper_webview_pdf(view.inner(), path.as_ptr()) };
        let result = match status {
            1 => Ok(directory),
            0 => Err("macOS WebKit 打印失败或已取消。".into()),
            _ => Err("macOS WebKit 无法执行打印。".into()),
        };
        let _ = sender.send(result);
    }).map_err(|error| format!("macOS WebKit 不可用：{error}"))?;
    tokio::time::timeout(Duration::from_secs(60), reply)
        .await
        .map_err(|_| "macOS PDF 打印超时。")?
        .map_err(|_| "macOS PDF 打印窗口已关闭。")?
}

pub async fn source_print(window: WebviewWindow, bytes: Vec<u8>, first: u32, last: u32) -> Result<(), String> {
    let (sender, reply) = oneshot::channel();
    window.with_webview(move |_| {
        // The system panel is interactive. Keep the verified source bytes alive
        // for the duration of the native print operation.
        let status = unsafe { knowpaper_source_print(bytes.as_ptr(), bytes.len(), first, last) };
        let _ = sender.send(match status {
            0 | 1 => Ok(()),
            _ => Err("macOS 无法打开原卷打印，或该 PDF 不允许打印。".into()),
        });
    }).map_err(|error| format!("macOS 系统打印不可用：{error}"))?;
    reply.await.map_err(|_| "macOS 系统打印窗口已关闭。")?
}
