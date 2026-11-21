use std::{
    ffi::{c_int, c_void, CString},
    os::unix::ffi::OsStrExt,
    time::Duration,
};
use tauri::WebviewWindow;
use tempfile::TempDir;
use tokio::sync::oneshot;

extern "C" {
    fn knowpaper_webview_pdf(
        view: *mut c_void,
        path: *const std::ffi::c_char,
        completion: unsafe extern "C" fn(*mut c_void, c_int),
        context: *mut c_void,
    ) -> c_int;
    fn knowpaper_source_print(bytes: *const u8, length: usize, first: u32, last: u32) -> c_int;
}

struct PdfJob {
    directory: TempDir,
    reply: oneshot::Sender<Result<TempDir, String>>,
}

unsafe extern "C" fn finish_pdf(context: *mut c_void, status: c_int) {
    // The pointer was allocated once in render. AppKit's delegate consumes it
    // exactly once after the native operation closes the staging output.
    let PdfJob { directory, reply } = *Box::from_raw(context.cast::<PdfJob>());
    let result = if status == 1 {
        Ok(directory)
    } else {
        Err("macOS WebKit 打印失败或已取消。".into())
    };
    let _ = reply.send(result);
}

pub async fn render(window: WebviewWindow) -> Result<TempDir, String> {
    let directory =
        tempfile::tempdir().map_err(|error| format!("无法创建 PDF 临时目录：{error}"))?;
    let path = CString::new(directory.path().join("output.pdf").as_os_str().as_bytes())
        .map_err(|_| "PDF 临时路径无效。")?;
    let (sender, reply) = oneshot::channel();
    window
        .with_webview(move |view| {
            if sender.is_closed() {
                return;
            }
            let job = Box::into_raw(Box::new(PdfJob {
                directory,
                reply: sender,
            }))
            .cast();
            // Tauri supplies the live WKWebView on its UI thread. AppKit owns the job
            // context only if it accepts the operation and schedules its delegate.
            if unsafe { knowpaper_webview_pdf(view.inner(), path.as_ptr(), finish_pdf, job) } != 1 {
                let job = unsafe { Box::from_raw(job.cast::<PdfJob>()) };
                let _ = job.reply.send(Err(
                    "macOS WebKit 无法开始打印，或系统正处理另一项打印任务。".into(),
                ));
            }
        })
        .map_err(|error| format!("macOS WebKit 不可用：{error}"))?;
    tokio::time::timeout(Duration::from_secs(60), reply)
        .await
        .map_err(|_| "macOS PDF 打印超时。")?
        .map_err(|_| "macOS PDF 打印窗口已关闭。")?
}

pub async fn source_print(
    window: WebviewWindow,
    bytes: Vec<u8>,
    first: u32,
    last: u32,
) -> Result<(), String> {
    let (sender, reply) = oneshot::channel();
    window
        .with_webview(move |_| {
            // The system panel is interactive. Keep the verified source bytes alive
            // for the duration of the native print operation.
            let status =
                unsafe { knowpaper_source_print(bytes.as_ptr(), bytes.len(), first, last) };
            let _ = sender.send(match status {
                0 | 1 => Ok(()),
                _ => Err("macOS 无法打开原卷打印，或该 PDF 不允许打印。".into()),
            });
        })
        .map_err(|error| format!("macOS 系统打印不可用：{error}"))?;
    reply.await.map_err(|_| "macOS 系统打印窗口已关闭。")?
}
