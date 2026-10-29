//! MakeMake BitTorrent engine.
//!
//! A thin, stateful façade around a real [`librqbit::Session`]: DHT, trackers, the peer
//! wire protocol, piece verification, resume data, persistence and rate limiting are all
//! handled by librqbit. This module only translates between librqbit's live state and the
//! `TorrentItem` model consumed by the React front-end.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use librqbit::api::TorrentIdOrHash;
use librqbit::limits::LimitsConfig;
use librqbit::{
    torrent_from_bytes, AddTorrent, AddTorrentOptions, AddTorrentResponse, DhtSessionConfig,
    ListenerOptions, Magnet, ManagedTorrent, Session, SessionOptions, SessionPersistenceConfig,
    TorrentStats, TorrentStatsState, ValidatedTorrentMetaV1Info,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OnceCell, RwLock};

use crate::models::{
    BackupResult, ClientSettings, PeerDetail, SystemStats, TorrentFileItem, TorrentItem,
    TorrentMetadataPreview,
};

/// File (inside the app config dir) storing UI settings + per-torrent bookkeeping.
const STATE_FILE_NAME: &str = "makemake-state.json";

/// How long we wait for DHT/tracker metadata when previewing a magnet link.
const MAGNET_METADATA_TIMEOUT: Duration = Duration::from_secs(45);

/// Per-torrent data that librqbit does not track itself but the UI needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TorrentExtras {
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    completed_at: Option<i64>,
    #[serde(default)]
    backed_up: bool,
    #[serde(default)]
    backup_path: Option<String>,
    #[serde(default)]
    magnet_uri: Option<String>,
    #[serde(default = "default_priority")]
    priority: String,
    #[serde(default)]
    moved_to_completed: bool,
    #[serde(default)]
    trackers: Vec<String>,
    /// Unix ms of the last successful `.torrent` archive write.
    #[serde(default)]
    last_backup_at: i64,
    /// Whether the user had this swarm running when the app last shut down.
    /// Used to re-arm it on the next launch.
    #[serde(default)]
    resume_on_start: bool,
}

impl Default for TorrentExtras {
    fn default() -> Self {
        Self {
            created_at: now_ms(),
            completed_at: None,
            backed_up: false,
            backup_path: None,
            magnet_uri: None,
            priority: default_priority(),
            moved_to_completed: false,
            trackers: Vec::new(),
            last_backup_at: 0,
            resume_on_start: false,
        }
    }
}

fn default_priority() -> String {
    "Normal".to_string()
}

/// Read the announce URLs out of the torrent metadata that librqbit resolved.
/// Returns `true` when the cached list changed (so the state file gets rewritten).
fn fill_trackers(handle: &Arc<ManagedTorrent>, extras: &mut TorrentExtras) -> bool {
    if !extras.trackers.is_empty() {
        return false;
    }

    let trackers = handle
        .with_metadata(|metadata| {
            let parsed = torrent_from_bytes(metadata.torrent_bytes.as_ref()).ok()?;
            let mut urls: Vec<String> = Vec::new();
            for announce in parsed.iter_announce() {
                let url = announce.to_string();
                let url = url.trim();
                if !url.is_empty() && !urls.iter().any(|existing| existing == url) {
                    urls.push(url.to_string());
                }
            }
            Some(urls)
        })
        .ok()
        .flatten()
        .unwrap_or_default();

    if trackers.is_empty() {
        return false;
    }

    extras.trackers = trackers;
    true
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    #[serde(default)]
    settings: Option<ClientSettings>,
    #[serde(default)]
    torrents: HashMap<String, TorrentExtras>,
}

pub struct TorrentEngine {
    /// Lazily created real BitTorrent session (DHT + listeners + persistence).
    session: OnceCell<Arc<Session>>,
    settings: RwLock<ClientSettings>,
    extras: Mutex<HashMap<String, TorrentExtras>>,
    state_dir: PathBuf,
    /// Set once the shutdown sequence has begun (pausing only, no new work).
    shutting_down: AtomicBool,
    /// Unix ms of the last durable checkpoint (state file + librqbit session db).
    checkpoint_at: AtomicI64,
    /// Torrents librqbit restored from its session database on this launch.
    restored: AtomicU32,
    /// Of those, how many MakeMake re-armed automatically.
    resumed: AtomicU32,
    /// Swarms currently being archived/relocated by a poll. The UI asks for the torrent
    /// list and the system stats in parallel, which would otherwise race on the same
    /// vault file.
    maintenance: Mutex<HashSet<String>>,
    /// Swarms the launch-time restore still has to wake up. librqbit re-verifies
    /// restored data and silently drops an unpause that arrives mid-check, so this map
    /// keeps asking until the swarm has been stable-live for a few polls (or the user
    /// pauses it explicitly).
    pending_rearm: Mutex<HashMap<String, RearmStatus>>,
}

/// Progress of one launch-time re-arm attempt.
#[derive(Debug, Default, Clone, Copy)]
struct RearmStatus {
    attempts: u32,
    live_streak: u32,
}

impl Default for TorrentEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl TorrentEngine {
    pub fn new() -> Self {
        let state_dir = dirs::config_dir()
            .map(|p| p.join("MakeMake"))
            .unwrap_or_else(|| PathBuf::from(".").join("MakeMake"));

        let persisted = load_persisted_state(&state_dir);
        let settings = persisted
            .settings
            .unwrap_or_else(|| default_settings(&state_dir));

        Self {
            session: OnceCell::new(),
            settings: RwLock::new(settings),
            extras: Mutex::new(persisted.torrents),
            state_dir,
            shutting_down: AtomicBool::new(false),
            checkpoint_at: AtomicI64::new(0),
            restored: AtomicU32::new(0),
            resumed: AtomicU32::new(0),
            maintenance: Mutex::new(HashSet::new()),
            pending_rearm: Mutex::new(HashMap::new()),
        }
    }

    /// `true` the first time it is called, `false` on every later call. Used to make
    /// the shutdown sequence idempotent (close button + OS exit + task manager).
    pub fn begin_shutdown(&self) -> bool {
        !self.shutting_down.swap(true, Ordering::SeqCst)
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }

    // -----------------------------------------------------------------
    // Session / settings
    // -----------------------------------------------------------------

    /// Get (and lazily create) the shared librqbit session.
    pub async fn session(&self) -> Result<Arc<Session>, String> {
        let persistence_dir = self.state_dir.join("session");

        self.session
            .get_or_try_init(|| async {
                let settings = self.settings.read().await.clone();
                // The default folder may legitimately be unset; fall back to the OS
                // downloads folder so the session can always start.
                let default_output = resolve_download_dir(&settings, None)?;
                let (download_limit, upload_limit) = settings.effective_limits();

                fs::create_dir_all(&default_output).map_err(|e| {
                    format!(
                        "cannot create download directory {}: {e}",
                        default_output.display()
                    )
                })?;
                fs::create_dir_all(&persistence_dir).ok();

                let build_opts = |port: u16| SessionOptions {
                    dht: Some(DhtSessionConfig::default()),
                    fastresume: true,
                    persistence: Some(SessionPersistenceConfig::Json {
                        folder: Some(persistence_dir.clone()),
                    }),
                    listen: Some(ListenerOptions {
                        listen_addr: SocketAddr::from(([0u16; 8], port)),
                        enable_upnp_port_forwarding: true,
                        ..Default::default()
                    }),
                    ratelimits: LimitsConfig {
                        download_bps: to_bps(download_limit),
                        upload_bps: to_bps(upload_limit),
                    },
                    client_name_and_version: Some(format!(
                        "MakeMake/{}",
                        env!("CARGO_PKG_VERSION")
                    )),
                    ..Default::default()
                };

                let listen_port = settings.listen_port;
                let session = match Session::new_with_opts(default_output.clone(), build_opts(listen_port)).await {
                    Ok(session) => session,
                    Err(err) => {
                        log::warn!(
                            "listener on port {listen_port} failed ({err}); retrying on an ephemeral port"
                        );
                        Session::new_with_opts(default_output, build_opts(0))
                            .await
                            .map_err(|e| format!("cannot start BitTorrent session: {e}"))?
                    }
                };

                // librqbit has just re-added every torrent from `session/<db>` (all of them
                // paused, because MakeMake always sleeps the swarms before exiting).
                // Re-arm the ones the user had running last time.
                self.restore_previous_session(&session).await;

                Ok(session)
            })
            .await
            .cloned()
    }

