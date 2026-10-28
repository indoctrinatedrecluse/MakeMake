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
        }
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
                match Session::new_with_opts(default_output.clone(), build_opts(listen_port)).await {
                    Ok(session) => Ok(session),
                    Err(err) => {
                        log::warn!(
                            "listener on port {listen_port} failed ({err}); retrying on an ephemeral port"
                        );
                        Session::new_with_opts(default_output, build_opts(0))
                            .await
                            .map_err(|e| format!("cannot start BitTorrent session: {e}"))
                    }
                }
            })
            .await
            .cloned()
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
                if let Err(err) = fs::write(state_file_path(&self.state_dir), json) {
                    log::warn!("cannot persist MakeMake state: {err}");
                }
            }
            Err(err) => log::warn!("cannot serialize MakeMake state: {err}"),
        }
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
            let stats = handle.stats();

            let existing = self.extras.lock().await.get(&info_hash).cloned();
            let is_new = existing.is_none();
            let mut extras = existing.unwrap_or_default();

            // Archive the .torrent metadata as soon as librqbit knows it.
            if settings.auto_backup_enabled && !extras.backed_up {
                if let Some(path) = self.write_backup_file(&handle, &settings).await {
                    extras.backed_up = true;
                    extras.backup_path = Some(path);
                    state_changed = true;
                }
            }

            if stats.finished {
                if extras.completed_at.is_none() {
                    extras.completed_at = Some(now_ms());
                    state_changed = true;
                }
                if settings.move_completed_torrent_enabled
                    && !extras.moved_to_completed
                    && self.move_backup_to_completed(&mut extras, &settings)
                {
                    state_changed = true;
                }
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
        let mut total_downloaded_all_time = 0u64;

        for item in items.iter() {
            global_download_speed += item.download_speed;
            global_upload_speed += item.upload_speed;
            total_active_peers += item.peers_connected;
            total_downloaded_all_time += item.downloaded_bytes;
            if item.status == "Downloading" || item.status == "Seeding" {
                active_torrents += 1;
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
            total_downloaded_all_time,
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
            ..Default::default()
        };
        if settings.auto_backup_enabled {
            if let Some(path) = self.write_backup_file(&handle, &settings).await {
                extras.backed_up = true;
                extras.backup_path = Some(path);
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
        session
            .unpause(&handle)
            .await
            .map_err(|e| format!("cannot resume torrent: {e}"))
    }

    pub async fn pause_torrent(&self, info_hash: &str) -> Result<(), String> {
        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;
        session
            .pause(&handle)
            .await
            .map_err(|e| format!("cannot pause torrent: {e}"))
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
            if session.pause(&handle).await.is_err() {
                failures += 1;
            }
        }
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
            if session.unpause(&handle).await.is_err() {
                failures += 1;
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
        }
        self.persist_state().await;

        Ok(BackupResult {
            success: true,
            path,
        })
    }

    async fn write_backup_file(
        &self,
        handle: &Arc<ManagedTorrent>,
        settings: &ClientSettings,
    ) -> Option<String> {
        let torrent_bytes = handle
            .with_metadata(|metadata| metadata.torrent_bytes.clone())
            .ok()?;

        let dir = PathBuf::from(&settings.backup_dir);
        fs::create_dir_all(&dir).ok()?;

        let info_hash = handle.info_hash().as_string();
        let name = handle.name().unwrap_or_else(|| info_hash.clone());
        let file = dir.join(format!(
            "{}-{}.torrent",
            sanitize_file_name(&name),
            short_hash(&info_hash)
        ));

        fs::write(&file, torrent_bytes.as_ref()).ok()?;
        Some(file.to_string_lossy().to_string())
    }

    fn move_backup_to_completed(
        &self,
        extras: &mut TorrentExtras,
        settings: &ClientSettings,
    ) -> bool {
        let Some(backup_path) = extras.backup_path.clone() else {
            return false;
        };
        let source = PathBuf::from(&backup_path);
        if !source.is_file() {
            return false;
        }
        let target_dir = PathBuf::from(&settings.completed_torrent_dir);
        if fs::create_dir_all(&target_dir).is_err() {
            return false;
        }
        let Some(file_name) = source.file_name().map(|n| n.to_owned()) else {
            return false;
        };
        let target = target_dir.join(file_name);
        if source == target {
            extras.moved_to_completed = true;
            return false;
        }
        match fs::copy(&source, &target) {
            Ok(_) => {
                extras.backup_path = Some(target.to_string_lossy().to_string());
                extras.moved_to_completed = true;
                true
            }
            Err(err) => {
                log::warn!("cannot move archived torrent to completed dir: {err}");
                false
            }
        }
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
}
