use crate::editor_ipc::database;
use shandong_poc_001b::db::{
    DbError, ErrorKind, PackHistory, PackInstallResult, PackPreview, PackProgress, Result,
    ValidatedPack,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Default)]
pub struct PackSession {
    busy: AtomicBool,
    cancel: Arc<AtomicBool>,
    cancellable: Mutex<bool>,
    selected: Mutex<Option<PackSelection>>,
}

struct PackSelection {
    sha: String,
    base_version: Option<i64>,
    pack: ValidatedPack,
}

pub const PROGRESS_EVENT: &str = "resource-pack-progress";

fn error(kind: ErrorKind, message: impl Into<String>) -> DbError {
    DbError {
        kind,
        message: message.into(),
    }
}

struct Active<'a>(&'a PackSession);
impl Drop for Active<'_> {
    fn drop(&mut self) {
        *self.0.cancellable.lock().unwrap_or_else(|p| p.into_inner()) = false;
        self.0.busy.store(false, Ordering::Release);
    }
}

impl PackSession {
    fn begin(&self, window: &WebviewWindow) -> Result<Active<'_>> {
        require_main(window)?;
        if self.busy.swap(true, Ordering::AcqRel) {
            return Err(error(ErrorKind::Busy, "资源包操作正在进行。"));
        }
        self.cancel.store(false, Ordering::Release);
        Ok(Active(self))
    }

    pub fn busy(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }

    fn update(&self, window: &WebviewWindow, progress: PackProgress) {
        *self.cancellable.lock().unwrap_or_else(|p| p.into_inner()) = progress.cancellable;
        #[cfg(all(debug_assertions, feature = "dev009-test-hooks"))]
        let phase = progress.phase;
        let _ = window.emit(PROGRESS_EVENT, progress);
        #[cfg(all(debug_assertions, feature = "dev009-test-hooks"))]
        test_checkpoint(window, phase);
    }
}

fn require_main(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(error(
            ErrorKind::InvalidContent,
            "资源包管理仅在主窗口可用。",
        ))
    }
}

#[tauri::command]
pub async fn select_resource_pack(window: WebviewWindow) -> Result<Option<PackPreview>> {
    let session = window.state::<PackSession>();
    let _active = session.begin(&window)?;
    *session.selected.lock().unwrap_or_else(|p| p.into_inner()) = None;
    let (send, receive) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    let dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("知卷资源包", &["studyzip"])
        .set_title("选择本地知卷资源包");
    #[cfg(all(debug_assertions, feature = "dev009-test-hooks"))]
    let dialog = if test_profile(&window) {
        match std::env::var_os("KNOWPAPER_DEV009_FIXTURES") {
            Some(path) => dialog.set_directory(std::path::PathBuf::from(path)),
            None => dialog,
        }
    } else {
        dialog
    };
    dialog.pick_file(move |path| {
        let _ = send.send(path);
    });
    let Some(path) = receive
        .await
        .map_err(|_| error(ErrorKind::FileAccess, "文件选择器提前关闭。"))?
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|_| error(ErrorKind::FileAccess, "请选择本地资源包文件。"))?;
    if !path
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("studyzip"))
    {
        return Err(error(
            ErrorKind::InvalidContent,
            "请选择 .studyzip 资源包。",
        ));
    }
    session.update(
        &window,
        PackProgress {
            phase: "validating",
            done: 0,
            total: 0,
            cancellable: true,
        },
    );
    let cancel = session.cancel.clone();
    let pack = tauri::async_runtime::spawn_blocking(move || {
        ValidatedPack::read_cancellable(&path, &cancel)
    })
    .await
    .map_err(|_| error(ErrorKind::FileAccess, "资源包校验任务中断。"))??;
    session.update(
        &window,
        PackProgress {
            phase: "previewing",
            done: 0,
            total: 0,
            cancellable: false,
        },
    );
    if session.cancel.load(Ordering::Acquire) {
        return Err(error(ErrorKind::InvalidContent, "资源包校验已取消。"));
    }
    let app = window.app_handle().clone();
    database(app.clone(), move |db| {
        let preview = db.preview_pack(&pack)?;
        if !preview.already_installed && preview.conflicts.is_empty() {
            *app.state::<PackSession>()
                .selected
                .lock()
                .unwrap_or_else(|p| p.into_inner()) = Some(PackSelection {
                sha: preview.archive_sha.clone(),
                base_version: preview.base_version_id,
                pack,
            });
        }
        Ok(Some(preview))
    })
    .await
}

#[tauri::command]
pub async fn install_resource_pack(
    window: WebviewWindow,
    archive_sha: String,
) -> Result<PackInstallResult> {
    let session = window.state::<PackSession>();
    let _active = session.begin(&window)?;
    let mut selection = {
        let mut slot = session.selected.lock().unwrap_or_else(|p| p.into_inner());
        if !slot
            .as_ref()
            .is_some_and(|selection| selection.sha == archive_sha)
        {
            return Err(error(ErrorKind::Conflict, "预览已失效，请重新选择资源包。"));
        }
        slot.take().unwrap()
    };
    let app = window.app_handle().clone();
    let worker_window = window.clone();
    database(app.clone(), move |db| {
        let session = app.state::<PackSession>();
        let result = db.install_pack_confirmed(
            &mut selection.pack,
            Some(selection.base_version),
            &session.cancel,
            |progress| session.update(&worker_window, progress),
        )?;
        #[cfg(all(debug_assertions, feature = "dev009-test-hooks"))]
        if test_profile(&worker_window) {
            if let Ok(json) = serde_json::to_string(&result) {
                println!("DEV009_INSTALL_METRICS {json}");
            }
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub fn cancel_resource_pack(window: WebviewWindow) -> Result<bool> {
    require_main(&window)?;
    let session = window.state::<PackSession>();
    let cancellable = session
        .cancellable
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    if *cancellable {
        session.cancel.store(true, Ordering::Release);
    }
    Ok(*cancellable)
}

#[tauri::command]
pub fn discard_resource_pack(window: WebviewWindow) -> Result<()> {
    let session = window.state::<PackSession>();
    let _active = session.begin(&window)?;
    *session.selected.lock().unwrap_or_else(|p| p.into_inner()) = None;
    Ok(())
}

#[tauri::command]
pub async fn resource_pack_history(window: WebviewWindow) -> Result<PackHistory> {
    require_main(&window)?;
    database(window.app_handle().clone(), |db| db.resource_pack_history()).await
}

#[tauri::command]
pub async fn recover_resource_packs(window: WebviewWindow) -> Result<PackHistory> {
    let session = window.state::<PackSession>();
    let _active = session.begin(&window)?;
    database(window.app_handle().clone(), |db| {
        db.recover_resource_packs()?;
        db.resource_pack_history()
    })
    .await
}

#[cfg(all(debug_assertions, feature = "dev009-test-hooks"))]
fn test_profile(window: &WebviewWindow) -> bool {
    let identifier = &window.app_handle().config().identifier;
    identifier
        .strip_prefix("org.shandong-study.dev009-")
        .is_some_and(|suffix| suffix.len() == 8 && suffix.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[cfg(all(debug_assertions, feature = "dev009-test-hooks"))]
fn test_checkpoint(window: &WebviewWindow, phase: &str) {
    if test_profile(window) && std::env::var("KNOWPAPER_DEV009_PAUSE").as_deref() == Ok(phase) {
        let path = window
            .app_handle()
            .path()
            .app_data_dir()
            .expect("isolated profile");
        std::fs::write(path.join("dev009-test-ready"), phase).expect("checkpoint marker");
        loop {
            std::thread::park();
        }
    }
}
