mod commands;
mod engine;
mod models;

use engine::TorrentEngine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine = TorrentEngine::new();

    tauri::Builder::default()
        .manage(engine)
        .invoke_handler(tauri::generate_handler![
            commands::get_torrents,
            commands::get_settings,
            commands::update_settings,
            commands::start_torrent,
            commands::pause_torrent,
            commands::force_recheck,
            commands::backup_torrent_now,
            commands::delete_torrent,
            commands::add_torrent,
            commands::parse_magnet_link,
            commands::parse_torrent_file,
            commands::open_folder,
            commands::get_system_stats,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running makemake application");
}
