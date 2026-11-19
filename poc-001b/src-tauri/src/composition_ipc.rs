use crate::editor_ipc::database;
use shandong_poc_001b::db::{PaperDraft, PaperHeader, PaperQuestion, Result, SavedPaper};
use tauri::AppHandle;

#[tauri::command]
pub async fn composition_question(
    app: AppHandle,
    revision_id: i64,
    existing: Vec<i64>,
) -> Result<PaperQuestion> {
    database(app, move |db| {
        db.select_paper_question(revision_id, &existing)
    })
    .await
}

#[tauri::command]
pub async fn composition_latest(app: AppHandle, question_id: String) -> Result<PaperQuestion> {
    database(app, move |db| db.latest_paper_question(&question_id)).await
}

#[tauri::command]
pub async fn list_compositions(app: AppHandle) -> Result<Vec<PaperHeader>> {
    database(app, |db| db.list_papers()).await
}

#[tauri::command]
pub async fn read_composition(app: AppHandle, id: String) -> Result<SavedPaper> {
    database(app, move |db| db.load_paper(&id)).await
}

#[tauri::command]
pub async fn save_composition(
    app: AppHandle, draft: PaperDraft, draft_token: Option<shandong_poc_001b::db::DraftToken>,
) -> Result<SavedPaper> {
    database(app, move |db| db.create_paper_and_close_draft(&draft, draft_token.as_ref())).await
}
