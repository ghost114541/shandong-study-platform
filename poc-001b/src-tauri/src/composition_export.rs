use crate::editor_ipc::database;
use serde::Serialize;
use shandong_poc_001b::db::{CompositionPrintSnapshot, PrintPair, Result as DbResult};
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::sync::oneshot;

#[derive(Serialize)]
pub struct ExportResult {
    warnings: Vec<String>,
    paper: Option<PathBuf>,
    answers: Option<PathBuf>,
}

#[derive(Serialize)]
pub struct PrintPayload {
    snapshot: CompositionPrintSnapshot,
    images: BTreeMap<String, String>,
}

struct PrintJob {
    payload: Arc<PrintPayload>,
    served: bool,
    ready: Option<oneshot::Sender<Result<(), String>>>,
}

#[derive(Default)]
pub struct PrintJobs(Mutex<HashMap<String, PrintJob>>);

impl PrintJobs {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, PrintJob>>, String> {
        self.0.lock().map_err(|_| "无法访问打印任务。".into())
    }
}

fn print_label(token: &str) -> String {
    format!("composition-print-{token}")
}

#[tauri::command]
pub async fn preview_composition(app: AppHandle, id: String) -> DbResult<PrintPair> {
    database(app, move |db| db.composition_print_pair(&id)).await
}