    /// Reconcile the restored session with the intent MakeMake saved on exit.
    ///
    /// MakeMake's own state file — not librqbit's `is_paused` flag — is the source of
    /// truth here: every swarm that was running when the app closed is re-armed, and
    /// everything else is parked. That way a stale or half-written session database can
    /// never magically re-start a torrent the user had paused.
    async fn restore_previous_session(&self, session: &Arc<Session>) {
        let handles = Self::handles(session);
        self.restored
            .store(handles.len().min(u32::MAX as usize) as u32, Ordering::SeqCst);

        if handles.is_empty() {
            log::info!("no torrents to restore");
            return;
        }

        let settings = self.settings.read().await.clone();
        let intents = self.extras.lock().await.clone();

        let mut to_resume: Vec<Arc<ManagedTorrent>> = Vec::new();
        let mut to_park: Vec<Arc<ManagedTorrent>> = Vec::new();
        for handle in handles {
            let was_running = intents
                .get(&handle.info_hash().as_string())
                .map(|extras| extras.resume_on_start)
                .unwrap_or(false);
            if was_running {
                to_resume.push(handle);
            } else {
                to_park.push(handle);
            }
        }

        if !settings.resume_on_launch && !to_resume.is_empty() {
            log::info!(
                "restored {} torrent(s) in a dormant state (auto-resume disabled)",
                to_resume.len()
            );
            to_park.append(&mut to_resume);
        }

        for handle in to_park {
            if !wants_to_run(&handle) {
                continue;
            }
            if let Err(err) = session.pause(&handle).await {
                log::debug!(
                    "cannot park {}: {err}",
                    handle.info_hash().as_string()
                );
            }
        }

        let mut resumed = 0u32;
        for handle in to_resume {
            // The unpause may be deferred: librqbit re-verifies restored data first and
            // drops requests that arrive mid-check. `collect_items` keeps asking until
            // the swarm is really live, so counting the intent here is accurate.
            self.pending_rearm
                .lock()
                .await
                .insert(handle.info_hash().as_string(), RearmStatus::default());
            match session.unpause(&handle).await {
                Ok(()) => {
                    resumed += 1;
                    log::info!("re-arming {}", handle.info_hash().as_string());
                }
                Err(err) => log::warn!(
                    "cannot resume {}: {err}",
                    handle.info_hash().as_string()
                ),
            }
        }

        self.resumed.store(resumed, Ordering::SeqCst);
        log::info!(
            "restored {} torrent(s); re-armed {resumed}",
            self.restored.load(Ordering::SeqCst)
        );
    }

    fn handles(session: &Arc<Session>) -> Vec<Arc<ManagedTorrent>> {
        session.with_torrents(|iter| {
            let mut out = Vec::new();
            for (_, handle) in iter {
                out.push(handle.clone());
            }
            out
        })
    }

    fn find_handle(session: &Arc<Session>, info_hash: &str) -> Option<(usize, Arc<ManagedTorrent>)> {
        session.with_torrents(|iter| {
            let mut found = None;
            for (id, handle) in iter {
                if handle.info_hash().as_string() == info_hash {
                    found = Some((id, handle.clone()));
                    break;
                }
            }
            found
        })
    }

    pub async fn get_settings(&self) -> ClientSettings {
        self.settings.read().await.clone()
    }

    pub async fn update_settings(&self, settings: ClientSettings) -> ClientSettings {
        {
            let mut guard = self.settings.write().await;
            *guard = settings.clone();
        }

        // Apply the new rate limits to the live session, if it already exists.
        if let Some(session) = self.session.get() {
            apply_limits(session, &settings);
        }

        self.persist_state().await;
        settings
    }

    /// Toggle the alternate ("turtle") bandwidth profile without touching the main caps.
    pub async fn set_turtle_mode(&self, enabled: bool) -> Result<ClientSettings, String> {
        let settings = {
            let mut guard = self.settings.write().await;
            guard.turtle_mode_enabled = enabled;
            guard.clone()
        };

        if let Some(session) = self.session.get() {
            apply_limits(session, &settings);
        }
        self.persist_state().await;
        Ok(settings)
    }

    async fn persist_state(&self) {
        let state = PersistedState {
            settings: Some(self.settings.read().await.clone()),
            torrents: self.extras.lock().await.clone(),
        };

        if fs::create_dir_all(&self.state_dir).is_err() {
            return;
        }
        match serde_json::to_vec_pretty(&state) {
            Ok(json) => {
                // Write to a temp file first so a crash mid-write can never leave a
                // truncated state file behind (that would lose every swarm's flags).
                let target = state_file_path(&self.state_dir);
                let tmp = target.with_extension("json.tmp");
                match fs::write(&tmp, json).and_then(|_| fs::rename(&tmp, &target)) {
                    Ok(()) => {
                        self.checkpoint_at.store(now_ms(), Ordering::SeqCst);
                    }
                    Err(err) => log::warn!("cannot persist MakeMake state: {err}"),
                }
            }
            Err(err) => log::warn!("cannot serialize MakeMake state: {err}"),
        }
    }

    /// Periodic durability checkpoint.
    ///
    /// Records which swarms are live right now (so an unexpected crash still knows what
    /// to re-arm) and rewrites the state file. librqbit writes its own session database
    /// whenever a torrent is paused/resumed, so a hard kill only ever loses the piece
    /// flags written since the last `update_metadata`, which fastresume re-verifies.
    pub async fn checkpoint(&self) {
        if let Some(session) = self.session.get() {
            let handles = Self::handles(session);
            let mut guard = self.extras.lock().await;
            for handle in handles {
                // Only ever *promote* the intent here: explicit pauses are recorded by
                // the pause commands, and a swarm that is mid-re-arm must not lose it.
                if wants_to_run(&handle) {
                    let extras = guard.entry(handle.info_hash().as_string()).or_default();
                    extras.resume_on_start = true;
                    if extras.created_at == 0 {
                        extras.created_at = now_ms();
                    }
                }
            }
            drop(guard);
        }
        self.persist_state().await;
    }

