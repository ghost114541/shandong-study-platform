use crate::editor_ipc::database;
use serde_json::Value;
use shandong_poc_001b::db::{
    DraftRecord, DraftToken, DraftWrite, PaperDraft, PaperItem, Result, TrashItem, TrashKind,
};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_drafts(app: AppHandle) -> Result<Vec<DraftRecord>> {
    database(app, |db| db.drafts()).await
}

#[tauri::command]
pub async fn put_draft(app: AppHandle, draft: DraftWrite) -> Result<bool> {
    database(app, move |db| db.put_draft(&draft)).await
}

#[tauri::command]
pub async fn load_draft(app: AppHandle, id: String) -> Result<Value> {
    database(app, move |db| db.draft_payload(&id)).await
}

#[tauri::command]
pub async fn hydrate_composition_draft(
    app: AppHandle,
    draft: PaperDraft,
) -> Result<Vec<PaperItem>> {
    database(app, move |db| db.composition_draft_items(&draft)).await
}

#[tauri::command]
pub async fn discard_draft(
    app: AppHandle,
    token: DraftToken,
    kind: String,
    target: String,
) -> Result<()> {
    database(app, move |db| db.discard_draft(&token, &kind, &target)).await
}

#[tauri::command]
pub async fn list_trash(app: AppHandle) -> Result<Vec<TrashItem>> {
    database(app, |db| db.trash_items()).await
}

#[tauri::command]
pub async fn trash_resource(
    app: AppHandle,
    kind: TrashKind,
    id: String,
    operation: String,
) -> Result<()> {
    database(app, move |db| db.move_to_trash(kind, &id, &operation)).await
}

#[tauri::command]
pub async fn restore_trash(app: AppHandle, id: i64) -> Result<()> {
    database(app, move |db| db.restore_trash(id)).await
}

#[tauri::command]
pub async fn clear_trash(app: AppHandle) -> Result<()> {
    database(app, |db| db.clear_trash()).await
}
