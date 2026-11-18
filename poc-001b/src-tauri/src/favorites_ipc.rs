use crate::editor_ipc::database;
use shandong_poc_001b::db::{
    CollectionCommand, FavoriteCollection, FavoriteCommand, FavoriteCounts, FavoritePage,
    FavoriteQuery, FavoriteRef, FavoriteStatus, Result,
};
use tauri::AppHandle;

#[tauri::command]
pub async fn favorite_collections(app: AppHandle) -> Result<Vec<FavoriteCollection>> {
    database(app, |db| db.favorite_collections()).await
}

#[tauri::command]
pub async fn favorite_counts(app: AppHandle) -> Result<FavoriteCounts> {
    database(app, |db| db.favorite_counts()).await
}

#[tauri::command]
pub async fn favorite_status(
    app: AppHandle,
    targets: Vec<FavoriteRef>,
) -> Result<Vec<FavoriteStatus>> {
    database(app, move |db| db.favorite_statuses(&targets)).await
}

#[tauri::command]
pub async fn favorite_page(app: AppHandle, query: FavoriteQuery) -> Result<FavoritePage> {
    database(app, move |db| db.favorite_page(&query)).await
}

#[tauri::command]
pub async fn change_favorites(app: AppHandle, command: FavoriteCommand) -> Result<()> {
    database(app, move |db| db.change_favorites(command)).await
}

#[tauri::command]
pub async fn change_favorite_collection(app: AppHandle, command: CollectionCommand) -> Result<()> {
    database(app, move |db| db.change_favorite_collection(command)).await
}