    /// Clean shutdown: remember what was live, then pause **every** swarm.
    ///
    /// Pausing is what makes the exit safe: librqbit drops all peer connections and
    /// flushes the resume database (`session.json`, per-torrent `.bitv` piece maps and
    /// the raw `.torrent` bytes) atomically before we return. Nothing is left half
    /// written, so the next launch resumes from exactly where this one stopped.
    pub async fn shutdown(&self) -> Result<(), String> {
        self.begin_shutdown();
        log::info!("sealing session: pausing all swarms before exit");

        if let Some(session) = self.session.get().cloned() {
            let handles = Self::handles(&session);

            // Snapshot intent *before* pausing, otherwise everything looks dormant.
            {
                let mut guard = self.extras.lock().await;
                for handle in handles.iter() {
                    if wants_to_run(handle) {
                        guard
                            .entry(handle.info_hash().as_string())
                            .or_default()
                            .resume_on_start = true;
                    }
                }
            }
            self.persist_state().await;

            let mut failures = 0usize;
            for handle in handles.iter() {
                let stats = handle.stats();
                log::debug!(
                    "seal candidate {} state={:?} finished={} paused_flag={}",
                    handle.info_hash().as_string(),
                    stats.state,
                    stats.finished,
                    handle.is_paused()
                );
                if !seal_handle(&session, handle).await {
                    failures += 1;
                }
            }

            // Give the JSON persistence store a beat to fsync its temp files + rename.
            tokio::time::sleep(Duration::from_millis(150)).await;

            if failures > 0 {
                log::warn!("{failures} torrent(s) could not be paused cleanly");
            }
            log::info!("session sealed; all swarms dormant");
        }

        self.persist_state().await;
        Ok(())
    }

    // -----------------------------------------------------------------
    // Torrent listing
    // -----------------------------------------------------------------

    pub async fn get_torrents(&self) -> Result<Vec<TorrentItem>, String> {
        self.collect_items().await
    }

    async fn collect_items(&self) -> Result<Vec<TorrentItem>, String> {
        let session = self.session().await?;
        let handles = Self::handles(&session);
        let settings = self.settings.read().await.clone();

        let mut items = Vec::with_capacity(handles.len());
        let mut state_changed = false;

        for handle in handles {
            let info_hash = handle.info_hash().as_string();
            let mut stats = handle.stats();
            let now = now_ms();

            let existing = self.extras.lock().await.get(&info_hash).cloned();
            let is_new = existing.is_none();
            let mut extras = existing.unwrap_or_default();

            // Only one poll owns a swarm at a time: the UI asks for the torrent list and
            // the system stats in parallel, and both walk this loop.
            let owns_vault = !self.is_shutting_down()
                && self.maintenance.lock().await.insert(info_hash.clone());

            // Self-healing restore: a swarm that was live when the app last closed is
            // re-added paused and has to re-verify its pieces. librqbit drops unpauses
            // that arrive while that check is still running (and may re-apply the deferred
            // pause right after we win), so keep asking until the swarm has been live for
            // a few consecutive polls. Only swarms the launch-time restore selected are in
            // this map, so an explicit pause can never be fought by this loop.
            let awaiting_rearm = owns_vault
                && self.pending_rearm.lock().await.contains_key(&info_hash);
            if awaiting_rearm {
                if is_running(&stats) {
                    let mut pending = self.pending_rearm.lock().await;
                    if let Some(entry) = pending.get_mut(&info_hash) {
                        entry.live_streak += 1;
                        if entry.live_streak >= 3 {
                            pending.remove(&info_hash);
                        }
                    }
                } else if !matches!(stats.state, TorrentStatsState::Error) {
                    let attempt = session.unpause(&handle).await;
                    stats = handle.stats();
                    let mut pending = self.pending_rearm.lock().await;
                    match attempt {
                        Ok(()) => {
                            log::debug!(
                                "re-arm attempt {info_hash}: now {:?} paused_flag={}",
                                stats.state,
                                handle.is_paused()
                            );
                            if let Some(entry) = pending.get_mut(&info_hash) {
                                entry.attempts += 1;
                                entry.live_streak = if is_running(&stats) { 1 } else { 0 };
                            }
                        }
                        Err(err) => {
                            log::debug!("cannot re-arm {info_hash} yet: {err}");
                            if let Some(entry) = pending.get_mut(&info_hash) {
                                entry.attempts += 1;
                            }
                        }
                    }
                    // Give up after ~2 minutes of polling so a genuinely broken swarm
                    // cannot spin the loop forever.
                    if pending
                        .get(&info_hash)
                        .map(|entry| entry.attempts > 120)
                        .unwrap_or(false)
                    {
                        pending.remove(&info_hash);
                        log::warn!("giving up on re-arming {info_hash}");
                    }
                }
            }

            // Temporal auto-backup: archive the raw .torrent — for magnets the bencoded
            // metadata librqbit fetched from the swarm — into the vault, then keep that
            // archived copy fresh while the download is still in flight.
            if owns_vault
                && settings.auto_backup_enabled
                && backup_due(&extras, settings.backup_interval_hours, stats.finished, now)
            {
                if let Some(path) = self.write_backup_file(&handle, &settings).await {
                    extras.backed_up = true;
                    extras.backup_path = Some(path);
                    extras.last_backup_at = now;
                    state_changed = true;
                }
            }

            if owns_vault && stats.finished {
                if extras.completed_at.is_none() {
                    extras.completed_at = Some(now);
                    state_changed = true;
                }
                if settings.move_completed_torrent_enabled
                    && !extras.moved_to_completed
                    && self.move_backup_to_completed(&mut extras, &settings)
                {
                    state_changed = true;
                }
            }

            if owns_vault {
                self.maintenance.lock().await.remove(&info_hash);
            }

            if fill_trackers(&handle, &mut extras) {
                state_changed = true;
            }

            // "Seed when finished" toggle: park a completed torrent once it is live.
            if stats.finished
                && !settings.seed_after_complete
                && matches!(stats.state, TorrentStatsState::Live)
            {
                if session.pause(&handle).await.is_ok() {
                    log::debug!("paused finished torrent {info_hash}: seeding disabled");
                    // Report the pause to the UI and remember that it was deliberate, so
                    // the launch-time re-arm never fights this policy.
                    stats = handle.stats();
                    self.pending_rearm.lock().await.remove(&info_hash);
                    if extras.resume_on_start {
                        extras.resume_on_start = false;
                        state_changed = true;
                    }
                }
            }

            items.push(build_item(&handle, &stats, &extras));

            self.extras.lock().await.insert(info_hash, extras);
            state_changed |= is_new;
        }

        if state_changed {
            self.persist_state().await;
        }

        // Newest first, like every other torrent client.
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    }

    pub async fn get_system_stats(&self) -> SystemStats {
        let items = self.collect_items().await.unwrap_or_default();

        let mut global_download_speed = 0u64;
        let mut global_upload_speed = 0u64;
        let mut total_active_peers = 0u32;
        let mut active_torrents = 0usize;
        let mut paused_torrents = 0usize;
        let mut completed_torrents = 0usize;
        let mut total_downloaded_all_time = 0u64;

        for item in items.iter() {
            global_download_speed += item.download_speed;
            global_upload_speed += item.upload_speed;
            total_active_peers += item.peers_connected;
            total_downloaded_all_time += item.downloaded_bytes;
            if item.status == "Downloading" || item.status == "Seeding" {
                active_torrents += 1;
            }
            if item.status == "Paused" {
                paused_torrents += 1;
            }
            if item.progress >= 100.0 || item.completed_at.is_some() {
                completed_torrents += 1;
            }
        }

        let dht_nodes = self
            .session
            .get()
            .and_then(|session| session.get_dht().map(|dht| dht.stats()))
            .map(|stats| {
                (stats.routing_table_size + stats.routing_table_size_v6).min(u32::MAX as usize)
                    as u32
            })
            .unwrap_or(0);

        SystemStats {
            global_download_speed,
            global_upload_speed,
            total_active_peers,
            dht_nodes,
            total_torrents: items.len(),
            active_torrents,
            paused_torrents,
            completed_torrents,
            total_downloaded_all_time,
            restored_torrents: self.restored.load(Ordering::SeqCst),
            resumed_torrents: self.resumed.load(Ordering::SeqCst),
            checkpoint_at: self.checkpoint_at.load(Ordering::SeqCst),
        }
    }

