use tauri::State;
use std::process::Command;

use crate::engine::TorrentEngine;
use crate::models::{
    BackupResult, ClientSettings, PeerDetail, SystemStats, TorrentItem, TorrentMetadataPreview,
};

#[tauri::command]
pub async fn get_torrents(engine: State<'_, TorrentEngine>) -> Result<Vec<TorrentItem>, String> {
    engine.get_torrents().await
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
    engine.start_torrent(&id).await
}

#[tauri::command]
pub async fn pause_torrent(id: String, engine: State<'_, TorrentEngine>) -> Result<(), String> {
    engine.pause_torrent(&id).await
}

#[tauri::command]
pub async fn force_recheck(id: String, engine: State<'_, TorrentEngine>) -> Result<(), String> {
    engine.force_recheck(&id).await
}

#[tauri::command]
pub async fn backup_torrent_now(
    id: String,
    engine: State<'_, TorrentEngine>,
) -> Result<BackupResult, String> {
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
    engine.add_torrent(preview, target_dir).await
}

#[tauri::command]
pub async fn parse_magnet_link(
    magnet_uri: String,
    engine: State<'_, TorrentEngine>,
) -> Result<TorrentMetadataPreview, String> {
    engine.parse_magnet_link(&magnet_uri).await
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

#[tauri::command]
pub async fn pause_all(engine: State<'_, TorrentEngine>) -> Result<(), String> {
    engine.pause_all().await
}

#[tauri::command]
pub async fn resume_all(engine: State<'_, TorrentEngine>) -> Result<(), String> {
    engine.resume_all().await
}

#[tauri::command]
pub async fn set_priority(
    id: String,
    priority: String,
    engine: State<'_, TorrentEngine>,
) -> Result<(), String> {
    engine.set_priority(&id, &priority).await
}

#[tauri::command]
pub async fn set_file_selection(
    id: String,
    files: Vec<usize>,
    engine: State<'_, TorrentEngine>,
) -> Result<(), String> {
    engine.set_file_selection(&id, files).await
}

#[tauri::command]
pub async fn get_torrent_peers(
    id: String,
    engine: State<'_, TorrentEngine>,
) -> Result<Vec<PeerDetail>, String> {
    engine.get_torrent_peers(&id).await
}

#[tauri::command]
pub async fn export_torrent(
    id: String,
    path: String,
    engine: State<'_, TorrentEngine>,
) -> Result<BackupResult, String> {
    engine.export_torrent(&id, &path).await
}

#[tauri::command]
pub async fn set_turtle_mode(
    enabled: bool,
    engine: State<'_, TorrentEngine>,
) -> Result<ClientSettings, String> {
    engine.set_turtle_mode(enabled).await
}

/// Open a file or folder in the OS file manager.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("no path given".to_string());
    }

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

/// Show a path inside its parent folder (Explorer "select" behaviour).
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("no path given".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
