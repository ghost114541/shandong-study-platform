use crate::storage;
use std::{fs, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::Duration};
use tauri::{webview::PlatformWebview, WebviewWindow};
use tokio::sync::oneshot;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
    PrintToPdfCompletedHandler,
};
use windows_core::{Interface, PCWSTR};

pub async fn print(window: WebviewWindow, destination: &Path) -> Result<(), String> {
    let directory = tempfile::tempdir().map_err(|err| format!("无法创建 PDF 临时目录：{err}"))?;
    let temporary_pdf = directory.path().join("webview2.pdf");
    let print_path = temporary_pdf.clone();
    let (sender, reply) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    window.with_webview(move |webview| {
        let completion = sender.clone();
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, printed| {
            let status = result.map_err(|err| err.to_string()).and_then(|_| {
                if printed { Ok(()) } else { Err("WebView2 返回打印失败。".into()) }
            });
            if let Some(sender) = completion.lock().unwrap().take() {
                let _ = sender.send(status);
            }
            Ok(())
        }));
        if let Err(err) = start_print(webview, print_path, handler) {
            if let Some(sender) = sender.lock().unwrap().take() {
                let _ = sender.send(Err(err.to_string()));
            }
        }
    }).map_err(|err| format!("WebView2 不可用：{err}"))?;
    tokio::time::timeout(Duration::from_secs(60), reply).await
        .map_err(|_| "WebView2 打印超时。")?
        .map_err(|_| "WebView2 打印窗口已关闭。")?
        .map_err(|err| format!("WebView2 PDF 导出失败：{err}"))?;
    let bytes = fs::read(temporary_pdf).map_err(|err| format!("无法读取已生成的 PDF：{err}"))?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("WebView2 未生成有效的 PDF 文件。".into());
    }
    storage::save_atomic(destination, &bytes).map_err(|err| format!("无法保存 PDF：{err}"))
}

fn start_print(
    webview: PlatformWebview,
    path: PathBuf,
    handler: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintToPdfCompletedHandler,
) -> windows_core::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let path: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    // Tauri dispatches with_webview to the WebView2 owning UI thread.
    unsafe {
        let controller = webview.controller();
        let core: ICoreWebView2_7 = controller.CoreWebView2()?.cast()?;
        let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
        let settings = environment.CreatePrintSettings()?;
        settings.SetPageWidth(210.0 / 25.4)?;
        settings.SetPageHeight(297.0 / 25.4)?;
        settings.SetMarginTop(15.0 / 25.4)?;
        settings.SetMarginRight(15.0 / 25.4)?;
        settings.SetMarginBottom(15.0 / 25.4)?;
        settings.SetMarginLeft(15.0 / 25.4)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;
        core.PrintToPdf(PCWSTR(path.as_ptr()), &settings, &handler)
    }
}
