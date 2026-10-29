mod commands;
mod engine;
mod models;
mod sparse;


use std::time::Duration;


use engine::TorrentEngine;
use tauri::Manager;

/// How often the engine writes a durability checkpoint (resume intent + state file).
const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(15);

/// Upper bound on the graceful shutdown sequence. Pausing a handful of swarms takes
/// milliseconds; this only exists so a wedged tracker can never trap the app open.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine = TorrentEngine::new();

    tauri::Builder::default()
        .manage(engine)
        .invoke_handler(tauri::generate_handler![
            commands::get_torrents,
            commands::get_snapshot,
            commands::retry_pending,
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
            commands::pause_all,
            commands::resume_all,
            commands::set_priority,
            commands::set_file_selection,
            commands::get_torrent_peers,
            commands::export_torrent,
            commands::set_turtle_mode,
            commands::open_path,
            commands::reveal_path,
        ])
        .setup(|app| {
            app.handle().plugin(tauri_plugin_dialog::init())?;
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Debug)
                    .build(),
            )?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();

                #[cfg(debug_assertions)]
                {
                    if std::env::var("MAKEMAKE_DEVTOOLS").is_ok() {
                        let _ = window.open_devtools();
                    }
                }
            }

            // Durability loop: snapshot which swarms are live so even a hard kill
            // (power loss, task manager) knows what to re-arm on the next launch.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let engine = handle.state::<TorrentEngine>();
                let mut ticker = tokio::time::interval(CHECKPOINT_INTERVAL);
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                loop {
                    ticker.tick().await;
                    if engine.is_shutting_down() {
                        break;
                    }
                    engine.checkpoint().await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Every exit path (title-bar X, Alt+F4, tray/OS close request) goes through
            // here: sleep the swarms, flush resume data, then actually quit.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                let engine = app.state::<TorrentEngine>();

                if !engine.begin_shutdown() {
                    // Shutdown already in flight — swallow the duplicate request.
                    api.prevent_close();
                    return;
                }
                api.prevent_close();
                drop(engine);

                // Hide instantly so the close feels immediate while the seal runs.
                let _ = window.hide();

                let app_task = app.clone();
                tauri::async_runtime::spawn(async move {
                    let engine = app_task.state::<TorrentEngine>();
                    match tokio::time::timeout(SHUTDOWN_TIMEOUT, engine.shutdown()).await {
                        Ok(Ok(())) => log::info!("session sealed cleanly"),
                        Ok(Err(err)) => log::warn!("shutdown reported an error: {err}"),
                        Err(_) => log::warn!("shutdown timed out; forcing exit"),
                    }
                    drop(engine);
                    app_task.exit(0);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running makemake application");
}
