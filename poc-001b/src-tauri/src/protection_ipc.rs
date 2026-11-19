use crate::{
    editor_ipc::database,
    library_root::{LibraryRoot, Phase},
};
use serde::Serialize;
use shandong_poc_001b::db::{
    ensure_space, unpack_backup, validate_staged_library, BackupManifest, BackupPreview,
    BackupRecord, Database, DbError, ErrorKind, LibraryDiagnostics, Result,
};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tempfile::TempDir;

#[derive(Default)]
pub struct ProtectionSession {
    busy: AtomicBool,
    cancel: AtomicBool,
    frozen: AtomicBool,
    preview: Mutex<Option<TempDir>>,
}

impl ProtectionSession {
    pub fn busy(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }
    pub fn frozen(&self) -> bool {
        self.frozen.load(Ordering::Acquire)
    }
    fn begin(&self, window: &WebviewWindow) -> Result<Busy<'_>> {
        if window.label() != "main" || self.frozen() || self.busy.swap(true, Ordering::AcqRel) {
            return Err(message("数据操作正在执行，或等待重启。"));
        }
        self.cancel.store(false, Ordering::Release);
        Ok(Busy(self))
    }
}
struct Busy<'a>(&'a ProtectionSession);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
pub struct ProtectionStatus {
    directory: String,
    previous: Option<String>,
    phase: Phase,
    error: Option<String>,
    pack_warning: Option<String>,
}

pub struct PackStartupWarning(pub Option<String>);

#[tauri::command]
pub fn protection_status(window: WebviewWindow) -> Result<ProtectionStatus> {
    let state = window
        .try_state::<Mutex<LibraryRoot>>()
        .ok_or_else(|| message("资源库未打开。"))?;
    let root = state.try_lock().map_err(lock_error)?;
    Ok(ProtectionStatus {
        directory: display_path(root.active()),
        previous: root.previous().map(display_path),
        phase: root.phase(),
        error: root.error().map(str::to_owned),
        pack_warning: window.state::<PackStartupWarning>().0.clone(),
    })
}

#[tauri::command]
pub async fn backup_history(window: WebviewWindow) -> Result<Vec<BackupRecord>> {
    database(window.app_handle().clone(), |db| db.backup_history()).await
}

#[tauri::command]
pub fn cancel_protection(window: WebviewWindow) {
    if window.label() == "main" {
        window
            .state::<ProtectionSession>()
            .cancel
            .store(true, Ordering::Release);
    }
}

#[tauri::command]
pub async fn create_backup(window: WebviewWindow) -> Result<Option<BackupManifest>> {
    let session = window.state::<ProtectionSession>();
    let _busy = session.begin(&window)?;
    let Some(path) = pick(&window, Picker::Save).await? else {
        return Ok(None);
    };
    let work = window.clone();
    database(window.app_handle().clone(), move |db| {
        let unique = tempfile::Builder::new()
            .prefix("backup-")
            .tempfile()
            .map_err(lock_error)?;
        let id = unique.path().file_name().unwrap().to_string_lossy();
        db.create_backup(&path, &id, &mut progress(&work)).map(Some)
    })
    .await
}

