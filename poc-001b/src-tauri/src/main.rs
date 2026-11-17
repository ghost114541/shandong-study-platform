#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod editor_ipc;
#[cfg(windows)]
mod pdf;
mod storage;

use editor_ipc::DatabaseStartup;
use serde_json::Value;
use shandong_poc_001b::db::{Database, DbError, ErrorKind, DATABASE_FILENAME};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

fn data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("找不到应用数据目录：{err}"))
}

#[tauri::command]
fn load_questions(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    storage::load(&data_directory(&app)?.join("questions.json"))
}

#[tauri::command]
fn save_questions(app: tauri::AppHandle, data: Value) -> Result<PathBuf, String> {
    let path = data_directory(&app)?.join("questions.json");
    storage::save(&path, &data)?;
    Ok(path)
}

#[tauri::command]
async fn export_pdf(
    window: tauri::WebviewWindow,
    kind: String,
    long_sample: bool,
    revision_id: Option<i64>,
) -> Result<PathBuf, String> {
    let filename = match (kind.as_str(), long_sample, revision_id) {
        ("paper" | "answers", false, Some(id)) if id > 0 => {
            if editor_ipc::read_revision(window.app_handle().clone(), id)
                .await
                .map_err(|err| err.message)?
                .is_none()
            {
                return Err("PDF 引用的修订不存在。".into());
            }
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
        .setup(|app| {
            let status = app
                .path()
                .app_data_dir()
                .map_err(|err| DbError {
                    kind: ErrorKind::FileAccess,
                    message: format!("找不到数据库目录：{err}"),
                })
                .and_then(|directory| {
                    let db = Database::open(&directory.join(DATABASE_FILENAME))?;
                    let version = db.schema_version()?;
                    app.manage(Mutex::new(db));
                    Ok(version)
                });
            if let Err(error) = &status {
                eprintln!("SQLite 初始化失败：{error}");
            }
            app.manage(DatabaseStartup(status));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_questions,
            save_questions,
            export_pdf,
            editor_ipc::database_status,
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
        ])
        .run(tauri::generate_context!())
        .expect("could not start POC-001B");
}