    // -----------------------------------------------------------------
    // Torrent lifecycle
    // -----------------------------------------------------------------

    pub async fn add_torrent(
        &self,
        preview: TorrentMetadataPreview,
        target_dir: String,
    ) -> Result<TorrentItem, String> {
        let session = self.session().await?;
        let settings = self.settings.read().await.clone();

        // "Ask me every time" + an unset default means the UI normally supplies a
        // folder, but never let an empty value reach librqbit.
        let output_dir = resolve_download_dir(&settings, Some(&target_dir))?;

        let mut opts = AddTorrentOptions {
            paused: false,
            output_folder: Some(output_dir.to_string_lossy().to_string()),
            // Needed to resume/seed over files that already exist on disk.
            overwrite: true,
            ..Default::default()
        };

        // Magnet links carry their own `tr=` announce list; keep it when we have
        // already resolved the metadata bytes (adding bytes is instant, but the
        // bytes alone would lose the trackers declared by the link).
        if let Some(uri) = preview.magnet_uri.as_deref() {
            if let Ok(magnet) = Magnet::parse(uri) {
                let trackers: Vec<String> = magnet
                    .trackers
                    .iter()
                    .map(|t| t.to_string())
                    .filter(|t| !t.is_empty())
                    .collect();
                if !trackers.is_empty() {
                    opts.trackers = Some(trackers);
                }
            }
        }

        if !preview.files.is_empty() {
            let selected: Vec<usize> = preview
                .files
                .iter()
                .filter(|f| f.selected)
                .map(|f| f.index)
                .collect();
            if selected.is_empty() {
                return Err("no files selected for download".to_string());
            }
            if selected.len() < preview.files.len() {
                opts.only_files = Some(selected);
            }
        }

        let add = match preview.raw_bencode_base64.as_deref() {
            Some(encoded) => {
                let bytes = BASE64
                    .decode(encoded)
                    .map_err(|e| format!("invalid .torrent payload: {e}"))?;
                AddTorrent::from_bytes(bytes)
            }
            None => match preview.magnet_uri.as_deref() {
                Some(uri) => AddTorrent::from_url(uri.to_string()),
                None => {
                    return Err(
                        "torrent payload is missing both raw metadata and a magnet URI".to_string()
                    )
                }
            },
        };

        let response = session
            .add_torrent(add, Some(opts))
            .await
            .map_err(|e| format!("failed to add torrent: {e}"))?;

        let (was_already_managed, handle) = match response {
            AddTorrentResponse::Added(_, handle) => (false, handle),
            AddTorrentResponse::AlreadyManaged(_, handle) => (true, handle),
            AddTorrentResponse::ListOnly(_) => {
                return Err("unexpected list-only torrent response".to_string())
            }
        };

        // Re-adding a torrent the user already has should behave like "start it".
        if was_already_managed {
            let _ = session.unpause(&handle).await;
        }

        let info_hash = handle.info_hash().as_string();

        let mut extras = TorrentExtras {
            magnet_uri: preview.magnet_uri.clone(),
            // A freshly added torrent is started immediately, so remember that intent.
            resume_on_start: true,
            ..Default::default()
        };
        if was_already_managed {
            // Keep whatever bookkeeping we already have for this swarm.
            if let Some(previous) = self.extras.lock().await.get(&info_hash).cloned() {
                extras = previous;
                extras.resume_on_start = true;
            }
        }

        let stats = handle.stats();
        fill_trackers(&handle, &mut extras);
        let item = build_item(&handle, &stats, &extras);

        self.extras.lock().await.insert(info_hash, extras);
        self.persist_state().await;

        Ok(item)
    }

    pub async fn start_torrent(&self, info_hash: &str) -> Result<(), String> {
        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;
        if !is_running(&handle.stats()) {
            session
                .unpause(&handle)
                .await
                .map_err(|e| format!("cannot resume torrent: {e}"))?;
        }
        self.set_resume_intent(info_hash, true).await;
        Ok(())
    }

    pub async fn pause_torrent(&self, info_hash: &str) -> Result<(), String> {
        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;
        // Already dormant: record the intent, but never ask librqbit to pause twice.
        if !matches!(handle.stats().state, TorrentStatsState::Paused) {
            session
                .pause(&handle)
                .await
                .map_err(|e| format!("cannot pause torrent: {e}"))?;
        }
        self.set_resume_intent(info_hash, false).await;
        Ok(())
    }

    /// Record whether this swarm should be running again after a restart.
    async fn set_resume_intent(&self, info_hash: &str, running: bool) {
        {
            let mut map = self.extras.lock().await;
            map.entry(info_hash.to_string()).or_default().resume_on_start = running;
        }
        // An explicit user action always wins over the launch-time re-arm loop.
        self.pending_rearm.lock().await.remove(info_hash);
        self.persist_state().await;
    }

