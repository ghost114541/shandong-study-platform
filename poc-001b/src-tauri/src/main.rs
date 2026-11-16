#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;
#[cfg(windows)]
mod pdf;

use serde_json::Value;
use shandong_poc_001b::db::{Database, DbError, ErrorKind, DATABASE_FILENAME};
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::Manager;

fn data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|err| format!("找不到应用数据目录：{err}"))
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
) -> Result<PathBuf, String> {
    let filename = match (kind.as_str(), long_sample) {
        ("paper", false) => "paper.pdf",
        ("paper", true) => "paper-long.pdf",
        ("answers", _) => "answers.pdf",
        _ => return Err("请先打开题卷或答案卷预览。".into()),
    };
    let destination = data_directory(window.app_handle())?.join("pdf").join(filename);
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

struct DatabaseStartup(Result<i32, DbError>);

#[tauri::command]
fn database_status(startup: tauri::State<'_, DatabaseStartup>) -> Result<i32, DbError> {
    startup.0.clone()
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
        .invoke_handler(tauri::generate_handler![load_questions, save_questions, export_pdf, database_status])
        .run(tauri::generate_context!())
        .expect("could not start POC-001B");
}
