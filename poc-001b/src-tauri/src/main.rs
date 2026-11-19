#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod composition_export;
mod composition_ipc;
mod draft_trash_ipc;
mod editor_ipc;
mod favorites_ipc;
mod library_paths;
mod library_root;
mod paper_reader_ipc;
mod protection_ipc;
mod resource_pack_ipc;
#[cfg(windows)]
mod pdf;
mod storage;

use editor_ipc::DatabaseStartup;
use library_root::LibraryRoot;
use protection_ipc::{PackStartupWarning, ProtectionSession};
use serde_json::Value;
use shandong_poc_001b::db::{DbError, ErrorKind};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

fn data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let state = app.try_state::<Mutex<LibraryRoot>>().ok_or("资源库未打开。")?;
    let root = state.lock().map_err(|error| error.to_string())?;
    Ok(root.active().to_owned())
}

#[tauri::command]
async fn load_questions(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = data_directory(&app)?.join("questions.json");
    editor_ipc::database(app, move |_| storage::load(&path).map_err(file_error))
        .await.map_err(|error| error.message)
}

#[tauri::command]
async fn save_questions(app: tauri::AppHandle, data: Value) -> Result<PathBuf, String> {
    let path = data_directory(&app)?.join("questions.json");
    editor_ipc::database(app, move |_| {
        storage::save(&path, &data).map_err(file_error)?;
        Ok(path)
    }).await.map_err(|error| error.message)
}

fn file_error(message: String) -> DbError {
    DbError { kind: ErrorKind::FileAccess, message }
}

#[tauri::command]
async fn export_pdf(
    window: tauri::WebviewWindow,
    kind: String,
    long_sample: bool,
    revision_id: Option<i64>,
) -> Result<PathBuf, String> {
    if window.label() != "main" {
        return Err("单题及演示 PDF 只能从主窗口导出。".into());
    }
    let filename = match (kind.as_str(), long_sample, revision_id) {
        ("paper" | "answers", false, Some(id)) if id > 0 => {
            editor_ipc::verify_pdf_revision(window.app_handle().clone(), id, kind == "answers")
                .await
                .map_err(|err| err.message)?;
            format!("revision-{id}-{kind}.pdf")
        }
        ("paper", false, None) => "paper.pdf".into(),
        ("paper", true, None) => "paper-long.pdf".into(),
        ("answers", _, None) => "answers.pdf".into(),
        _ => return Err("请先打开题卷或答案卷预览。".into()),
    };
    let destination = data_directory(window.app_handle())?
        .join("pdf")
        .join(filename);
    #[cfg(windows)]
    {
        pdf::print(window, &destination).await?;
        Ok(destination)
    }
    #[cfg(not(windows))]
    {
        let _ = destination;
        Err("本原型的 PDF 导出需要 Windows WebView2。".into())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(paper_reader_ipc::PdfSessions::default())
        .manage(composition_export::PrintJobs::default())
        .manage(resource_pack_ipc::PackSession::default())
        .manage(ProtectionSession::default())
        .setup(|app| {
            let mut pack_warning = None;
            let status = app.path().app_data_dir()
                .map_err(|error| file_error(format!("找不到数据库目录：{error}")))
                .and_then(|directory| {
                    let mut root = LibraryRoot::lock(&directory).map_err(file_error)?;
                    let result = root.open_database(
                        |db| db.verify_library().map_err(|error| error.message),
                        |phase| protection_ipc::checkpoint(app.handle(), phase),
                    );
                    app.manage(Mutex::new(root));
                    let mut db = result.map_err(file_error)?;
                    if let Err(error) = db.recover_resource_packs() {
                        eprintln!("资源包恢复需要重试：{error}");
                        pack_warning = Some("资源异常，请到资源管理执行检查与恢复。".into());
                    }
                    db.reject_interrupted_backups()?;
                    let version = db.schema_version()?;
                    app.manage(Mutex::new(db));
                    Ok(version)
                });
            app.manage(PackStartupWarning(pack_warning));
            if let Err(error) = &status {
                eprintln!("SQLite 初始化失败：{error}");
            }
            app.manage(DatabaseStartup(status));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<resource_pack_ipc::PackSession>().busy() ||
                    window.state::<ProtectionSession>().busy() {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_questions,
            save_questions,
            export_pdf,
            composition_ipc::composition_question,
            composition_ipc::composition_latest,
            composition_ipc::list_compositions,
            composition_ipc::read_composition,
            composition_ipc::save_composition,
            composition_export::preview_composition,
            composition_export::export_composition,
            composition_export::composition_print_payload,
            composition_export::composition_print_ready,
            editor_ipc::database_status,
            editor_ipc::import_attachment,
            editor_ipc::read_attachment,
            editor_ipc::check_attachment,
            editor_ipc::list_subjects,
            editor_ipc::list_questions,
            editor_ipc::create_question,
            editor_ipc::current_revision,
            editor_ipc::public_original,
            editor_ipc::save_user_revision,
            editor_ipc::read_revision,
            editor_ipc::revision_review,
            editor_ipc::list_revisions,
            editor_ipc::list_knowledge,
            editor_ipc::create_knowledge,
            editor_ipc::rename_knowledge,
            editor_ipc::add_knowledge_alias,
            editor_ipc::question_knowledge,
            editor_ipc::question_knowledge_links,
            editor_ipc::set_question_knowledge,
            editor_ipc::search_questions,
            editor_ipc::question_metadata,
            editor_ipc::save_question_metadata,
            editor_ipc::add_paper_occurrence,
            editor_ipc::save_paper_metadata,
            favorites_ipc::favorite_collections,
            favorites_ipc::favorite_counts,
            favorites_ipc::favorite_status,
            favorites_ipc::favorite_page,
            favorites_ipc::change_favorites,
            favorites_ipc::change_favorite_collection,
            paper_reader_ipc::import_paper_pdf,
            paper_reader_ipc::list_paper_records,
            paper_reader_ipc::open_paper_pdf,
            paper_reader_ipc::paper_record_for_file,
            paper_reader_ipc::read_paper_chunk,
            paper_reader_ipc::close_paper_pdf,
            paper_reader_ipc::save_original_pdf,
            paper_reader_ipc::list_pdf_locations,
            paper_reader_ipc::link_paper_regions,
            paper_reader_ipc::open_region_question,
            paper_reader_ipc::show_source_print_dialog,
            resource_pack_ipc::select_resource_pack,
            resource_pack_ipc::install_resource_pack,
            resource_pack_ipc::cancel_resource_pack,
            resource_pack_ipc::discard_resource_pack,
            resource_pack_ipc::resource_pack_history,
            resource_pack_ipc::recover_resource_packs,
            protection_ipc::protection_status,
            protection_ipc::backup_history,
            protection_ipc::cancel_protection,
            protection_ipc::create_backup,
            protection_ipc::preview_restore,
            protection_ipc::discard_restore,
            protection_ipc::confirm_restore,
            protection_ipc::storage_estimate,
            protection_ipc::migrate_storage,
            protection_ipc::repair_library_layout,
            protection_ipc::rollback_library,
            protection_ipc::diagnose_library,
            draft_trash_ipc::list_drafts,
            draft_trash_ipc::put_draft,
            draft_trash_ipc::load_draft,
            draft_trash_ipc::hydrate_composition_draft,
            draft_trash_ipc::discard_draft,
            draft_trash_ipc::list_trash,
            draft_trash_ipc::trash_resource,
            draft_trash_ipc::restore_trash,
            draft_trash_ipc::clear_trash,
        ])
        .run(tauri::generate_context!())
        .expect("could not start POC-001B");
}