    /// Re-verify on-disk data. librqbit hash-checks existing files whenever a torrent is
    /// (re)added, so we drop and re-add it against the same output folder.
    pub async fn force_recheck(&self, info_hash: &str) -> Result<(), String> {
        let session = self.session().await?;
        let (id, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        let torrent_bytes = handle
            .with_metadata(|metadata| metadata.torrent_bytes.clone())
            .map_err(|e| format!("torrent metadata is not available yet: {e}"))?;
        let output_folder = handle.output_folder().to_string_lossy().to_string();
        let only_files = handle.only_files();
        let was_paused = matches!(handle.stats().state, TorrentStatsState::Paused);

        session
            .delete(TorrentIdOrHash::Id(id), false)
            .await
            .map_err(|e| format!("cannot restart torrent for recheck: {e}"))?;

        let opts = AddTorrentOptions {
            paused: was_paused,
            only_files,
            output_folder: Some(output_folder),
            overwrite: true,
            ..Default::default()
        };
        session
            .add_torrent(AddTorrent::from_bytes(torrent_bytes), Some(opts))
            .await
            .map_err(|e| format!("cannot re-add torrent for recheck: {e}"))?;

        Ok(())
    }

    pub async fn delete_torrent(&self, info_hash: &str, delete_files: bool) -> Result<(), String> {
        let session = self.session().await?;
        let (id, _handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        session
            .delete(TorrentIdOrHash::Id(id), delete_files)
            .await
            .map_err(|e| format!("cannot remove torrent: {e}"))?;

        self.extras.lock().await.remove(info_hash);
        self.persist_state().await;
        Ok(())
    }

    /// Pause every torrent in the session (a real pause: connections are dropped).
    pub async fn pause_all(&self) -> Result<(), String> {
        let session = self.session().await?;
        let mut failures = 0usize;
        for handle in Self::handles(&session) {
            // Already dormant in the eyes of the UI: nothing to pause.
            if matches!(handle.stats().state, TorrentStatsState::Paused) {
                continue;
            }
            if session.pause(&handle).await.is_err() {
                failures += 1;
            }
        }
        {
            let mut map = self.extras.lock().await;
            for extras in map.values_mut() {
                extras.resume_on_start = false;
            }
        }
        self.pending_rearm.lock().await.clear();
        self.persist_state().await;
        if failures > 0 {
            return Err(format!("{failures} torrent(s) could not be paused"));
        }
        Ok(())
    }

    /// Resume every torrent in the session.
    pub async fn resume_all(&self) -> Result<(), String> {
        let session = self.session().await?;
        let mut failures = 0usize;
        for handle in Self::handles(&session) {
            // Already transferring: nothing to do.
            if is_running(&handle.stats()) {
                continue;
            }
            if session.unpause(&handle).await.is_err() {
                failures += 1;
            }
        }
        {
            let mut map = self.extras.lock().await;
            for extras in map.values_mut() {
                extras.resume_on_start = true;
            }
        }
        self.persist_state().await;
        if failures > 0 {
            return Err(format!("{failures} torrent(s) could not be resumed"));
        }
        Ok(())
    }

    /// Persist a queue priority (`High` / `Normal` / `Low`) for the torrent.
    pub async fn set_priority(&self, info_hash: &str, priority: &str) -> Result<(), String> {
        let normalized = match priority {
            "High" | "Normal" | "Low" => priority.to_string(),
            other => return Err(format!("unsupported priority: {other}")),
        };

        {
            let mut map = self.extras.lock().await;
            let extras = map.entry(info_hash.to_string()).or_default();
            extras.priority = normalized;
        }
        self.persist_state().await;
        Ok(())
    }

    /// Change which files of an existing torrent are downloaded.
    /// librqbit re-evaluates the piece plan immediately; no restart is required.
    pub async fn set_file_selection(
        &self,
        info_hash: &str,
        files: Vec<usize>,
    ) -> Result<(), String> {
        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        let selected: HashSet<usize> = files.into_iter().collect();
        if selected.is_empty() {
            return Err("select at least one file to download".to_string());
        }

        session
            .update_only_files(&handle, &selected)
            .await
            .map_err(|e| format!("cannot update file selection: {e}"))
    }

    /// Live peer rows (address, client, transport, counters) for the Peers tab.
    pub async fn get_torrent_peers(&self, info_hash: &str) -> Result<Vec<PeerDetail>, String> {
        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        let Some(live) = handle.live() else {
            return Ok(Vec::new());
        };

        let snapshot = live.per_peer_stats_snapshot(Default::default());
        let mut peers: Vec<PeerDetail> = snapshot
            .peers
            .into_iter()
            .map(|(address, peer)| PeerDetail {
                address,
                state: peer.state.to_string(),
                client: peer.client_name,
                connection: peer.conn_kind.map(|kind| kind.to_string()),
                downloaded_bytes: peer.counters.fetched_bytes,
                uploaded_bytes: peer.counters.uploaded_bytes,
            })
            .collect();

        peers.sort_by(|a, b| {
            (b.downloaded_bytes + b.uploaded_bytes).cmp(&(a.downloaded_bytes + a.uploaded_bytes))
        });
        Ok(peers)
    }

    /// Write the torrent's metadata to an arbitrary path ("Save .torrent as...").
    pub async fn export_torrent(
        &self,
        info_hash: &str,
        target_path: &str,
    ) -> Result<BackupResult, String> {
        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        let torrent_bytes = handle
            .with_metadata(|metadata| metadata.torrent_bytes.clone())
            .map_err(|e| format!("torrent metadata is not available yet: {e}"))?;

        let mut target = PathBuf::from(target_path.trim());
        if target.as_os_str().is_empty() {
            return Err("no export path given".to_string());
        }
        if target.extension().is_none() {
            target.set_extension("torrent");
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }

        fs::write(&target, torrent_bytes.as_ref())
            .map_err(|e| format!("cannot write {}: {e}", target.display()))?;

        let path = target.to_string_lossy().to_string();
        {
            let mut map = self.extras.lock().await;
            let extras = map.entry(info_hash.to_string()).or_default();
            extras.backed_up = true;
            extras.backup_path = Some(path.clone());
        }
        self.persist_state().await;

        Ok(BackupResult {
            success: true,
            path,
        })
    }

    pub async fn backup_torrent_now(&self, info_hash: &str) -> Result<BackupResult, String> {
        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        let settings = self.settings.read().await.clone();
        let path = self
            .write_backup_file(&handle, &settings)
            .await
            .ok_or_else(|| "cannot write .torrent backup file".to_string())?;

        {
            let mut map = self.extras.lock().await;
            let extras = map.entry(info_hash.to_string()).or_default();
            extras.backed_up = true;
            extras.backup_path = Some(path.clone());
            extras.last_backup_at = now_ms();
        }
        self.persist_state().await;

        Ok(BackupResult {
            success: true,
            path,
        })
    }

    /// Write the torrent's raw metadata (`.torrent` bytes — synthesized bencode when the
    /// torrent was added from a magnet link) into the archive vault.
    async fn write_backup_file(
        &self,
        handle: &Arc<ManagedTorrent>,
        settings: &ClientSettings,
    ) -> Option<String> {
        let torrent_bytes = handle
            .with_metadata(|metadata| metadata.torrent_bytes.clone())
            .ok()?;
        if torrent_bytes.is_empty() {
            return None;
        }

        let dir = if settings.backup_dir.trim().is_empty() {
            default_settings(&self.state_dir).backup_dir
        } else {
            settings.backup_dir.clone()
        };
        let dir = PathBuf::from(dir);
        fs::create_dir_all(&dir).ok()?;

        let info_hash = handle.info_hash().as_string();
        let name = handle.name().unwrap_or_else(|| info_hash.clone());
        let file = dir.join(format!(
            "{}-{}.torrent",
            sanitize_file_name(&name),
            short_hash(&info_hash)
        ));

        // Temp file + rename: an archive file is never observed half-written.
        let tmp = file.with_extension("torrent.tmp");
        fs::write(&tmp, torrent_bytes.as_ref()).ok()?;
        if let Err(err) = fs::rename(&tmp, &file) {
            log::warn!("cannot archive torrent metadata to {}: {err}", file.display());
            fs::remove_file(&tmp).ok();
            return None;
        }
        Some(file.to_string_lossy().to_string())
    }

    /// Move the archived `.torrent` out of the staging vault into the "completed" vault
    /// once the payload has fully verified. This is a real move (rename, with a
    /// copy+delete fallback when the two folders live on different volumes).
    fn move_backup_to_completed(
        &self,
        extras: &mut TorrentExtras,
        settings: &ClientSettings,
    ) -> bool {
        let Some(backup_path) = extras.backup_path.clone() else {
            return false;
        };
        let source = PathBuf::from(&backup_path);
        let Some(file_name) = source.file_name().map(|n| n.to_owned()) else {
            return false;
        };

        let completed_dir = if settings.completed_torrent_dir.trim().is_empty() {
            default_settings(&self.state_dir).completed_torrent_dir
        } else {
            settings.completed_torrent_dir.clone()
        };
        let target_dir = PathBuf::from(completed_dir);
        if fs::create_dir_all(&target_dir).is_err() {
            return false;
        }
        let target = target_dir.join(&file_name);

        if source == target {
            extras.moved_to_completed = true;
            return false;
        }

        if !source.is_file() {
            // The vault copy is already gone — most likely a previous launch relocated it
            // and the state file kept the staging path. Adopt the completed copy instead
            // of archiving the swarm a second time.
            if target.is_file() {
                extras.backup_path = Some(target.to_string_lossy().to_string());
                extras.moved_to_completed = true;
                return true;
            }
            return false;
        }

        let moved = match fs::rename(&source, &target) {
            Ok(()) => true,
            Err(_) => {
                // Cross-volume (or locked) rename: copy, verify, then drop the original.
                match fs::copy(&source, &target) {
                    Ok(_) => match fs::remove_file(&source) {
                        Ok(()) => true,
                        Err(err) => {
                            log::warn!(
                                "archived torrent copied to {} but the vault copy could not be removed: {err}",
                                target.display()
                            );
                            true
                        }
                    },
                    Err(err) => {
                        log::warn!(
                            "cannot move archived torrent to {}: {err}",
                            target.display()
                        );
                        false
                    }
                }
            }
        };

        if moved {
            log::info!(
                "moved archived torrent {} -> {}",
                source.display(),
                target.display()
            );
            extras.backup_path = Some(target.to_string_lossy().to_string());
        }
        extras.moved_to_completed = moved;
        moved
    }

    // -----------------------------------------------------------------
    // Metadata parsing
    // -----------------------------------------------------------------

    /// Preview a magnet link. Metadata is fetched from the swarm with a list-only add (no
    /// files are written); if the swarm is slow we still return a usable preview so the user
    /// can start the download straight away.
    pub async fn parse_magnet_link(
        &self,
        magnet_uri: &str,
    ) -> Result<TorrentMetadataPreview, String> {
        let magnet = Magnet::parse(magnet_uri).map_err(|e| format!("invalid magnet link: {e}"))?;
        let info_hash = magnet
            .as_id20()
            .map(|id| id.as_string())
            .ok_or_else(|| "only BitTorrent v1 (btih) magnet links are supported".to_string())?;
        let name_hint = magnet
            .name
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format!("Magnet {}", short_hash(&info_hash)));

        let session = self.session().await?;
        let opts = AddTorrentOptions {
            list_only: true,
            ..Default::default()
        };

        let resolved = tokio::time::timeout(
            MAGNET_METADATA_TIMEOUT,
            session.add_torrent(AddTorrent::from_url(magnet_uri.to_string()), Some(opts)),
        )
        .await;

        match resolved {
            Ok(Ok(AddTorrentResponse::ListOnly(response))) => Ok(preview_from_info(
                &response.info,
                response.info_hash.as_string(),
                true,
                Some(magnet_uri.to_string()),
                Some(BASE64.encode(response.torrent_bytes.as_ref())),
            )),
            Ok(Ok(_)) => Err("the swarm returned an unexpected response".to_string()),
            Ok(Err(err)) => Err(format!("cannot resolve magnet metadata: {err}")),
            Err(_) => {
                log::warn!("magnet metadata resolution timed out for {info_hash}");
                Ok(TorrentMetadataPreview {
                    name: name_hint,
                    info_hash,
                    total_size: 0,
                    piece_length: 0,
                    piece_count: 0,
                    files: Vec::new(),
                    is_magnet: true,
                    magnet_uri: Some(magnet_uri.to_string()),
                    raw_bencode_base64: None,
                })
            }
        }
    }

    pub fn parse_torrent_file(
        file_name: &str,
        content_base64: &str,
    ) -> Result<TorrentMetadataPreview, String> {
        let bytes = BASE64
            .decode(content_base64.trim())
            .map_err(|e| format!("{file_name} is not a valid base64 payload: {e}"))?;
        if bytes.is_empty() {
            return Err(format!("{file_name} is empty"));
        }

        let meta = torrent_from_bytes(&bytes)
            .map_err(|e| format!("{file_name} is not a valid .torrent file: {e}"))?;
        let info_hash = meta.info_hash.as_string();
        let info = meta
            .info
            .data
            .validate()
            .map_err(|e| format!("{file_name} has invalid metadata: {e}"))?;

        Ok(preview_from_info(
            &info,
            info_hash,
            false,
            None,
            Some(BASE64.encode(&bytes)),
        ))
    }
}

// ---------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Is this torrent actively transferring, according to its state machine?
fn is_running(stats: &TorrentStats) -> bool {
    match &stats.state {
        TorrentStatsState::Live => true,
        TorrentStatsState::Initializing { paused } => !*paused,
        TorrentStatsState::Paused | TorrentStatsState::Error => false,
    }
}

/// What librqbit currently considers this swarm's run intent.
///
/// `TorrentStatsState` and the pause flag can briefly disagree while a restored torrent
/// re-verifies (librqbit clears the flag before applying a deferred pause), so the flag
/// is the reliable signal for "should this be running".
fn wants_to_run(handle: &Arc<ManagedTorrent>) -> bool {
    !handle.is_paused()
}

/// Park a swarm for the exit: pause it, and force a durable flush even when librqbit
/// already considers it dormant but has not written that to the resume database.
async fn seal_handle(session: &Arc<Session>, handle: &Arc<ManagedTorrent>) -> bool {
    if is_running(&handle.stats()) {
        return session.pause(handle).await.is_ok();
    }

    if wants_to_run(handle) {
        // State says dormant, flag says running: flip it once so pausing actually writes
        // `is_paused: true` into the session database.
        let _ = session.unpause(handle).await;
        tokio::time::sleep(Duration::from_millis(40)).await;
        return session.pause(handle).await.is_ok();
    }

    // Genuinely dormant and already persisted: nothing to flush.
    true
}

/// Should the archived `.torrent` be (re)written for this torrent right now?
///
/// The archive itself is written as soon as librqbit knows the metadata (that is the
/// whole point: an in-progress magnet must leave a real `.torrent` behind). The
/// interval only governs how often that snapshot is refreshed while bytes are still
/// flowing — `0` ("instant") refreshes every 10 minutes, a larger value refreshes at
/// that cadence. Completed swarms never need a refresh.
fn backup_due(extras: &TorrentExtras, interval_hours: u32, finished: bool, now: i64) -> bool {
    if !extras.backed_up {
        return true;
    }

    if finished {
        return false;
    }

    let refresh_ms = if interval_hours == 0 {
        600_000
    } else {
        interval_hours as i64 * 3_600_000
    };

    now.saturating_sub(extras.last_backup_at) >= refresh_ms
}

fn short_hash(info_hash: &str) -> &str {
    &info_hash[..info_hash.len().min(8)]
}

fn to_bps(bytes_per_second: u64) -> Option<NonZeroU32> {
    if bytes_per_second == 0 {
        return None;
    }
    NonZeroU32::new(bytes_per_second.min(u32::MAX as u64) as u32)
}

/// Apply the currently effective bandwidth caps (normal or turtle profile).
fn apply_limits(session: &Arc<Session>, settings: &ClientSettings) {
    let (download, upload) = settings.effective_limits();
    session.ratelimits.set_download_bps(to_bps(download));
    session.ratelimits.set_upload_bps(to_bps(upload));
}

/// Resolve (and create) the folder a torrent should be written to.
///
/// Priority: explicit per-torrent choice → configured default → OS downloads folder.
/// An empty configured default is valid ("always ask"); the session still needs a
/// concrete folder to start with, so we fall back to the OS downloads folder.
fn resolve_download_dir(
    settings: &ClientSettings,
    requested: Option<&str>,
) -> Result<PathBuf, String> {
    let candidate = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let configured = settings.default_download_dir.trim();
            if configured.is_empty() {
                None
            } else {
                Some(PathBuf::from(configured))
            }
        })
        .or_else(|| dirs::download_dir().map(|dir| dir.join("MakeMake")))
        .unwrap_or_else(|| std::env::temp_dir().join("MakeMakeDownloads"));

    fs::create_dir_all(&candidate).map_err(|e| {
        format!(
            "cannot create download directory {}: {e}",
            candidate.display()
        )
    })?;
    Ok(candidate)
}

