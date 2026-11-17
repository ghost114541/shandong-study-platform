use serde::Serialize;
use shandong_poc_001b::db::{
    Database, DbError, ErrorKind, QuestionSummary, Result, Review, Revision, RevisionContent,
    RevisionSummary, Scope, Subject,
};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DatabaseStartup(pub Result<i32>);

#[tauri::command]
pub fn database_status(startup: tauri::State<'_, DatabaseStartup>) -> Result<i32> {
    startup.0.clone()
}

async fn database<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&mut Database) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<DatabaseStartup>().0.clone()?;
        let state = app.state::<Mutex<Database>>();
        let mut db = state.lock().map_err(database_error)?;
        action(&mut db)
    })
    .await
    .map_err(database_error)?
}

fn database_error(error: impl std::fmt::Display) -> DbError {
    DbError {
        kind: ErrorKind::Sqlite,
        message: format!("数据库访问失败：{error}"),
    }
}

#[derive(Serialize)]
pub struct RevisionDetail {
    revision: Revision,
    review: Option<Review>,
}

fn detail(db: &Database, revision: Option<Revision>) -> Result<Option<RevisionDetail>> {
    revision
        .map(|revision| {
            let review = db.latest_review(revision.id)?;
            Ok(RevisionDetail { revision, review })
        })
        .transpose()
}

#[tauri::command]
pub async fn list_subjects(app: AppHandle) -> Result<Vec<Subject>> {
    database(app, |db| db.subjects()).await
}

#[tauri::command]
pub async fn list_questions(app: AppHandle) -> Result<Vec<QuestionSummary>> {
    database(app, |db| db.questions()).await
}

#[tauri::command]
pub async fn list_revisions(app: AppHandle, question_id: String) -> Result<Vec<RevisionSummary>> {
    database(app, move |db| db.revisions(&question_id)).await
}

#[tauri::command]
pub async fn current_revision(
    app: AppHandle,
    question_id: String,
) -> Result<Option<RevisionDetail>> {
    database(app, move |db| {
        detail(db, db.current_revision(&question_id)?)
    })
    .await
}

#[tauri::command]
pub async fn public_original(
    app: AppHandle,
    question_id: String,
) -> Result<Option<RevisionDetail>> {
    database(app, move |db| detail(db, db.public_original(&question_id)?)).await
}

#[tauri::command]
pub async fn read_revision(app: AppHandle, revision_id: i64) -> Result<Option<RevisionDetail>> {
    database(app, move |db| detail(db, db.revision(revision_id)?)).await
}

#[tauri::command]
pub async fn create_question(
    app: AppHandle,
    question_id: String,
    subject_id: String,
    content_json: String,
) -> Result<Revision> {
    database(app, move |db| {
        let content = RevisionContent::from_json(&content_json)?;
        let id = db.create_question_with_revision(&question_id, &subject_id, &content)?;
        Ok(Revision {
            id,
            question_id,
            base_revision_id: None,
            scope: Scope::User,
            content,
        })
    })
    .await
}

#[tauri::command]
pub async fn save_user_revision(
    app: AppHandle,
    question_id: String,
    expected_current: Option<i64>,
    content_json: String,
) -> Result<Revision> {
    database(app, move |db| {
        let content = RevisionContent::from_json(&content_json)?;
        let id = db.append_user_revision(&question_id, expected_current, &content)?;
        Ok(Revision {
            id,
            question_id,
            base_revision_id: expected_current,
            scope: Scope::User,
            content,
        })
    })
    .await
}