#[tauri::command]
pub fn composition_print_payload(
    window: WebviewWindow,
    jobs: State<'_, PrintJobs>,
    token: String,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != print_label(&token) {
        return Err("打印快照只能由对应的打印窗口读取。".into());
    }
    let payload = {
        let mut jobs = jobs.lock()?;
        let job = jobs.get_mut(&token).ok_or("打印任务已失效。")?;
        if job.served {
            return Err("打印快照已经读取。".into());
        }
        job.served = true;
        job.payload.clone()
    };
    let bytes = serde_json::to_vec(&*payload).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn composition_print_ready(
    window: WebviewWindow,
    jobs: State<'_, PrintJobs>,
    token: String,
    identity: Option<String>,
    failure: Option<String>,
) -> Result<(), String> {
    if window.label() != print_label(&token) {
        return Err("打印就绪信号来自错误的窗口。".into());
    }
    let mut jobs = jobs.lock()?;
    let job = jobs.get_mut(&token).ok_or("打印任务已失效。")?;
    let sender = job.ready.take().ok_or("打印就绪信号已处理。")?;
    let status = if let Some(error) = failure {
        Err(format!("打印视图准备失败：{error}"))
    } else if job.served && identity.as_deref() == Some(&job.payload.snapshot.identity) {
        Ok(())
    } else {
        Err("打印视图使用的组卷快照不一致。".into())
    };
    sender.send(status).map_err(|_| "打印任务已取消。".into())
}

#[tauri::command]
pub async fn export_composition(
    window: WebviewWindow,
    id: String,
    identity: String,
    confirmed: bool,
) -> Result<ExportResult, String> {
    if window.label() != "main" {
        return Err("请从主窗口的已保存组卷预览发起导出。".into());
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        let app = window.app_handle().clone();
        let prepared = database(app.clone(), move |db| {
            db.prepare_composition_print(&id, &identity)
        })
        .await
        .map_err(|error| error.message)?;
        if !confirmed && !prepared.warnings.is_empty() {
            return Ok(ExportResult {
                warnings: prepared.warnings,
                paper: None,
                answers: None,
            });
        }
        let root = crate::data_directory(&app)?.join("pdf");
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("无法创建 PDF 导出目录：{error}"))?;
        let staging = tempfile::Builder::new()
            .prefix(".composition-staging-")
            .tempdir_in(&root)
            .map_err(|error| format!("无法创建 PDF 暂存目录：{error}"))?;
        let token = staging
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix(".composition-staging-"))
            .ok_or("无法分配打印任务标识。")?;
        let destination = root.join(format!(
            "composition-{}-{token}",
            safe_directory_id(&prepared.pair.paper.id)
        ));
        for (suffix, filename, snapshot) in [
            ("paper", "paper.pdf", prepared.pair.paper),
            ("answers", "answers.pdf", prepared.pair.answers),
        ] {
            let images = snapshot
                .attachment_ids()
                .into_iter()
                .map(|id| {
                    prepared
                        .images
                        .get(id)
                        .map(|value| (id.to_owned(), value.clone()))
                        .ok_or_else(|| format!("打印快照未取得已验证附件 {id}。"))
                })
                .collect::<Result<_, _>>()?;
            render(
                &window,
                &format!("{token}-{suffix}"),
                PrintPayload { snapshot, images },
                staging.path().join(filename),
            )
            .await?;
        }
        if destination.exists() {
            return Err("PDF 批次目录已存在，请重新导出。".into());
        }
        // Both files already passed native rendering and PDF checks. Publish via one same-volume rename.
        std::fs::rename(staging.path(), &destination)
            .map_err(|error| format!("无法发布双 PDF：{error}"))?;
        Ok(ExportResult {
            warnings: Vec::new(),
            paper: Some(destination.join("paper.pdf")),
            answers: Some(destination.join("answers.pdf")),
        })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (id, identity, confirmed);
        Err("此平台尚未提供双 PDF 导出。".into())
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn safe_directory_id(id: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(id.as_bytes())[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(any(windows, target_os = "macos"))]
async fn render(
    main: &WebviewWindow,
    token: &str,
    payload: PrintPayload,
    path: PathBuf,
) -> Result<(), String> {
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        time::Duration,
    };
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let app = main.app_handle().clone();
    let label = print_label(token);
    let query = format!("compositionPrint={token}");
    let expected = main
        .url()
        .map_err(|error| error.to_string())?
        .join(&format!("index.html?{query}"))
        .map_err(|error| error.to_string())?;
    let trusted_navigation = expected.clone();
    let once = AtomicBool::new(false);
    let (sender, ready) = oneshot::channel();
    let payload = Arc::new(payload);
    app.state::<PrintJobs>().lock()?.insert(
        token.to_owned(),
        PrintJob {
            payload: payload.clone(),
            served: false,
            ready: Some(sender),
        },
    );
    let token_owned = token.to_owned();
    let app_for_window = app.clone();
    let window_result = tauri::async_runtime::spawn_blocking(move || {
        WebviewWindowBuilder::new(
            &app_for_window,
            label,
            WebviewUrl::App(format!("index.html?{query}").into()),
        )
        .title("知卷 · PDF 打印")
        .visible(false)
        .focused(false)
        .inner_size(850.0, 1000.0)
        .on_navigation(move |url| url == &trusted_navigation && !once.swap(true, Ordering::SeqCst))
        .build()
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result.map_err(|error| error.to_string()));

    let result = match window_result {
        Ok(window) => {
            let result = async {
                tokio::time::timeout(Duration::from_secs(25), ready)
                    .await
                    .map_err(|_| "打印视图未就绪或资源加载超时。")?
                    .map_err(|_| "打印视图已关闭。")??;
                if window.url().map_err(|error| error.to_string())? != expected {
                    return Err("打印窗口已离开指定快照。".into());
                }
                verify_dom(&window, &payload.snapshot).await?;
                crate::pdf::print(window.clone(), &path).await
            }
            .await;
            let _ = window.destroy();
            result
        }
        Err(error) => Err(format!("无法打开受控打印窗口：{error}")),
    };
    app.state::<PrintJobs>().lock()?.remove(&token_owned);
    result
}

#[cfg(any(windows, target_os = "macos"))]
async fn verify_dom(
    window: &WebviewWindow,
    snapshot: &CompositionPrintSnapshot,
) -> Result<(), String> {
    use std::time::Duration;
    let expected = serde_json::json!([
        snapshot.identity,
        snapshot.mode(),
        snapshot.manifest(),
        snapshot.image_count()
    ]);
    let script = format!(
        r#"(() => {{
        const [identity, mode, manifest, imageCount] = {expected};
        const article = document.querySelector('.controlled-print > article');
        if (!article || article.dataset.printIdentity !== identity || article.dataset.printMode !== mode || document.fonts.status !== 'loaded'
            || [...document.fonts].some(font => font.status === 'error')
            || article.querySelector('[data-print-image-missing], .katex-error')) return false;
        const images = [...article.querySelectorAll('img')];
        if (images.length !== imageCount || images.some(img => !img.complete || !img.naturalWidth || !img.naturalHeight)) return false;
        const rendered = [...article.querySelectorAll('[data-print-revision]')].map(entry => [
            entry.dataset.printGroup, Number(entry.dataset.printRevision), Number(entry.dataset.printScore),
            [...entry.querySelectorAll('[data-print-part-score]')].map(part => Number(part.dataset.printPartScore))
        ]);
        return JSON.stringify(rendered) === JSON.stringify(manifest);
    }})()"#
    );
    let (sender, reply) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback(script, move |result| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        })
        .map_err(|error| format!("无法核对 打印视图内容：{error}"))?;
    if tokio::time::timeout(Duration::from_secs(10), reply)
        .await
        .ok()
        .and_then(|response| response.ok())
        .as_deref()
        != Some("true")
    {
        return Err("打印视图内容与固定快照不一致，或字体、公式及图片尚未就绪。".into());
    }
    Ok(())
}