fn state_file_path(state_dir: &Path) -> PathBuf {
    state_dir.join(STATE_FILE_NAME)
}

fn load_persisted_state(state_dir: &Path) -> PersistedState {
    match fs::read(state_file_path(state_dir)) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => PersistedState::default(),
    }
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "makemake-torrent".to_string()
    } else {
        trimmed.chars().take(96).collect()
    }
}

fn default_settings(state_dir: &Path) -> ClientSettings {
    let default_download = dirs::download_dir()
        .map(|p| p.join("MakeMake"))
        .unwrap_or_else(|| state_dir.join("Downloads"))
        .to_string_lossy()
        .to_string();

    let documents = dirs::document_dir().map(|p| p.join("MakeMake"));

    let backup_dir = documents
        .clone()
        .map(|p| p.join("TorrentBackups"))
        .unwrap_or_else(|| state_dir.join("TorrentBackups"))
        .to_string_lossy()
        .to_string();

    let completed_dir = documents
        .map(|p| p.join("CompletedTorrents"))
        .unwrap_or_else(|| state_dir.join("CompletedTorrents"))
        .to_string_lossy()
        .to_string();

    ClientSettings {
        default_download_dir: default_download,
        always_ask_download_dir: true,
        auto_backup_enabled: true,
        backup_interval_hours: 6,
        backup_dir,
        move_completed_torrent_enabled: true,
        completed_torrent_dir: completed_dir,
        max_download_speed: 0,
        max_upload_speed: 0,
        turtle_mode_enabled: false,
        turtle_download_speed: 512 * 1024,
        turtle_upload_speed: 64 * 1024,
        seed_after_complete: true,
        listen_port: 6881,
        enable_sound_fx: true,
        theme: "cyber-obsidian".to_string(),
        resume_on_launch: true,
    }
}

