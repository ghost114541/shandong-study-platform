use serde::Serialize;
use shandong_poc_001b::db::{
    Database, DbError, ErrorKind, KnowledgePoint, QuestionSummary, Result, Review, ReviewStatus,
    Revision, RevisionContent, RevisionSummary, Scope, SearchPage, SearchQuery, Subject,
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
    #[serde(flatten)]
    evaluation: RevisionReview,
}

#[derive(Serialize)]
pub struct RevisionReview {
    review: Option<Review>,
    review_status: ReviewStatus,
}

fn evaluate_review(db: &Database, id: i64) -> Result<RevisionReview> {
    let (review_status, review) = db.review_today(id)?;
    Ok(RevisionReview {
        review,
        review_status,
    })
}

fn detail(db: &Database, revision: Option<Revision>) -> Result<Option<RevisionDetail>> {
    revision
        .map(|revision| {
            Ok(RevisionDetail {
                evaluation: evaluate_review(db, revision.id)?,
                revision,
            })
        })
        .transpose()
}

#[tauri::command]
pub async fn revision_review(app: AppHandle, revision_id: i64) -> Result<RevisionReview> {
    database(app, move |db| evaluate_review(db, revision_id)).await
}

#[tauri::command]
pub async fn list_subjects(app: AppHandle) -> Result<Vec<Subject>> {
    database(app, |db| db.subjects()).await
}

#[tauri::command]
pub async fn list_questions(app: AppHandle, limit: Option<u32>) -> Result<Vec<QuestionSummary>> {
    database(app, move |db| match limit {
        Some(limit) => db.recent_questions(i64::from(limit.min(100))),
        None => db.questions(),
    })
    .await
}

#[tauri::command]
pub async fn list_knowledge(app: AppHandle, subject_id: String) -> Result<Vec<KnowledgePoint>> {
    database(app, move |db| db.knowledge_points(&subject_id)).await
}

#[tauri::command]
pub async fn create_knowledge(
    app: AppHandle,
    id: String,
    subject_id: String,
    parent_id: Option<String>,
    title: String,
    sort_order: i32,
) -> Result<()> {
    database(app, move |db| {
        db.create_user_knowledge(&id, &subject_id, parent_id.as_deref(), &title, sort_order)
    })
    .await
}

#[tauri::command]
pub async fn rename_knowledge(app: AppHandle, id: String, title: String) -> Result<()> {
    database(app, move |db| db.rename_user_knowledge(&id, &title)).await
}

#[tauri::command]
pub async fn add_knowledge_alias(app: AppHandle, id: String, alias: String) -> Result<()> {
    database(app, move |db| db.add_knowledge_alias(&id, &alias)).await
}

#[tauri::command]
pub async fn question_knowledge(app: AppHandle, question_id: String) -> Result<Vec<String>> {
    database(app, move |db| db.question_knowledge_ids(&question_id)).await
}

#[tauri::command]
pub async fn question_knowledge_links(
    app: AppHandle,
    question_id: String,
) -> Result<Vec<shandong_poc_001b::db::KnowledgeLink>> {
    database(app, move |db| db.question_knowledge_links(&question_id)).await
}

#[tauri::command]
pub async fn set_question_knowledge(
    app: AppHandle,
    question_id: String,
    id: String,
    linked: bool,
) -> Result<()> {
    database(app, move |db| {
        db.set_question_knowledge(&question_id, &id, linked)
    })
    .await
}

#[tauri::command]
pub async fn search_questions(app: AppHandle, query: SearchQuery) -> Result<SearchPage> {
    database(app, move |db| db.search_questions(&query)).await
}

#[tauri::command]
pub async fn question_metadata(
    app: AppHandle,
    question_id: String,
) -> Result<shandong_poc_001b::db::QuestionMetadata> {
    database(app, move |db| db.question_metadata(&question_id)).await
}

#[tauri::command]
pub async fn save_question_metadata(
    app: AppHandle,
    question_id: String,
    difficulty: Option<u8>,
    tags: Vec<String>,
) -> Result<()> {
    database(app, move |db| {
        db.save_question_metadata(&question_id, difficulty, &tags)
    })
    .await
}

#[tauri::command]
pub async fn add_paper_occurrence(
    app: AppHandle,
    question_id: String,
    paper_id: String,
    title: Option<String>,
    position: String,
) -> Result<()> {
    database(app, move |db| {
        db.add_paper_occurrence(&question_id, &paper_id, title.as_deref(), &position)
    })
    .await
}

#[tauri::command]
pub async fn save_paper_metadata(
    app: AppHandle,
    paper_id: String,
    metadata: shandong_poc_001b::db::PaperMetadata,
) -> Result<()> {
    database(app, move |db| db.save_paper_metadata(&paper_id, &metadata)).await
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
