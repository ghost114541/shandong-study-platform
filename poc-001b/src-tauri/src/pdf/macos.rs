use std::{
    ffi::{c_int, c_void, CString},
    os::unix::ffi::OsStrExt,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tempfile::TempDir;
use tokio::sync::oneshot;

extern "C" {
    fn knowpaper_webview_pdf(
        view: *mut c_void,
        path: *const std::ffi::c_char,
        identifier: u64,
        completion: unsafe extern "C" fn(*mut c_void, c_int, c_int),
        context: *mut c_void,
    ) -> c_int;
    fn knowpaper_abandon_webview_pdf(identifier: u64);
    #[cfg(feature = "dev012-test-hooks")]
    fn knowpaper_print_probe_inject(fault: c_int);
    fn knowpaper_source_print(bytes: *const u8, length: usize, first: u32, last: u32) -> c_int;
}

struct PdfJob {
    directory: TempDir,
    reply: Option<oneshot::Sender<Result<TempDir, String>>>,
}

const BUSY: c_int = -3;
const RESTART_REQUIRED: c_int = -2;
const SUCCESS: c_int = 1;
const WINDOW_CLOSED: c_int = 2;
const RESTART_MESSAGE: &str =
    "上一项 macOS 打印尚未结束。请稍后重试；若仍无法打印，请保存工作并退出后重新打开知卷。";
const TIMEOUT_MESSAGE: &str =
    "macOS PDF 打印超时。请稍后重试；若仍无法打印，请保存工作并退出后重新打开知卷。";

static NEXT_JOB: AtomicU64 = AtomicU64::new(1);

struct PendingPrint {
    app: AppHandle,
    identifier: u64,
}

impl Drop for PendingPrint {
    fn drop(&mut self) {
        let identifier = self.identifier;
        let _ = self.app.run_on_main_thread(move || {
            // The window may already be destroyed. Only this job can be abandoned.
            unsafe { knowpaper_abandon_webview_pdf(identifier) };
        });
    }
}

unsafe extern "C" fn finish_pdf(context: *mut c_void, status: c_int, terminal: c_int) {
    let context = context.cast::<PdfJob>();
    if terminal == 0 {
        // The requester can stop waiting before AppKit stops writing to this
        // directory. Keep the allocation and its staging path until didRun.
        if let Some(reply) = (*context).reply.take() {
            let error = if status == WINDOW_CLOSED {
                "macOS PDF 打印窗口已关闭。"
            } else {
                RESTART_MESSAGE
            };
            let _ = reply.send(Err(error.into()));
        }
        return;
    }
    let PdfJob { directory, reply } = *Box::from_raw(context);
    let result = if status == SUCCESS {
        Ok(directory)
    } else {
        Err("macOS WebKit 打印失败或已取消。".into())
    };
    if let Some(reply) = reply {
        let _ = reply.send(result);
    }
}

pub async fn render(window: WebviewWindow) -> Result<TempDir, String> {
    let directory =
        tempfile::tempdir().map_err(|error| format!("无法创建 PDF 临时目录：{error}"))?;
    let path = CString::new(directory.path().join("output.pdf").as_os_str().as_bytes())
        .map_err(|_| "PDF 临时路径无效。")?;
    let identifier = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
    #[cfg(feature = "dev012-test-hooks")]
    let fault = crate::dev012_smoke::print_fault(&window);
    let timeout = Duration::from_secs(60);
    #[cfg(feature = "dev012-test-hooks")]
    let timeout = if fault == 2 {
        Duration::from_secs(1)
    } else {
        timeout
    };
    let deadline = Instant::now() + timeout;
    let _pending = PendingPrint {
        app: window.app_handle().clone(),
        identifier,
    };
    let (sender, reply) = oneshot::channel();
    window
        .with_webview(move |view| {
            if sender.is_closed() {
                return;
            }
            if Instant::now() >= deadline {
                let _ = sender.send(Err(TIMEOUT_MESSAGE.into()));
                return;
            }
            let job = Box::into_raw(Box::new(PdfJob {
                directory,
                reply: Some(sender),
            }))
            .cast();
            // Tauri supplies the live WKWebView on its UI thread. AppKit owns the job
            // context only if it accepts the operation and schedules its delegate.
            #[cfg(feature = "dev012-test-hooks")]
            unsafe {
                knowpaper_print_probe_inject(fault);
            }
            let status = unsafe {
                knowpaper_webview_pdf(view.inner(), path.as_ptr(), identifier, finish_pdf, job)
            };
            if status != SUCCESS {
                let job = unsafe { Box::from_raw(job.cast::<PdfJob>()) };
                let message = match status {
                    BUSY => "系统正处理另一项打印任务，请稍后重试。",
                    RESTART_REQUIRED => RESTART_MESSAGE,
                    _ => "macOS WebKit 无法开始打印。",
                };
                if let Some(reply) = job.reply {
                    let _ = reply.send(Err(message.into()));
                }
            }
        })
        .map_err(|error| format!("macOS WebKit 不可用：{error}"))?;
    tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), reply)
        .await
        .map_err(|_| TIMEOUT_MESSAGE)?
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
                BUSY => Err("系统正处理另一项打印任务，请稍后重试。".into()),
                RESTART_REQUIRED => Err(RESTART_MESSAGE.into()),
                _ => Err("macOS 无法打开原卷打印，或该 PDF 不允许打印。".into()),
            });
        })
        .map_err(|error| format!("macOS 系统打印不可用：{error}"))?;
    reply.await.map_err(|_| "macOS 系统打印窗口已关闭。")?
}
