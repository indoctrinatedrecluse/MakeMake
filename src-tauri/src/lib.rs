mod commands;
mod engine;
mod models;
mod sparse;


use std::sync::OnceLock;
use std::time::Duration;


use engine::TorrentEngine;
use tauri::Manager;

/// How often the engine writes a durability checkpoint (resume intent + state file).
const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(15);

/// Upper bound on the graceful shutdown sequence. Pausing a handful of swarms takes
/// milliseconds; this only exists so a wedged tracker can never trap the app open.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);

/// Upper bound on the seal attempted from inside the panic hook. The process is already
/// dying at that point, so this is the last chance to flush resume data, not a wait.
const PANIC_SEAL_TIMEOUT: Duration = Duration::from_secs(5);

/// The engine, reachable from the panic hook (which cannot touch Tauri state).
static ENGINE: OnceLock<TorrentEngine> = OnceLock::new();

/// Thread that called `run()`: a panic there is fatal (the event loop is gone), while a panic
/// in a background task only needs the session sealed.
static MAIN_THREAD: OnceLock<std::thread::ThreadId> = OnceLock::new();

/// Make a crash as safe as a clean exit.
///
/// A panic normally unwinds without pausing anything, which is precisely the state resume
/// data is written from. The hook therefore:
///
/// 1. logs the panic (so it lands in the log file next to the launches);
/// 2. tries to seal the session — pause every swarm, flush resume data — in a *separate*
///    thread (the panicking one may be a runtime worker, where blocking is not allowed),
///    waiting at most [`PANIC_SEAL_TIMEOUT`];
/// 3. exits the process when the panic came from the main thread, because the event loop
///    cannot recover. A background panic leaves the app running, with everything safely
///    paused.
///
/// The run marker stays on disk either way, so the next launch knows the exit was abrupt and
/// re-verifies the `.torrent` archive vault.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        previous(info);
        log::error!("fatal: {info}");

        let fatal = MAIN_THREAD
            .get()
            .map(|main| *main == std::thread::current().id())
            .unwrap_or(false);

        if let Some(engine) = ENGINE.get().cloned() {
            let (done, finished) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build();
                if let Ok(runtime) = runtime {
                    let _ = runtime.block_on(async {
                        tokio::time::timeout(PANIC_SEAL_TIMEOUT, engine.shutdown()).await
                    });
                }
                let _ = done.send(());
            });
            // Bounded wait: the seal gets a real chance without hanging the crash path.
            let _ = finished.recv_timeout(PANIC_SEAL_TIMEOUT);
        }

        if fatal {
            std::process::exit(101);
        }
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = MAIN_THREAD.set(std::thread::current().id());
    install_panic_hook();

    let engine = TorrentEngine::new();
    let _ = ENGINE.set(engine.clone());

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
            commands::inspect_destination,
            commands::parse_magnet_link,
            commands::parse_torrent_file,
            commands::open_folder,
            commands::get_system_stats,
            commands::get_torrent_disk_usage,
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
            let startup = app.state::<TorrentEngine>();
            if startup.crashed_last_run() {
                log::warn!(
                    "previous run ended without sealing its session: restored swarms are \
                     re-armed and the missing .torrent archives are rewritten"
                );
            }
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
            // Every ordinary exit path (title-bar X, Alt+F4, tray/OS close request) goes
            // through here: sleep the swarms, flush resume data, then actually quit.
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
        .build(tauri::generate_context!())
        .expect("error while building makemake application")
        .run(|app, event| {
            // `ExitRequested` is the path the window-close handler above cannot see: an OS
            // shutdown/logoff, `app.exit()` from anywhere else, or the final window being
            // destroyed. Without this the process could die with every swarm still live.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let engine = app.state::<TorrentEngine>();
                if !engine.begin_shutdown() {
                    // Already sealing (or sealed): let the exit through.
                    return;
                }
                api.prevent_exit();
                drop(engine);

                let app_task = app.clone();
                tauri::async_runtime::spawn(async move {
                    let engine = app_task.state::<TorrentEngine>();
                    match tokio::time::timeout(SHUTDOWN_TIMEOUT, engine.shutdown()).await {
                        Ok(Ok(())) => log::info!("session sealed on exit request"),
                        Ok(Err(err)) => log::warn!("exit-time shutdown reported an error: {err}"),
                        Err(_) => log::warn!("exit-time shutdown timed out; forcing exit"),
                    }
                    drop(engine);
                    app_task.exit(0);
                });
            }
        });
}
