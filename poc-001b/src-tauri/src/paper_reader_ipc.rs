use crate::editor_ipc::database;
use serde::Serialize;
use shandong_poc_001b::db::{
    DbError, ErrorKind, ImportPaper, Location, PaperFile, PaperRecord, QuestionSummary, RegionLink,
    Result,
};
use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{ipc::Response, AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

const CHUNK_LIMIT: usize = 1024 * 1024;

#[derive(Default)]
pub struct PdfSessions {
    next: AtomicU64,
    files: Mutex<HashMap<u64, Vec<u8>>>,
}

#[derive(Serialize)]
pub struct PdfSession {
    token: u64,
    file: PaperFile,
}

fn error(message: impl Into<String>) -> DbError {
    DbError {
        kind: ErrorKind::FileAccess,
        message: message.into(),
    }
}

fn main_window(window: &WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        return Err(error("PDF 文件操作仅允许在主窗口执行。"));
    }
    Ok(())
}

async fn selected(window: &WebviewWindow, save_name: Option<&str>) -> Result<Option<PathBuf>> {
    main_window(window)?;
    let (send, receive) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    let dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .add_filter("PDF", &["pdf"]);
    let callback = move |path| {
        let _ = send.send(path);
    };
    if let Some(name) = save_name {
        dialog
            .set_title("保存原始 PDF")
            .set_file_name(name)
            .save_file(callback);
    } else {
        dialog.set_title("导入试卷 PDF").pick_file(callback);
    }
    receive
        .await
        .map_err(|_| error("文件选择器提前关闭。"))?
        .map(|path| path.into_path().map_err(|_| error("请选择本地文件。")))
        .transpose()
}

#[tauri::command]
pub async fn import_paper_pdf(
    window: WebviewWindow,
    input: ImportPaper,
) -> Result<Option<PaperFile>> {
    let Some(path) = selected(&window, None).await? else {
        return Ok(None);
    };
    database(window.app_handle().clone(), move |db| {
        db.import_paper_pdf(&path, &input)
    })
    .await
    .map(Some)
}

#[tauri::command]
pub async fn list_paper_records(app: AppHandle) -> Result<Vec<PaperRecord>> {
    database(app, |db| db.paper_records()).await
}

#[tauri::command]
pub async fn paper_record_for_file(app: AppHandle, file_id: String) -> Result<Option<PaperRecord>> {
    database(app, move |db| db.paper_record_for_file(&file_id)).await
}

#[tauri::command]
pub async fn open_paper_pdf(window: WebviewWindow, file_id: String) -> Result<PdfSession> {
    main_window(&window)?;
    let app = window.app_handle().clone();
    database(app.clone(), move |db| {
        let sessions = app.state::<PdfSessions>();
        let mut opened = sessions
            .files
            .lock()
            .map_err(|_| error("PDF 读取会话不可用。"))?;
        if opened.len() >= 4 {
            return Err(error("PDF 读取会话过多，请关闭后重试。"));
        }
        let (file, bytes) = db.paper_pdf(&file_id)?;
        let token = sessions.next.fetch_add(1, Ordering::Relaxed);
        opened.insert(token, bytes);
        Ok(PdfSession { token, file })
    })
    .await
}

#[tauri::command]
pub fn read_paper_chunk(
    window: WebviewWindow,
    token: u64,
    begin: usize,
    end: usize,
) -> Result<Response> {
    main_window(&window)?;
    if end <= begin || end - begin > CHUNK_LIMIT {
        return Err(error("PDF 读取区间无效。"));
    }
    let sessions = window.state::<PdfSessions>();
    let opened = sessions
        .files
        .lock()
        .map_err(|_| error("PDF 读取会话不可用。"))?;
    let data = opened
        .get(&token)
        .and_then(|bytes| bytes.get(begin..end))
        .ok_or_else(|| error("PDF 读取会话已关闭或区间无效。"))?;
    Ok(Response::new(data.to_vec()))
}

#[tauri::command]
pub fn close_paper_pdf(window: WebviewWindow, token: u64) -> Result<()> {
    main_window(&window)?;
    window
        .state::<PdfSessions>()
        .files
        .lock()
        .map_err(|_| error("PDF 读取会话不可用。"))?
        .remove(&token);
    Ok(())
}

#[tauri::command]
pub async fn save_original_pdf(window: WebviewWindow, file_id: String) -> Result<bool> {
    main_window(&window)?;
    let app = window.app_handle().clone();
    let verify = file_id.clone();
    let (file, _) = database(app.clone(), move |db| db.paper_pdf(&verify)).await?;
    let Some(path) = selected(&window, Some(&file.original_name)).await? else {
        return Ok(false);
    };
    let managed = super::data_directory(&app).map_err(error)?;
    database(app, move |db| {
        let (_, bytes) = db.paper_pdf(&file_id)?;
        let parent = path.parent().ok_or_else(|| error("保存目录无效。"))?;
        let managed = managed
            .canonicalize()
            .map_err(|err| error(err.to_string()))?;
        let parent = parent
            .canonicalize()
            .map_err(|err| error(err.to_string()))?;
        if parent.starts_with(&managed) {
            return Err(error("请选择应用资源目录以外的保存位置。"));
        }
        let name = path.file_name().ok_or_else(|| error("保存文件名无效。"))?;
        let mut file = tempfile::NamedTempFile::new_in(&parent)
            .map_err(|err| error(format!("无法创建 PDF 临时文件。{err}")))?;
        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|err| error(format!("无法写入 PDF。{err}")))?;
        file.persist(parent.join(name))
            .map_err(|err| error(format!("无法保存 PDF。{err}")))?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn list_pdf_locations(
    app: AppHandle,
    file_id: Option<String>,
    question_id: Option<String>,
) -> Result<Vec<Location>> {
    database(app, move |db| {
        db.pdf_locations(file_id.as_deref(), question_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn link_paper_regions(
    window: WebviewWindow,
    question_id: String,
    link: RegionLink,
    correct: bool,
) -> Result<()> {
    main_window(&window)?;
    database(window.app_handle().clone(), move |db| {
        db.link_pdf_regions(&question_id, &link, correct)
    })
    .await
}

#[tauri::command]
pub async fn open_region_question(
    app: AppHandle,
    file_id: String,
    source_key: String,
    ordinal: u32,
) -> Result<QuestionSummary> {
    database(app, move |db| {
        db.region_question(&file_id, &source_key, ordinal)
    })
    .await
}

#[tauri::command]
pub async fn show_source_print_dialog(window: WebviewWindow) -> Result<()> {
    main_window(&window)?;
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM,
        };
        use windows_core::Interface;
        let (send, reply) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                let show = || -> windows_core::Result<()> {
                    // Tauri dispatches this closure to the WebView2 owning UI thread.
                    unsafe {
                        let core: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
                        core.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM)
                    }
                };
                let _ = send
                    .send(show().map_err(|err| error(format!("无法打开 Windows 系统打印。{err}"))));
            })
            .map_err(|err| error(err.to_string()))?;
        reply.await.map_err(|_| error("系统打印窗口已关闭。"))?
    }
    #[cfg(not(windows))]
    {
        Err(error("此版本的原卷打印需要 Windows WebView2。"))
    }
}