#[tauri::command]
pub async fn preview_restore(window: WebviewWindow) -> Result<Option<BackupPreview>> {
    let session = window.state::<ProtectionSession>();
    let _busy = session.begin(&window)?;
    let Some(path) = pick(&window, Picker::Open).await? else {
        return Ok(None);
    };
    let work = window.clone();
    protection_task(work.clone(), move || {
        let session = work.state::<ProtectionSession>();
        let state = work
            .try_state::<Mutex<LibraryRoot>>()
            .ok_or_else(|| message("找不到资源库切换记录。"))?;
        let mut root = state.lock().map_err(lock_error)?;
        session.preview.lock().map_err(lock_error)?.take();
        let stage = tempfile::Builder::new()
            .prefix("restored-library-")
            .tempdir_in(root.control())
            .map_err(lock_error)?;
        root.begin(Some(stage.path().to_owned())).map_err(message)?;
        root.update(Phase::Staging, None).map_err(message)?;
        let preview = unpack_backup(&path, stage.path(), &mut progress(&work));
        match preview {
            Ok(preview) => {
                root.update(Phase::Verified, None).map_err(message)?;
                *session.preview.lock().map_err(lock_error)? = Some(stage);
                Ok(Some(preview))
            }
            Err(error) => {
                root.update(Phase::Failed, Some(error.message.clone()))
                    .map_err(message)?;
                Err(error)
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn discard_restore(window: WebviewWindow) -> Result<()> {
    let session = window.state::<ProtectionSession>();
    let _busy = session.begin(&window)?;
    if session.preview.lock().map_err(lock_error)?.take().is_some() {
        window
            .state::<Mutex<LibraryRoot>>()
            .lock()
            .map_err(lock_error)?
            .update(Phase::Complete, None)
            .map_err(message)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn confirm_restore(window: WebviewWindow) -> Result<()> {
    let session = window.state::<ProtectionSession>();
    let _busy = session.begin(&window)?;
    let work = window.clone();
    protection_task(work.clone(), move || {
        let session = work.state::<ProtectionSession>();
        let state = work
            .try_state::<Mutex<LibraryRoot>>()
            .ok_or_else(|| message("找不到资源库切换记录。"))?;
        let mut root = state.lock().map_err(lock_error)?;
        let mut preview = session.preview.lock().map_err(lock_error)?;
        if root.phase() != Phase::Verified || preview.is_none() {
            return Err(message("请重新选择并预检备份。"));
        }
        queue_switch(&work, &mut root)?;
        // The journal owns the candidate after Pending is published.
        let _ = preview.take().unwrap().keep();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn storage_estimate(window: WebviewWindow) -> Result<u64> {
    database(window.app_handle().clone(), |db| {
        db.estimated_library_bytes()
    })
    .await
}

#[tauri::command]
pub async fn migrate_storage(window: WebviewWindow) -> Result<bool> {
    let session = window.state::<ProtectionSession>();
    let _busy = session.begin(&window)?;
    let Some(path) = pick(&window, Picker::Folder).await? else {
        return Ok(false);
    };
    let work = window.clone();
    database(window.app_handle().clone(), move |db| {
        let state = work
            .try_state::<Mutex<LibraryRoot>>()
            .ok_or_else(|| message("找不到资源库切换记录。"))?;
        let mut root = state.lock().map_err(lock_error)?;
        let parent = path.canonicalize().map_err(lock_error)?;
        if parent.starts_with(root.active())
            || parent.starts_with(root.control())
            || root
                .previous()
                .is_some_and(|previous| parent.starts_with(previous))
        {
            return Err(message("请选择当前及回退资源库之外的文件夹。"));
        }
        ensure_space(
            &parent,
            db.estimated_library_bytes()?
                .saturating_add(16 * 1024 * 1024),
        )?;
        let stage = tempfile::Builder::new()
            .prefix("KnowPaper-library-")
            .tempdir_in(parent)
            .map_err(lock_error)?;
        root.begin(Some(stage.path().to_owned())).map_err(message)?;
        root.update(Phase::Staging, None).map_err(message)?;
        let result = (|| {
            let mut report = progress(&work);
            let manifest = db.stage_library(stage.path(), &mut report)?;
            validate_staged_library(stage.path(), manifest, &mut report)?;
            root.update(Phase::Verified, None).map_err(message)?;
            report("verified", 1, 1)?;
            queue_switch(&work, &mut root)
        })();
        if let Err(error) = result {
            root.update(Phase::Failed, Some(error.message.clone()))
                .map_err(message)?;
            return Err(error);
        }
        let _ = stage.keep();
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn rollback_library(window: WebviewWindow) -> Result<()> {
    let session = window.state::<ProtectionSession>();
    let _busy = session.begin(&window)?;
    let work = window.clone();
    protection_task(work.clone(), move || {
        let state = work
            .try_state::<Mutex<LibraryRoot>>()
            .ok_or_else(|| message("找不到资源库切换记录。"))?;
        let mut root = state.lock().map_err(lock_error)?;
        let candidate = root
            .previous()
            .ok_or_else(|| message("当前没有可回退的资源库。"))?
            .to_owned();
        root.begin(Some(candidate)).map_err(message)?;
        queue_switch(&work, &mut root)
    })
    .await
}

#[tauri::command]
pub async fn diagnose_library(window: WebviewWindow) -> Result<LibraryDiagnostics> {
    let session = window.state::<ProtectionSession>();
    let _busy = session.begin(&window)?;
    let work = window.clone();
    database(window.app_handle().clone(), move |db| {
        db.diagnostics(&mut progress(&work))
    })
    .await
}

async fn protection_task<T: Send + 'static>(
    window: WebviewWindow,
    operation: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = window.try_state::<Mutex<Database>>();
        let _database = state
            .as_ref()
            .map(|db| db.lock().map_err(lock_error))
            .transpose()?;
        operation()
    })
    .await
    .map_err(lock_error)?
}

fn display_path(path: &Path) -> String {
    let name = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = name.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(local) = name.strip_prefix(r"\\?\") {
            return local.to_owned();
        }
    }
    name.into_owned()
}

fn queue_switch(window: &WebviewWindow, root: &mut LibraryRoot) -> Result<()> {
    root.update(Phase::Pending, None).map_err(message)?;
    window
        .state::<ProtectionSession>()
        .frozen
        .store(true, Ordering::Release);
    checkpoint(window.app_handle(), "pending");
    Ok(())
}

enum Picker {
    Save,
    Open,
    Folder,
}

async fn pick(window: &WebviewWindow, action: Picker) -> Result<Option<PathBuf>> {
    let (send, receive) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    let builder = window.dialog().file().set_parent(window);
    let done = move |value| {
        let _ = send.send(value);
    };
    match action {
        Picker::Folder => builder
            .set_title("选择资源库的新存储位置")
            .pick_folder(done),
        Picker::Save => builder
            .set_title("保存知卷完整备份")
            .add_filter("知卷备份", &["knowbackup"])
            .set_file_name("KnowPaper.knowbackup")
            .save_file(done),
        Picker::Open => builder
            .set_title("选择知卷备份")
            .add_filter("知卷备份", &["knowbackup"])
            .pick_file(done),
    }
    receive
        .await
        .map_err(lock_error)?
        .map(|file| file.into_path().map_err(lock_error))
        .transpose()
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    phase: &'a str,
    completed: u64,
    total: u64,
}

fn progress(window: &WebviewWindow) -> impl FnMut(&str, u64, u64) -> Result<()> + '_ {
    let mut last = None;
    let mut previous_phase = String::new();
    move |phase, completed, total| {
        let state = window.state::<ProtectionSession>();
        if state.cancel.load(Ordering::Acquire) {
            return Err(message("数据操作已取消。"));
        }
        if completed > 0 && completed < total && matches!(phase, "archive" | "unpack") {
            checkpoint(
                window.app_handle(),
                if phase == "archive" {
                    "archive-mid"
                } else {
                    "unpack-mid"
                },
            );
        }
        if previous_phase != phase {
            checkpoint(window.app_handle(), phase);
            previous_phase = phase.to_owned();
            last = None;
        }
        if last.is_none_or(|time: Instant| time.elapsed() >= Duration::from_millis(100))
            || completed == total
        {
            let _ = window.emit(
                "protection-progress",
                Progress {
                    phase,
                    completed,
                    total,
                },
            );
            last = Some(Instant::now());
        }
        Ok(())
    }
}

#[allow(unused_variables)]
pub fn checkpoint(app: &tauri::AppHandle, phase: &str) {
    #[cfg(all(debug_assertions, feature = "dev010-test-hooks"))]
    if app
        .config()
        .identifier
        .strip_prefix("org.shandong-study.dev010-")
        .is_some_and(|suffix| {
            suffix.len() == 8 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        && std::env::var("KNOWPAPER_DEV010_PAUSE").as_deref() == Ok(phase)
    {
        let path = app.path().app_data_dir().expect("isolated profile");
        std::fs::write(path.join("dev010-test-ready"), phase).expect("checkpoint marker");
        loop {
            std::thread::park();
        }
    }
}

fn message(message: impl Into<String>) -> DbError {
    DbError {
        kind: ErrorKind::FileAccess,
        message: message.into(),
    }
}

fn lock_error(error: impl std::fmt::Display) -> DbError {
    message(error.to_string())
}