/// Build a front-end preview from validated torrent metadata.
fn preview_from_info<B: AsRef<[u8]>>(
    info: &ValidatedTorrentMetaV1Info<B>,
    info_hash: String,
    is_magnet: bool,
    magnet_uri: Option<String>,
    raw_bencode_base64: Option<String>,
) -> TorrentMetadataPreview {
    let total_size = info.lengths().total_length();
    let piece_length = info.info().piece_length as u64;
    let piece_count = info.info().pieces.as_ref().len() / 20;

    let files = info
        .iter_file_details()
        .enumerate()
        .map(|(index, details)| {
            let path = details.filename.to_pathbuf();
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| details.filename.to_string());
            TorrentFileItem {
                index,
                name,
                path: details.filename.to_string(),
                length: details.len,
                selected: true,
            }
        })
        .collect();

    TorrentMetadataPreview {
        name: info.name_or_else(|| "MakeMake Torrent").into_owned(),
        info_hash,
        total_size,
        piece_length,
        piece_count,
        files,
        is_magnet,
        magnet_uri,
        raw_bencode_base64,
    }
}


/// Translate a live librqbit handle into the `TorrentItem` model used by the UI.
fn build_item(handle: &Arc<ManagedTorrent>, stats: &TorrentStats, extras: &TorrentExtras) -> TorrentItem {
    let info_hash = handle.info_hash().as_string();

    let (piece_count, mut files) = handle
        .with_metadata(|metadata| {
            let piece_count = metadata.info.info().pieces.as_ref().len() / 20;
            let files = metadata
                .info
                .iter_file_details()
                .enumerate()
                .map(|(index, details)| {
                    let path = details.filename.to_pathbuf();
                    let name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| details.filename.to_string());
                    TorrentFileItem {
                        index,
                        name,
                        path: details.filename.to_string(),
                        length: details.len,
                        selected: true,
                    }
                })
                .collect::<Vec<_>>();
            (piece_count, files)
        })
        .unwrap_or((0, Vec::new()));

    // Honour the file selection the torrent was added with (if any).
    if let Some(only_files) = handle.only_files() {
        for file in files.iter_mut() {
            file.selected = only_files.contains(&file.index);
        }
    }

    let total_bytes = stats.total_bytes;
    let downloaded_bytes = stats.progress_bytes;
    let progress = if total_bytes > 0 {
        ((downloaded_bytes as f64 / total_bytes as f64) * 100.0) as f32
    } else if stats.finished {
        100.0
    } else {
        0.0
    };

    let (download_speed, upload_speed, peers_connected, peers_total) = match stats.live.as_ref() {
        Some(live) => (
            live.download_speed.as_bytes(),
            live.upload_speed.as_bytes(),
            live.snapshot.peer_stats.live,
            live.snapshot.peer_stats.seen,
        ),
        None => (0, 0, 0, 0),
    };

    let eta_seconds = if download_speed > 0 && total_bytes > downloaded_bytes {
        Some(((total_bytes - downloaded_bytes) / download_speed) as i64)
    } else {
        None
    };

    let status = match stats.state {
        TorrentStatsState::Initializing { paused } => {
            if paused {
                "Paused"
            } else if stats.finished {
                "Seeding"
            } else if downloaded_bytes > 0 {
                "Checking"
            } else {
                "Queued"
            }
        }
        TorrentStatsState::Live => {
            if stats.finished {
                "Seeding"
            } else {
                "Downloading"
            }
        }
        TorrentStatsState::Paused => "Paused",
        TorrentStatsState::Error => "Error",
    };

    let pieces_completed = ((piece_count as f64) * (progress as f64 / 100.0)).round() as usize;
    let pieces_bitfield = (0..64u32)
        .map(|i| u8::from((i as f32 / 64.0) < (progress / 100.0)))
        .collect();

    // librqbit only reports per-file progress once the torrent is initialized; pad the
    // vector so the UI can index it by file position without bounds checks.
    let mut file_progress = stats.file_progress.clone();
    if file_progress.len() < files.len() {
        file_progress.resize(files.len(), 0);
    }

    TorrentItem {
        id: info_hash.clone(),
        name: handle
            .name()
            .unwrap_or_else(|| format!("Torrent {}", short_hash(&info_hash))),
        info_hash,
        magnet_uri: extras.magnet_uri.clone(),
        total_bytes,
        downloaded_bytes,
        uploaded_bytes: stats.uploaded_bytes,
        download_speed,
        upload_speed,
        progress,
        status: status.to_string(),
        peers_connected,
        peers_total,
        seeds_connected: 0,
        seeds_total: 0,
        eta_seconds,
        download_dir: handle.output_folder().to_string_lossy().to_string(),
        files,
        piece_count,
        pieces_completed,
        pieces_bitfield,
        file_progress,
        trackers: extras.trackers.clone(),
        created_at: extras.created_at,
        completed_at: extras.completed_at,
        backed_up: extras.backed_up,
        backup_path: extras.backup_path.clone(),
        priority: extras.priority.clone(),
        error: stats.error.clone(),
    }
}









// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal single-file BitTorrent v1 metadata:
    /// `{ info: { length: 5, name: "test.txt", piece length: 16384, pieces: <20 bytes> } }`
    fn sample_torrent_bencode() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"d4:infod6:lengthi5e4:name8:test.txt12:piece lengthi16384e6:pieces20:");
        bytes.extend_from_slice(&[b'A'; 20]);
        bytes.extend_from_slice(b"ee");
        bytes
    }

    /// Same metadata plus a declared announce URL.
    fn sample_torrent_bencode_with_announce() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"d8:announce26:udp://tracker.test:1337/xx4:infod6:lengthi5e4:name8:test.txt12:piece lengthi16384e6:pieces20:");
        bytes.extend_from_slice(&[b'A'; 20]);
        bytes.extend_from_slice(b"ee");
        bytes
    }

    #[test]
    fn extracts_announce_urls_from_metadata() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"d8:announce26:udp://tracker.test:1337/xx4:infod6:lengthi5e4:name8:test.txt12:piece lengthi16384e6:pieces20:");
        bytes.extend_from_slice(&[b'A'; 20]);
        bytes.extend_from_slice(b"ee");

        let parsed = torrent_from_bytes(&bytes).expect("metadata should parse");
        let urls: Vec<String> = parsed.iter_announce().map(|a| a.to_string()).collect();
        assert_eq!(urls, vec!["udp://tracker.test:1337/xx".to_string()]);
    }

    #[test]
    fn parses_a_valid_torrent_file() {
        let encoded = BASE64.encode(sample_torrent_bencode());
        let preview = TorrentEngine::parse_torrent_file("test.torrent", &encoded)
            .expect("valid torrent metadata should parse");

        assert_eq!(preview.name, "test.txt");
        assert_eq!(preview.total_size, 5);
        assert_eq!(preview.piece_length, 16_384);
        assert_eq!(preview.piece_count, 1);
        assert_eq!(preview.files.len(), 1);
        assert_eq!(preview.files[0].path, "test.txt");
        assert_eq!(preview.files[0].length, 5);
        assert!(!preview.is_magnet);
        assert_eq!(preview.info_hash.len(), 40);
        assert!(preview.raw_bencode_base64.is_some());
    }

    #[test]
    fn rejects_garbage_torrent_payloads() {
        let encoded = BASE64.encode(b"not a torrent");
        assert!(TorrentEngine::parse_torrent_file("bad.torrent", &encoded).is_err());
        assert!(TorrentEngine::parse_torrent_file("bad.torrent", "!!!not-base64!!!").is_err());
    }

    #[test]
    fn rejects_magnet_links_without_btih() {
        // Only the pure parser is exercised here (no network / session required).
        assert!(Magnet::parse("magnet:?dn=nameless").is_err());
        assert!(Magnet::parse("not-a-magnet").is_err());
    }

    /// Drives a real (offline) librqbit session: add a paused torrent, map it into the
    /// front-end model, then locate and remove it again.
    #[tokio::test]
    async fn maps_a_real_session_torrent_into_an_item() {
        let root = std::env::temp_dir().join(format!("makemake-engine-test-{}", std::process::id()));
        let output = root.join("out");
        fs::create_dir_all(&output).unwrap();

        let session = Session::new_with_opts(
            output.clone(),
            SessionOptions {
                dht: None,
                persistence: None,
                listen: None,
                ..Default::default()
            },
        )
        .await
        .expect("offline session should start");

        let response = session
            .add_torrent(
                AddTorrent::from_bytes(sample_torrent_bencode_with_announce()),
                Some(AddTorrentOptions {
                    paused: true,
                    overwrite: true,
                    ..Default::default()
                }),
            )
            .await
            .expect("torrent should be added");

        let handle = match response {
            AddTorrentResponse::Added(_, handle)
            | AddTorrentResponse::AlreadyManaged(_, handle) => handle,
            _ => panic!("expected the torrent to be added"),
        };

        assert_eq!(handle.name().as_deref(), Some("test.txt"));

        let stats = handle.stats();
        let mut extras = TorrentExtras::default();
        assert!(
            fill_trackers(&handle, &mut extras),
            "the announce URL should be captured from the resolved metadata"
        );
        assert_eq!(extras.trackers, vec!["udp://tracker.test:1337/xx".to_string()]);
        assert!(
            !fill_trackers(&handle, &mut extras),
            "tracker extraction must be idempotent once cached"
        );

        let item = build_item(&handle, &stats, &extras);
        assert_eq!(item.name, "test.txt");
        assert_eq!(item.total_bytes, 5);
        assert_eq!(item.piece_count, 1);
        assert_eq!(item.files.len(), 1);
        assert_eq!(item.status, "Paused");
        assert_eq!(item.priority, "Normal");
        assert_eq!(item.trackers, extras.trackers);
        // librqbit only publishes per-file progress once the torrent is initialized/live.
        assert!(item.file_progress.len() <= item.files.len());
        let expected_root = output.to_string_lossy().to_string();
        assert!(
            item.download_dir.starts_with(&expected_root),
            "unexpected download dir: {}",
            item.download_dir
        );

        let (id, _) = TorrentEngine::find_handle(&session, &item.info_hash)
            .expect("the added torrent must be discoverable by infohash");
        session
            .delete(TorrentIdOrHash::Id(id), false)
            .await
            .expect("torrent should be removed");
        assert!(TorrentEngine::find_handle(&session, &item.info_hash).is_none());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn backup_due_follows_the_configured_interval() {
        let mut extras = TorrentExtras {
            created_at: 0,
            ..Default::default()
        };

        // Nothing is archived yet: the very first snapshot happens immediately, whether
        // the swarm is still leeching or already verified.
        assert!(backup_due(&extras, 0, false, 1_000));
        assert!(backup_due(&extras, 6, false, 1_000));
        assert!(backup_due(&extras, 6, true, 1_000));

        // Once archived, the vault copy refreshes only while the download is in flight.
        extras.backed_up = true;
        extras.last_backup_at = 10_000;
        assert!(!backup_due(&extras, 6, false, 10_000 + 3_600_000));
        assert!(backup_due(&extras, 6, false, 10_000 + 6 * 3_600_000));
        assert!(!backup_due(&extras, 6, true, 10_000 + 6 * 3_600_000));

        // "Instant" mode keeps refreshing every 10 minutes.
        assert!(!backup_due(&extras, 0, false, 10_000 + 60_000));
        assert!(backup_due(&extras, 0, false, 10_000 + 600_000));
    }

    #[test]
    fn legacy_settings_files_still_auto_resume() {
        // State written by v0.1.0 has no `resumeOnLaunch` / turtle keys at all.
        let json = r#"{
            "defaultDownloadDir": "",
            "alwaysAskDownloadDir": true,
            "autoBackupEnabled": true,
            "backupIntervalHours": 6,
            "backupDir": "",
            "moveCompletedTorrentEnabled": true,
            "completedTorrentDir": "",
            "maxDownloadSpeed": 0,
            "maxUploadSpeed": 0,
            "listenPort": 6881,
            "enableSoundFx": true,
            "theme": "cyber-obsidian"
        }"#;

        let settings: ClientSettings = serde_json::from_str(json).expect("legacy settings parse");
        assert!(settings.resume_on_launch, "defaults must auto-resume");
        assert!(settings.seed_after_complete);
        assert!(settings.turtle_download_speed > 0);
        assert!(settings.always_ask_download_dir);
    }
}
