use tauri::State;
use std::process::Command;

use crate::engine::TorrentEngine;
use crate::models::{ClientSettings, SystemStats, TorrentItem, TorrentMetadataPreview};

#[tauri::command]
pub async fn get_torrents(engine: State<'_, TorrentEngine>) -> Result<Vec<TorrentItem>, String> {
    Ok(engine.get_torrents().await)
}

#[tauri::command]
pub async fn get_settings(engine: State<'_, TorrentEngine>) -> Result<ClientSettings, String> {
    Ok(engine.get_settings().await)
}

#[tauri::command]
pub async fn update_settings(
    settings: ClientSettings,
    engine: State<'_, TorrentEngine>,
) -> Result<ClientSettings, String> {
    Ok(engine.update_settings(settings).await)
}

#[tauri::command]
pub async fn start_torrent(id: String, engine: State<'_, TorrentEngine>) -> Result<(), String> {
    engine.start_torrent(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn pause_torrent(id: String, engine: State<'_, TorrentEngine>) -> Result<(), String> {
    engine.pause_torrent(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn force_recheck(id: String, engine: State<'_, TorrentEngine>) -> Result<(), String> {
    engine.force_recheck(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn backup_torrent_now(
    id: String,
    engine: State<'_, TorrentEngine>,
) -> Result<String, String> {
    engine.backup_torrent_now(&id).await
}

#[tauri::command]
pub async fn delete_torrent(
    id: String,
    delete_files: bool,
    engine: State<'_, TorrentEngine>,
) -> Result<(), String> {
    engine.delete_torrent(&id, delete_files).await
}

#[tauri::command]
pub async fn add_torrent(
    preview: TorrentMetadataPreview,
    target_dir: String,
    engine: State<'_, TorrentEngine>,
) -> Result<TorrentItem, String> {
    Ok(engine.add_torrent(preview, target_dir).await)
}

#[tauri::command]
pub fn parse_magnet_link(magnet_uri: String) -> Result<TorrentMetadataPreview, String> {
    TorrentEngine::parse_magnet_link(&magnet_uri)
}

#[tauri::command]
pub fn parse_torrent_file(
    file_name: String,
    content_base64: String,
) -> Result<TorrentMetadataPreview, String> {
    TorrentEngine::parse_torrent_file(&file_name, &content_base64)
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_system_stats(engine: State<'_, TorrentEngine>) -> Result<SystemStats, String> {
    Ok(engine.get_system_stats().await)
}
