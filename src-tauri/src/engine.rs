//! MakeMake BitTorrent engine.
//!
//! A thin, stateful façade around a real [`librqbit::Session`]: DHT, trackers, the peer
//! wire protocol, piece verification, resume data, persistence and rate limiting are all
//! handled by librqbit. This module only translates between librqbit's live state and the
//! `TorrentItem` model consumed by the React front-end.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

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
    BackupResult, ClientSettings, ExistingPayload, PeerDetail, SystemStats, TorrentDiskUsage,
    TorrentFileItem, TorrentItem, TorrentMetadataPreview, TorrentSnapshot,
};
use crate::sparse;

/// How many buckets the coarse piece map reported to the UI has.
///
/// librqbit does not expose the real piece bitfield, and a torrent can have tens of
/// thousands of pieces; the UI only ever draws a small matrix, so MakeMake sends a fixed
/// number of buckets derived from verified bytes. Rendering one DOM node per piece is what
/// made the details drawer freeze on large torrents.
const COARSE_BUCKETS: usize = 64;

/// File (inside the app config dir) storing UI settings + per-torrent bookkeeping.
const STATE_FILE_NAME: &str = "makemake-state.json";

/// How long the "inspect a magnet link" dialog waits for swarm metadata before it lets the
/// user start the download anyway. The actual resolution then continues in the background
/// (see [`TorrentEngine::resolve_pending`]) while the torrent is already in the queue.
const MAGNET_METADATA_TIMEOUT: Duration = Duration::from_secs(20);

/// How long one background attempt to resolve a queued magnet may take.
const PENDING_RESOLVE_TIMEOUT: Duration = Duration::from_secs(180);

/// How many times a queued magnet is retried before it is parked with an error.
const PENDING_RESOLVE_ATTEMPTS: u32 = 3;

/// Marker file written when a run starts and deleted only after the session has been sealed
/// cleanly. Finding it at launch means the previous run never finished its shutdown
/// sequence (crash, power loss, "End task"), so the archives are re-verified.
const CRASH_MARKER_NAME: &str = "session-active.marker";

/// How many unrelated entries are reported for an existing payload folder before the walk
/// gives up (a folder with millions of entries must not stall the add dialog).
const FOREIGN_ENTRY_LIMIT: usize = 1000;



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

/// Immutable metadata of a torrent, cached for the lifetime of the session.
///
/// librqbit keeps this behind an `Arc` and never mutates it, but the only way to read it is
/// `with_metadata(|m| m.info.iter_file_details()...)`, which allocates a `String` per path
/// component. Doing that for every torrent on every UI tick was the main reason a torrent
/// with tens of thousands of files made the whole client crawl, so MakeMake snapshots it
/// once per info hash instead.
#[derive(Debug, Clone)]
struct CachedMeta {
    name: String,
    piece_count: usize,
    piece_length: u64,
    total_bytes: u64,
    files: Vec<TorrentFileItem>,
}

impl CachedMeta {
    fn from_handle(handle: &Arc<ManagedTorrent>) -> Option<Self> {
        handle
            .with_metadata(|metadata| {
                let info = &metadata.info;
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
                            padding: details.attrs().padding,
                        }
                    })
                    .collect::<Vec<_>>();

                CachedMeta {
                    name: info
                        .name_or_else(|| Cow::Borrowed("MakeMake Torrent"))
                        .to_string(),
                    piece_count: info.info().pieces.as_ref().len() / 20,
                    piece_length: info.info().piece_length as u64,
                    total_bytes: info.lengths().total_length(),
                    files,
                }
            })
            .ok()
    }
}

/// One torrent that is queued but not yet handed to librqbit.
///
/// A magnet link without resolved metadata used to be awaited inside the `add_torrent`
/// command: the dialog closed, nothing appeared in the list, and if the swarm was slow the
/// whole add failed and the torrent silently vanished. Queued magnets are tracked here
/// instead, so they show up in the queue immediately (with their real name and size as soon
/// as the swarm answers) and keep retrying in the background.
#[derive(Debug, Clone)]
struct PendingAdd {
    info_hash: String,
    name: String,
    magnet_uri: String,
    output_dir: PathBuf,
    /// File indices the user picked in the add dialog (survives retries and restarts).
    only_files: Option<Vec<usize>>,
    created_at: i64,
    /// `Some` once an attempt failed; cleared when the user hits retry.
    error: Option<String>,
    /// Real metadata, filled in as soon as the swarm answers.
    total_bytes: u64,
    piece_count: usize,
    files: Vec<TorrentFileItem>,
    attempts: u32,
    /// Set while a resolver task owns this entry, so parallel polls cannot spawn duplicates.
    resolving: bool,
}

/// On-disk shape of a queued magnet (see [`PersistedState`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingRecord {
    name: String,
    magnet_uri: String,
    output_dir: String,
    #[serde(default)]
    only_files: Option<Vec<usize>>,
    #[serde(default)]
    created_at: i64,
}

impl PendingAdd {
    fn to_item(&self) -> TorrentItem {
        let name = if self.name.trim().is_empty() {
            format!("Magnet {}", short_hash(&self.info_hash))
        } else {
            self.name.clone()
        };

        // The payload is written into a folder of its own (see [`payload_dir`]), so show where
        // it will land rather than the parent download folder the user picked.
        let download_dir = self.output_dir.join(sanitize_file_name(&name));

        TorrentItem {
            id: self.info_hash.clone(),
            name,
            info_hash: self.info_hash.clone(),
            magnet_uri: Some(self.magnet_uri.clone()),
            total_bytes: self.total_bytes,
            downloaded_bytes: 0,
            uploaded_bytes: 0,
            download_speed: 0,
            upload_speed: 0,
            progress: 0.0,
            status: if self.error.is_some() {
                "Error".to_string()
            } else {
                "Resolving".to_string()
            },
            peers_connected: 0,
            peers_total: 0,
            seeds_connected: 0,
            seeds_total: 0,
            eta_seconds: None,
            download_dir: download_dir.to_string_lossy().to_string(),
            files: self.files.clone(),
            piece_count: self.piece_count,
            pieces_completed: 0,
            pieces_bitfield: vec![0u8; COARSE_BUCKETS],
            file_progress: vec![0u64; self.files.len()],
            trackers: Vec::new(),
            created_at: self.created_at,
            completed_at: None,
            backed_up: false,
            backup_path: None,
            priority: default_priority(),
            error: self.error.clone(),
            resolving: true,
        }
    }
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
    /// Magnets that were still queued when the app closed, so they are picked up again on
    /// the next launch instead of silently disappearing.
    #[serde(default)]
    pending: HashMap<String, PendingRecord>,
}

/// MakeMake's BitTorrent engine.
///
/// Everything is behind `Arc`, so the engine can be cloned cheaply into background tasks
/// (magnet resolution) while the UI keeps talking to the same session.
#[derive(Clone)]
pub struct TorrentEngine {
    /// Lazily created real BitTorrent session (DHT + listeners + persistence).
    session: Arc<OnceCell<Arc<Session>>>,
    settings: Arc<RwLock<ClientSettings>>,
    extras: Arc<Mutex<HashMap<String, TorrentExtras>>>,
    state_dir: Arc<PathBuf>,
    /// Set once the shutdown sequence has begun (pausing only, no new work).
    shutting_down: Arc<AtomicBool>,
    /// Unix ms of the last durable checkpoint (state file + librqbit session db).
    checkpoint_at: Arc<AtomicI64>,
    /// Torrents librqbit restored from its session database on this launch.
    restored: Arc<AtomicU32>,
    /// Of those, how many MakeMake re-armed automatically.
    resumed: Arc<AtomicU32>,
    /// Swarms currently being archived/relocated by a poll. The UI asks for the torrent
    /// list and the system stats in parallel, which would otherwise race on the same
    /// vault file.
    maintenance: Arc<Mutex<HashSet<String>>>,
    /// Swarms the launch-time restore still has to wake up. librqbit re-verifies
    /// restored data and silently drops an unpause that arrives mid-check, so this map
    /// keeps asking until the swarm has been stable-live for a few polls (or the user
    /// pauses it explicitly).
    pending_rearm: Arc<Mutex<HashMap<String, RearmStatus>>>,
    /// Immutable per-torrent metadata (name, file list, piece count), computed once.
    meta_cache: Arc<Mutex<HashMap<String, Arc<CachedMeta>>>>,
    /// Magnets that are queued but not yet resolved/handed to librqbit.
    pending: Arc<Mutex<HashMap<String, PendingAdd>>>,
    /// Last sampled filesystem numbers for the download volume (see [`DiskSample`]).
    disk: Arc<Mutex<DiskSample>>,
    /// `session-active.marker`: present for the whole life of a run, removed only after a
    /// clean seal (see [`TorrentEngine::shutdown`]).
    crash_marker: Arc<PathBuf>,
    /// The previous run still had the marker on disk, i.e. it never sealed its session.
    crashed_last_run: bool,
}

/// Cached free/total space of the download volume.
///
/// One `statvfs`/`GetDiskFreeSpaceExW` call is cheap, but the window polls the engine every
/// second and the numbers only change when bytes are written, so they are re-sampled at most
/// once every [`Self::SAMPLE_INTERVAL`].
#[derive(Debug, Default, Clone, Copy)]
struct DiskSample {
    sampled_at: Option<Instant>,
    free_bytes: u64,
    total_bytes: u64,
}

impl DiskSample {
    const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

    fn is_fresh(&self) -> bool {
        self.sampled_at
            .map(|at| at.elapsed() < Self::SAMPLE_INTERVAL)
            .unwrap_or(false)
    }
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

        Self::with_state_dir(state_dir)
    }

    /// Build an engine that keeps all of its bookkeeping in `state_dir`.
    ///
    /// `new()` uses the platform config directory; tests can point this at a temp folder.
    pub fn with_state_dir(state_dir: PathBuf) -> Self {
        let persisted = load_persisted_state(&state_dir);
        let settings = persisted
            .settings
            .clone()
            .unwrap_or_else(|| default_settings(&state_dir));

        // Crash detection: the marker exists for exactly as long as a run is unsealed, so a
        // leftover one means the last run died without pausing its swarms.
        let crash_marker = state_dir.join(CRASH_MARKER_NAME);
        let crashed_last_run = crash_marker.is_file();
        if crashed_last_run {
            log::warn!(
                "previous run never sealed its session; resume data will be verified and the \
                 .torrent archives refreshed"
            );
        }
        if fs::create_dir_all(&state_dir).is_ok() {
            // Best effort: a read-only config folder must not stop the app from starting.
            let _ = fs::write(
                &crash_marker,
                format!("pid={} started_at={}\n", std::process::id(), now_ms()),
            );
        }

        // Magnets that were still queued when the app closed come back as queue entries.
        // They are re-attempted once the session is up (see `restore_previous_session`).
        let pending = persisted
            .pending
            .iter()
            .map(|(info_hash, record)| {
                let entry = PendingAdd {
                    info_hash: info_hash.clone(),
                    name: record.name.clone(),
                    magnet_uri: record.magnet_uri.clone(),
                    output_dir: PathBuf::from(&record.output_dir),
                    only_files: record.only_files.clone(),
                    created_at: if record.created_at == 0 {
                        now_ms()
                    } else {
                        record.created_at
                    },
                    error: None,
                    total_bytes: 0,
                    piece_count: 0,
                    files: Vec::new(),
                    attempts: 0,
                    resolving: false,
                };
                (info_hash.clone(), entry)
            })
            .collect::<HashMap<_, _>>();

        Self {
            session: Arc::new(OnceCell::new()),
            settings: Arc::new(RwLock::new(settings)),
            extras: Arc::new(Mutex::new(persisted.torrents)),
            state_dir: Arc::new(state_dir),
            shutting_down: Arc::new(AtomicBool::new(false)),
            checkpoint_at: Arc::new(AtomicI64::new(0)),
            restored: Arc::new(AtomicU32::new(0)),
            resumed: Arc::new(AtomicU32::new(0)),
            maintenance: Arc::new(Mutex::new(HashSet::new())),
            pending_rearm: Arc::new(Mutex::new(HashMap::new())),
            meta_cache: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(pending)),
            disk: Arc::new(Mutex::new(DiskSample::default())),
            crash_marker: Arc::new(crash_marker),
            crashed_last_run,
        }
    }

    /// Did the previous run end without sealing its session?
    pub fn crashed_last_run(&self) -> bool {
        self.crashed_last_run
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

                // Diagnostics: the free space of the volume every download lands on is the
                // number that explains a stalled swarm, so put it in the log at startup.
                match (
                    fs4::available_space(&default_output),
                    fs4::total_space(&default_output),
                ) {
                    (Ok(free), Ok(total)) => log::info!(
                        "download volume {}: {} free of {} bytes",
                        default_output.display(),
                        free,
                        total
                    ),
                    _ => log::warn!(
                        "cannot read filesystem statistics for {}",
                        default_output.display()
                    ),
                }

                // Torrents restored from librqbit's session database never pass through
                // `add_resolved`, so their payload has to be pre-created here — otherwise a
                // restored multi-gigabyte torrent would still be allocated densely the
                // moment the app launches. Blocking work, so it runs off the runtime.
                let restore_dir = persistence_dir.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    precreate_restored_payloads(&restore_dir);
                })
                .await;

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

                // A run that died without sealing may have left an archive half-written or
                // missing entirely (the vault is written on a timer). The `.torrent` bytes
                // are the one piece of state that cannot be recovered from the payload, so
                // they are re-checked before anything else happens.
                if self.crashed_last_run {
                    self.refresh_archives(&session).await;
                }

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
            self.retry_queued_magnets().await;
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

        // Magnets that were still queued last time get another chance now that the session
        // (and its DHT) is live.
        self.retry_queued_magnets().await;
    }

    /// Give every queued magnet another resolution attempt (used on launch).
    async fn retry_queued_magnets(&self) {
        let queued: Vec<String> = self.pending.lock().await.keys().cloned().collect();
        for info_hash in queued {
            log::info!("retrying queued magnet {info_hash} from the saved session");
            self.spawn_resolver(info_hash);
        }
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

        // The download folder may have moved to another volume: drop the cached filesystem
        // numbers so the next poll samples the new one.
        self.invalidate_disk_sample().await;

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
        let pending: HashMap<String, PendingRecord> = self
            .pending
            .lock()
            .await
            .iter()
            .map(|(info_hash, entry)| {
                (
                    info_hash.clone(),
                    PendingRecord {
                        name: entry.name.clone(),
                        magnet_uri: entry.magnet_uri.clone(),
                        output_dir: entry.output_dir.to_string_lossy().to_string(),
                        only_files: entry.only_files.clone(),
                        created_at: entry.created_at,
                    },
                )
            })
            .collect();

        let state = PersistedState {
            settings: Some(self.settings.read().await.clone()),
            torrents: self.extras.lock().await.clone(),
            pending,
        };

        if fs::create_dir_all(self.state_dir.as_path()).is_err() {
            return;
        }
        match serde_json::to_vec_pretty(&state) {
            Ok(json) => {
                // Write to a temp file first so a crash mid-write can never leave a
                // truncated state file behind (that would lose every swarm's flags).
                let target = state_file_path(self.state_dir.as_path());
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
            } else {
                // Only a fully sealed run may drop the marker: if even one swarm could not be
                // parked, the next launch has to know the session ended abruptly.
                if let Err(err) = fs::remove_file(self.crash_marker.as_path()) {
                    log::warn!("cannot clear the session marker: {err}");
                }
            }
            log::info!("session sealed; all swarms dormant");
        } else {
            // No session was ever created: nothing to pause, nothing to recover.
            let _ = fs::remove_file(self.crash_marker.as_path());
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
        // Snapshot the bookkeeping once instead of taking/releasing the same mutex several
        // times per torrent on every UI tick.
        let mut extras_map = self.extras.lock().await.clone();
        let mut meta_map = self.meta_cache.lock().await.clone();

        for handle in handles {
            let info_hash = handle.info_hash().as_string();
            let mut stats = handle.stats();
            let now = now_ms();

            let existing = extras_map.get(&info_hash).cloned();
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

            // Metadata never changes for an info hash, so it is snapshotted exactly once
            // (for magnets: as soon as the swarm delivers it).
            let meta = match meta_map.get(&info_hash) {
                Some(cached) => Some(cached.clone()),
                None => CachedMeta::from_handle(&handle).map(|cached| {
                    let cached = Arc::new(cached);
                    meta_map.insert(info_hash.clone(), cached.clone());
                    cached
                }),
            };

            items.push(build_item(&handle, &stats, &extras, meta.as_deref()));

            extras_map.insert(info_hash, extras);
            state_changed |= is_new;
        }

        *self.extras.lock().await = extras_map;
        *self.meta_cache.lock().await = meta_map;

        if state_changed {
            self.persist_state().await;
        }

        // Magnets that are still resolving their metadata belong to the queue too: the user
        // added them, so they must be visible (and retryable) even before librqbit manages
        // them.
        self.append_pending_items(&mut items).await;

        // Newest first, like every other torrent client.
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    }

    /// Append queued magnets that librqbit does not manage yet.
    async fn append_pending_items(&self, items: &mut Vec<TorrentItem>) {
        let pending = self.pending.lock().await;
        if pending.is_empty() {
            return;
        }

        for entry in pending.values() {
            if items.iter().any(|item| item.id == entry.info_hash) {
                continue;
            }
            items.push(entry.to_item());
        }
    }

    /// Global counters, computed straight from librqbit without touching the (much more
    /// expensive) per-torrent listing. This used to call `collect_items`, which meant every
    /// UI tick walked the whole torrent list twice.
    pub async fn get_system_stats(&self) -> SystemStats {
        let mut stats = SystemStats {
            restored_torrents: self.restored.load(Ordering::SeqCst),
            resumed_torrents: self.resumed.load(Ordering::SeqCst),
            checkpoint_at: self.checkpoint_at.load(Ordering::SeqCst),
            crashed_last_run: self.crashed_last_run,
            ..Default::default()
        };

        if let Some(session) = self.session.get() {
            for handle in Self::handles(session) {
                let torrent = handle.stats();
                if let Some(live) = torrent.live.as_ref() {
                    stats.global_download_speed += live.download_speed.as_bytes();
                    stats.global_upload_speed += live.upload_speed.as_bytes();
                    stats.total_active_peers += live.snapshot.peer_stats.live;
                }
                stats.total_downloaded_all_time += torrent.progress_bytes;
                if torrent.finished {
                    stats.completed_torrents += 1;
                    if is_running(&torrent) {
                        stats.active_torrents += 1;
                    }
                } else if is_running(&torrent) {
                    stats.active_torrents += 1;
                } else {
                    stats.paused_torrents += 1;
                }
                stats.total_torrents += 1;
            }

            stats.dht_nodes = session
                .get_dht()
                .map(|dht| dht.stats())
                .map(|dht| {
                    (dht.routing_table_size + dht.routing_table_size_v6).min(u32::MAX as usize)
                        as u32
                })
                .unwrap_or(0);
        }

        // Queued magnets belong to the queue even though librqbit does not know them yet.
        stats.total_torrents += self.pending.lock().await.len();

        let (free, total) = self.disk_space().await;
        stats.disk_free_bytes = free;
        stats.disk_total_bytes = total;
        stats
    }

    /// The directory new downloads land in (settings first, OS downloads folder otherwise).
    async fn download_dir(&self) -> PathBuf {
        let settings = self.settings.read().await;
        resolve_download_dir(&settings, None).unwrap_or_else(|_| self.state_dir.to_path_buf())
    }

    /// Forget the cached filesystem numbers (the download folder moved to another volume).
    async fn invalidate_disk_sample(&self) {
        self.disk.lock().await.sampled_at = None;
    }

    /// Free and total bytes of the volume that holds the download directory.
    ///
    /// `fs4` wraps `statvfs`/`GetDiskFreeSpaceExW`, so the same call works on every platform
    /// MakeMake runs on. The result is cached for [`DiskSample::SAMPLE_INTERVAL`] because the
    /// UI polls once a second and the numbers only move when bytes are written.
    async fn disk_space(&self) -> (u64, u64) {
        {
            let sample = self.disk.lock().await;
            if sample.is_fresh() {
                return (sample.free_bytes, sample.total_bytes);
            }
        }

        let dir = self.download_dir().await;
        let (free, total) = tokio::task::spawn_blocking(move || {
            (
                fs4::available_space(&dir).unwrap_or(0),
                fs4::total_space(&dir).unwrap_or(0),
            )
        })
        .await
        .unwrap_or((0, 0));

        let mut sample = self.disk.lock().await;
        if total > 0 {
            sample.sampled_at = Some(Instant::now());
            sample.free_bytes = free;
            sample.total_bytes = total;
        } else {
            // The volume could not be read (the download folder may not exist yet): keep the
            // cache empty so the next poll retries instead of serving zeros for five seconds.
            sample.sampled_at = None;
        }
        (free, total)
    }

    /// What one torrent actually occupies on disk, compared with its logical size.
    ///
    /// A sparse payload has a logical length of hundreds of gigabytes and an *allocated*
    /// size of a few megabytes, so this is the number that explains why a 133 GiB torrent
    /// costs nothing until it downloads. `fs4::FileExt::allocated_size` asks the filesystem
    /// (`GetFileInformationByHandleEx`/`SEEK_DATA`), it never reads file contents.
    pub async fn torrent_disk_usage(&self, info_hash: &str) -> Result<TorrentDiskUsage, String> {
        if self.pending.lock().await.contains_key(info_hash) {
            // Nothing exists on disk yet for a magnet that has not resolved.
            return Ok(TorrentDiskUsage::default());
        }

        let session = self.session().await?;
        let (_, handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        let output_folder = handle.output_folder().to_path_buf();
        let payload: Vec<PathBuf> = handle
            .with_metadata(|metadata| {
                metadata
                    .info
                    .iter_file_details()
                    .filter(|details| !details.attrs().padding)
                    .map(|details| details.filename.to_pathbuf())
                    .collect::<Vec<_>>()
            })
            .map_err(|_| "torrent metadata is not available yet".to_string())?;

        // One `open` + one query per file: blocking work, and a big pack has thousands of
        // files, so it never runs on the async runtime.
        tokio::task::spawn_blocking(move || crate::sparse::measure_usage(&output_folder, &payload))
            .await
            .map_err(|e| format!("cannot measure disk usage: {e}"))
    }

    /// Torrent list + global counters in a single round trip.
    ///
    /// The window polls this once per second; splitting it into two commands doubled both
    /// the IPC traffic and the engine work.
    pub async fn get_snapshot(&self) -> Result<TorrentSnapshot, String> {
        let torrents = self.collect_items().await?;

        let mut stats = SystemStats {
            global_download_speed: torrents.iter().map(|t| t.download_speed).sum(),
            global_upload_speed: torrents.iter().map(|t| t.upload_speed).sum(),
            total_active_peers: torrents.iter().map(|t| t.peers_connected).sum(),
            total_torrents: torrents.len(),
            active_torrents: torrents
                .iter()
                .filter(|t| matches!(t.status.as_str(), "Downloading" | "Seeding"))
                .count(),
            paused_torrents: torrents.iter().filter(|t| t.status == "Paused").count(),
            completed_torrents: torrents
                .iter()
                .filter(|t| t.progress >= 100.0 || t.completed_at.is_some())
                .count(),
            total_downloaded_all_time: torrents.iter().map(|t| t.downloaded_bytes).sum(),
            restored_torrents: self.restored.load(Ordering::SeqCst),
            resumed_torrents: self.resumed.load(Ordering::SeqCst),
            checkpoint_at: self.checkpoint_at.load(Ordering::SeqCst),
            crashed_last_run: self.crashed_last_run,
            ..Default::default()
        };

        stats.dht_nodes = self
            .session
            .get()
            .and_then(|session| session.get_dht().map(|dht| dht.stats()))
            .map(|dht| {
                (dht.routing_table_size + dht.routing_table_size_v6).min(u32::MAX as usize) as u32
            })
            .unwrap_or(0);

        // The footer's disk gauge. `get_system_stats` fills the same two fields; this is the
        // command the window actually polls, so it has to carry them too.
        let (free, total) = self.disk_space().await;
        stats.disk_free_bytes = free;
        stats.disk_total_bytes = total;

        Ok(TorrentSnapshot { torrents, stats })
    }

    // -----------------------------------------------------------------
    // Torrent lifecycle
    // -----------------------------------------------------------------

    /// Queue a torrent for download.
    ///
    /// A `.torrent` (or a magnet whose metadata the dialog already resolved) is handed to
    /// librqbit straight away. A magnet without metadata is parked in the pending queue and
    /// resolved in the background, so it appears in the UI immediately — and keeps retrying
    /// instead of silently disappearing when the swarm is slow.
    ///
    /// `mode` decides what happens to a payload folder that already exists:
    ///
    /// * `"resume"` (default) — keep everything, let librqbit hash what is on disk and only
    ///   fetch the pieces that are missing;
    /// * `"replace"` — delete the torrent's own payload paths first, then start from zero.
    ///
    /// Anything else (or nothing) is treated as `"resume"`, the non-destructive choice: a
    /// torrent can never erase files because a caller forgot an argument.
    pub async fn add_torrent(
        &self,
        preview: TorrentMetadataPreview,
        target_dir: String,
        mode: Option<String>,
    ) -> Result<TorrentItem, String> {
        let session = self.session().await?;
        let settings = self.settings.read().await.clone();

        // "Ask me every time" + an unset default means the UI normally supplies a folder,
        // but never let an empty value reach librqbit.
        let base_dir = resolve_download_dir(&settings, Some(&target_dir))?;
        let only_files = selected_indices(&preview)?;
        let start_over = matches!(
            mode.as_deref().map(str::trim),
            Some("replace") | Some("startOver") | Some("fresh")
        );

        match preview.raw_bencode_base64.as_deref() {
            Some(encoded) => {
                let bytes = BASE64
                    .decode(encoded.trim())
                    .map_err(|e| format!("invalid .torrent payload: {e}"))?;
                if start_over {
                    self.wipe_existing_payload(&session, &bytes, &base_dir)
                        .await?;
                }
                self.add_resolved(
                    &session,
                    &bytes,
                    preview.magnet_uri.clone(),
                    &base_dir,
                    only_files,
                )
                .await
            }
            None => {
                let uri = preview.magnet_uri.clone().ok_or_else(|| {
                    "torrent payload is missing both raw metadata and a magnet URI".to_string()
                })?;

                if start_over {
                    // Without metadata there is no payload path to erase, and wiping the whole
                    // folder instead would be a data-loss bug: refuse rather than guess.
                    log::warn!(
                        "ignoring \"start over\" for {}: its metadata is not resolved yet",
                        short_hash(&preview.info_hash)
                    );
                }

                Ok(self
                    .enqueue_pending(preview.name, preview.info_hash, uri, base_dir, only_files)
                    .await)
            }
        }
    }

    /// Erase an existing payload folder's files so a torrent can start from zero.
    ///
    /// Only the paths the torrent itself declares are removed (see
    /// [`crate::sparse::wipe_payload`]); unrelated files in the folder are left alone. A
    /// torrent that is already managed is dropped from the session first, otherwise librqbit
    /// would answer "already managed" and never re-check the now-empty files.
    async fn wipe_existing_payload(
        &self,
        session: &Arc<Session>,
        torrent_bytes: &[u8],
        base_dir: &Path,
    ) -> Result<(), String> {
        let layout = payload_layout(torrent_bytes, base_dir)?;
        let info_hash = layout.info_hash.clone();

        if let Some((id, _handle)) = Self::find_handle(session, &info_hash) {
            session
                .delete(TorrentIdOrHash::Id(id), false)
                .await
                .map_err(|e| format!("cannot reset torrent {}: {e}", short_hash(&info_hash)))?;
            self.pending_rearm.lock().await.remove(&info_hash);
        }

        let output_dir = layout.output_dir.clone();
        let files = layout.all_files.clone();
        // Deleting thousands of files is blocking work; it must not park a runtime worker.
        match tokio::task::spawn_blocking(move || sparse::wipe_payload(&output_dir, &files)).await {
            Ok(Ok(removed)) => log::info!(
                "start over for {}: removed {removed} payload file(s) from {}",
                short_hash(&info_hash),
                layout.output_dir.display()
            ),
            Ok(Err(err)) => {
                return Err(format!(
                    "cannot clear the existing payload in {}: {err}",
                    layout.output_dir.display()
                ))
            }
            Err(err) => return Err(format!("cannot clear the existing payload: {err}")),
        }

        Ok(())
    }

    /// Inspect the folder this torrent would be written to, without touching anything.
    ///
    /// Returns `None` when the payload paths are not known yet (a magnet whose metadata has
    /// not arrived), because the folder name itself comes from that metadata. Otherwise it
    /// reports how much of the selection is already on disk, so the add dialog can ask before
    /// resuming into — or replacing — an existing folder.
    pub async fn inspect_destination(
        &self,
        preview: &TorrentMetadataPreview,
        target_dir: &str,
    ) -> Result<Option<ExistingPayload>, String> {
        let Some(encoded) = preview.raw_bencode_base64.as_deref() else {
            return Ok(None);
        };
        let bytes = BASE64
            .decode(encoded.trim())
            .map_err(|e| format!("invalid .torrent payload: {e}"))?;

        let settings = self.settings.read().await.clone();
        // Deliberately not `resolve_download_dir`: inspecting a destination must never create
        // it (a cancelled add should leave the disk untouched).
        let base_dir = download_base_dir(&settings, Some(target_dir));
        let layout = payload_layout(&bytes, &base_dir)?;

        let selected = selected_indices(preview)?;
        let selection: Vec<(PathBuf, u64)> = layout
            .indexed_files
            .iter()
            .filter(|(index, _, _)| {
                selected
                    .as_ref()
                    .map(|chosen| chosen.contains(index))
                    .unwrap_or(true)
            })
            .map(|(_, path, length)| (path.clone(), *length))
            .collect();

        let already_managed = self.pending.lock().await.contains_key(&layout.info_hash)
            || self
                .session
                .get()
                .map(|session| Self::find_handle(session, &layout.info_hash).is_some())
                .unwrap_or(false);

        let folder = layout.output_dir.clone();
        let all_files = layout.all_files.clone();
        let exists = folder.is_dir();
        let files_total = selection.len();
        let bytes_total: u64 = selection.iter().map(|(_, length)| *length).sum();

        // Two filesystem passes (one stat per file, one bounded tree walk): blocking work on
        // a large pack, so it never runs on the runtime.
        let (presence, foreign_files) = tokio::task::spawn_blocking(move || {
            if !exists {
                return (sparse::PayloadPresence::default(), 0usize);
            }
            let presence = sparse::measure_presence(&folder, &selection);
            let foreign = sparse::count_foreign_entries(&folder, &all_files, FOREIGN_ENTRY_LIMIT);
            (presence, foreign)
        })
        .await
        .map_err(|e| format!("cannot inspect the destination folder: {e}"))?;

        // A destination that does not exist yet still has a known size, so the dialog can say
        // "0 of 4.2 GB on disk" instead of nothing at all.
        let presence = if exists {
            presence
        } else {
            sparse::PayloadPresence {
                files_total,
                bytes_total,
                ..Default::default()
            }
        };

        Ok(Some(ExistingPayload {
            folder: layout.output_dir.to_string_lossy().to_string(),
            exists,
            files_present: presence.files_present,
            files_complete: presence.files_complete,
            files_total: presence.files_total,
            bytes_present: presence.bytes_present,
            bytes_total: presence.bytes_total,
            foreign_files,
            already_managed,
        }))
    }

    /// Register a magnet that still has to resolve its metadata.
    async fn enqueue_pending(
        &self,
        name: String,
        info_hash: String,
        magnet_uri: String,
        output_dir: PathBuf,
        only_files: Option<Vec<usize>>,
    ) -> TorrentItem {
        let entry = {
            let mut pending = self.pending.lock().await;
            let entry = pending
                .entry(info_hash.clone())
                .or_insert_with(|| PendingAdd {
                    info_hash: info_hash.clone(),
                    name: name.clone(),
                    magnet_uri: magnet_uri.clone(),
                    output_dir: output_dir.clone(),
                    only_files: only_files.clone(),
                    created_at: now_ms(),
                    error: None,
                    total_bytes: 0,
                    piece_count: 0,
                    files: Vec::new(),
                    attempts: 0,
                    resolving: false,
                });
            entry.name = name;
            entry.magnet_uri = magnet_uri;
            entry.output_dir = output_dir.clone();
            entry.only_files = only_files;
            entry.error = None;
            entry.clone()
        };

        log::info!(
            "queued magnet {} -> {} (metadata resolves in the background)",
            short_hash(&info_hash),
            entry.output_dir.display()
        );

        self.spawn_resolver(info_hash);
        entry.to_item()
    }

    /// Spawn at most one background resolver for a queued magnet.
    fn spawn_resolver(&self, info_hash: String) {
        let engine = self.clone();
        tauri::async_runtime::spawn(async move {
            let only_files = engine
                .pending
                .lock()
                .await
                .get(&info_hash)
                .and_then(|entry| entry.only_files.clone());
            engine.resolve_pending(info_hash, only_files).await;
        });
    }

    /// Fetch a queued magnet's metadata from the swarm, then hand it to librqbit.
    async fn resolve_pending(&self, info_hash: String, only_files: Option<Vec<usize>>) {
        let (magnet_uri, output_dir) = {
            let mut pending = self.pending.lock().await;
            let Some(entry) = pending.get_mut(&info_hash) else {
                return;
            };
            if entry.resolving {
                return;
            }
            entry.resolving = true;
            entry.error = None;
            (entry.magnet_uri.clone(), entry.output_dir.clone())
        };

        let session = match self.session().await {
            Ok(session) => session,
            Err(err) => {
                self.fail_pending(&info_hash, err).await;
                return;
            }
        };

        let mut last_error = String::new();
        for attempt in 1..=PENDING_RESOLVE_ATTEMPTS {
            let response = tokio::time::timeout(
                PENDING_RESOLVE_TIMEOUT,
                session.add_torrent(
                    AddTorrent::from_url(magnet_uri.clone()),
                    Some(AddTorrentOptions {
                        list_only: true,
                        ..Default::default()
                    }),
                ),
            )
            .await;

            match response {
                Ok(Ok(AddTorrentResponse::ListOnly(response))) => {
                    // Publish the real name, size and file list right away so the queued
                    // entry stops looking like a placeholder while it starts.
                    let preview = preview_from_info(
                        &response.info,
                        response.info_hash.as_string(),
                        true,
                        Some(magnet_uri.clone()),
                        None,
                    );
                    self.publish_pending_metadata(&info_hash, &preview).await;

                    match self
                        .add_resolved(
                            &session,
                            response.torrent_bytes.as_ref(),
                            Some(magnet_uri.clone()),
                            &output_dir,
                            only_files.clone(),
                        )
                        .await
                    {
                        Ok(item) => {
                            self.pending.lock().await.remove(&info_hash);
                            log::info!(
                                "magnet {} resolved on attempt {attempt}: {}",
                                short_hash(&info_hash),
                                item.name
                            );
                            return;
                        }
                        Err(err) => {
                            // Metadata is fine; the failure is in adding the torrent.
                            // Re-resolving would not help, so report it instead of looping.
                            last_error = err;
                            break;
                        }
                    }
                }
                Ok(Ok(_)) => last_error = "the swarm returned an unexpected response".to_string(),
                Ok(Err(err)) => last_error = format!("cannot resolve magnet metadata: {err}"),
                Err(_) => {
                    last_error = format!("no metadata after {}s", PENDING_RESOLVE_TIMEOUT.as_secs())
                }
            }

            log::warn!(
                "magnet {} attempt {attempt}/{PENDING_RESOLVE_ATTEMPTS} failed: {last_error}",
                short_hash(&info_hash)
            );
            if attempt < PENDING_RESOLVE_ATTEMPTS {
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }

        self.fail_pending(&info_hash, last_error).await;
    }

    /// Keep the queued entry in sync with the metadata the swarm just delivered.
    async fn publish_pending_metadata(&self, info_hash: &str, preview: &TorrentMetadataPreview) {
        let mut pending = self.pending.lock().await;
        if let Some(entry) = pending.get_mut(info_hash) {
            entry.name = preview.name.clone();
            entry.total_bytes = preview.total_size;
            entry.piece_count = preview.piece_count;
            entry.files = preview.files.clone();
        }
    }

    /// Hand resolved metadata to librqbit.
    ///
    /// This is where the payload lives on disk: MakeMake pre-creates every selected file as
    /// an *empty sparse* file first (see [`crate::sparse`]), which keeps both librqbit's
    /// initial hash check and its `set_len` allocation instant no matter how large the
    /// torrent is.
    async fn add_resolved(
        &self,
        session: &Arc<Session>,
        torrent_bytes: &[u8],
        magnet_uri: Option<String>,
        base_dir: &Path,
        only_files: Option<Vec<usize>>,
    ) -> Result<TorrentItem, String> {
        // The exact same layout the add dialog inspected (see [`payload_layout`]), so the
        // "this folder already exists" question and the actual write target can never drift.
        let layout = payload_layout(torrent_bytes, base_dir)?;
        let PayloadLayout {
            info_hash,
            output_dir,
            all_files: payload,
            total_bytes,
            ..
        } = layout;
        fs::create_dir_all(&output_dir)
            .map_err(|e| format!("cannot create {}: {e}", output_dir.display()))?;

        // Every payload file is pre-created, not just the selected ones: librqbit's
        // initialisation extends *all* of a torrent's files (measured on a restored
        // 133 GiB torrent, files outside `only_files` were extended too), and any file that
        // is not already sparse gets allocated densely.

        // Pre-creation is pure blocking filesystem work (one open + one ioctl per file), so
        // it must not run on a runtime worker thread: a 20 000-file pack would stall every
        // other task — including the UI polls — for the duration.
        let prepare_dir = output_dir.clone();
        match tokio::task::spawn_blocking(move || sparse::prepare_payload(&prepare_dir, &payload))
            .await
        {
            Ok(Ok(summary)) => log::info!(
                "payload {}: {} file(s) pre-created sparse, {} already present, {} skipped",
                short_hash(&info_hash),
                summary.files,
                summary.existing,
                summary.skipped
            ),
            Ok(Err(err)) => log::warn!(
                "cannot pre-create payload for {}: {err} (the download will still start, but \
                 librqbit will reserve the full size on disk)",
                short_hash(&info_hash)
            ),
            Err(err) => log::warn!(
                "payload pre-creation task for {} failed: {err}",
                short_hash(&info_hash)
            ),
        }

        // Sparse placeholders cost nothing, so a torrent larger than the volume is fine right
        // up to the moment the disk actually fills. Say so now instead of mystery stalling
        // hours later.
        let (free_bytes, _) = self.disk_space().await;
        if free_bytes > 0 && total_bytes > free_bytes {
            log::warn!(
                "torrent {} needs {} but only {} is free in {}; the download will stall when \
                 the volume fills",
                short_hash(&info_hash),
                total_bytes,
                free_bytes,
                output_dir.display()
            );
        }

        let mut opts = AddTorrentOptions {
            paused: false,
            output_folder: Some(output_dir.to_string_lossy().to_string()),
            // Needed to resume/seed over files that already exist on disk.
            overwrite: true,
            only_files: only_files.clone(),
            ..Default::default()
        };

        // Magnet links carry their own `tr=` announce list; keep it when we have already
        // resolved the metadata bytes (the bytes alone would lose the link's trackers).
        if let Some(uri) = magnet_uri.as_deref() {
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

        let response = session
            .add_torrent(AddTorrent::from_bytes(torrent_bytes.to_vec()), Some(opts))
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

        let mut extras = TorrentExtras {
            magnet_uri,
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
        let cached = CachedMeta::from_handle(&handle).map(Arc::new);
        if let Some(cached) = cached.as_ref() {
            self.meta_cache
                .lock()
                .await
                .insert(info_hash.clone(), cached.clone());
        }
        let item = build_item(&handle, &stats, &extras, cached.as_deref());

        self.extras.lock().await.insert(info_hash, extras);
        self.persist_state().await;

        Ok(item)
    }

    /// Park a queued magnet with a visible error; it stays in the queue so it can be retried.
    async fn fail_pending(&self, info_hash: &str, error: String) {
        {
            let mut pending = self.pending.lock().await;
            if let Some(entry) = pending.get_mut(info_hash) {
                entry.resolving = false;
                entry.error = Some(error.clone());
            }
        }
        log::warn!(
            "magnet {} could not be queued: {error}",
            short_hash(info_hash)
        );
    }

    /// Re-run a queued magnet that previously failed.
    pub async fn retry_pending(&self, info_hash: &str) -> Result<(), String> {
        {
            let mut pending = self.pending.lock().await;
            let entry = pending
                .get_mut(info_hash)
                .ok_or_else(|| format!("no queued magnet with info hash {info_hash}"))?;
            if entry.resolving {
                return Ok(());
            }
            entry.error = None;
            entry.attempts = 0;
        }

        self.spawn_resolver(info_hash.to_string());
        Ok(())
    }


    pub async fn start_torrent(&self, info_hash: &str) -> Result<(), String> {
        // A queued magnet has no librqbit handle yet: "start" means "try resolving again".
        if self.pending.lock().await.contains_key(info_hash) {
            return self.retry_pending(info_hash).await;
        }

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
        // A queued magnet never reached librqbit: dropping it from the queue is enough.
        {
            let mut pending = self.pending.lock().await;
            if pending.remove(info_hash).is_some() {
                log::info!("dropped queued magnet {}", short_hash(info_hash));
                return Ok(());
            }
        }

        let session = self.session().await?;
        let (id, _handle) = Self::find_handle(&session, info_hash)
            .ok_or_else(|| format!("torrent {info_hash} is not managed by this session"))?;

        session
            .delete(TorrentIdOrHash::Id(id), delete_files)
            .await
            .map_err(|e| format!("cannot remove torrent: {e}"))?;

        self.extras.lock().await.remove(info_hash);
        self.meta_cache.lock().await.remove(info_hash);
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

    /// Re-create the `.torrent` archives that are missing or unconfirmed.
    ///
    /// Used on the launch that follows an unclean exit: the archive vault is written on a
    /// timer, so a crash can happen between "metadata known" and "archive on disk". The
    /// payload is recoverable (librqbit re-hashes it), but the `.torrent` bytes are not —
    /// without them a torrent could not be re-added from scratch.
    ///
    /// The session is passed in rather than read from the cell: this runs *during* the cell's
    /// initialisation, where `self.session.get()` would still be empty.
    async fn refresh_archives(&self, session: &Arc<Session>) {
        let handles = Self::handles(session);
        if handles.is_empty() {
            return;
        }

        let settings = self.settings.read().await.clone();
        let mut written = 0usize;

        for handle in handles {
            let info_hash = handle.info_hash().as_string();
            let (recorded, path) = {
                let guard = self.extras.lock().await;
                guard
                    .get(&info_hash)
                    .map(|extras| (extras.backed_up, extras.backup_path.clone()))
                    .unwrap_or((false, None))
            };
            let still_on_disk = path
                .as_deref()
                .map(|path| Path::new(path).is_file())
                .unwrap_or(false);
            if recorded && still_on_disk {
                continue;
            }

            let Some(archive) = self.write_backup_file(&handle, &settings).await else {
                continue;
            };
            let mut guard = self.extras.lock().await;
            let extras = guard.entry(info_hash).or_default();
            extras.backed_up = true;
            extras.backup_path = Some(archive);
            extras.last_backup_at = now_ms();
            written += 1;
        }

        if written > 0 {
            log::info!("crash recovery: re-wrote {written} .torrent archive(s)");
        }
        self.persist_state().await;
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
            default_settings(self.state_dir.as_path()).backup_dir
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
            default_settings(self.state_dir.as_path()).completed_torrent_dir
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

/// Pre-create sparse placeholders for the torrents librqbit is about to restore.
///
/// librqbit's session database is plain JSON (`session.json`) with one `<info_hash>.torrent`
/// next to it, so every payload path and file selection can be reconstructed *before* the
/// session starts. Restored torrents do not pass through [`TorrentEngine::add_resolved`], and
/// without this they would still be allocated densely on launch — the same disk-eating bug,
/// just on the restore path.
fn precreate_restored_payloads(persistence_dir: &Path) {
    #[derive(Deserialize)]
    struct Database {
        #[serde(default)]
        torrents: HashMap<String, Record>,
    }

    #[derive(Deserialize)]
    struct Record {
        #[serde(default)]
        info_hash: String,
        #[serde(default)]
        output_folder: String,
    }

    let manifest = persistence_dir.join("session.json");
    let Ok(raw) = fs::read(&manifest) else {
        return;
    };
    let Ok(database) = serde_json::from_slice::<Database>(&raw) else {
        log::warn!(
            "cannot read {}; restored payload files will not be pre-created",
            manifest.display()
        );
        return;
    };

    for record in database.torrents.values() {
        if record.info_hash.is_empty() || record.output_folder.is_empty() {
            continue;
        }

        let torrent_path = persistence_dir.join(format!("{}.torrent", record.info_hash));
        let Ok(torrent_bytes) = fs::read(&torrent_path) else {
            continue;
        };
        let Ok(parsed) = torrent_from_bytes(&torrent_bytes) else {
            continue;
        };
        let Ok(info) = parsed.info.data.validate() else {
            continue;
        };

        // All files, not just `only_files`: librqbit extends every file during init (see
        // `add_resolved`), so a placeholder that is missing here would be allocated densely.
        let files = payload_files(&info, None);
        match sparse::prepare_payload(Path::new(&record.output_folder), &files) {
            Ok(summary) if summary.files > 0 => log::info!(
                "pre-created {} sparse placeholder(s) for restored torrent {} ({})",
                summary.files,
                short_hash(&record.info_hash),
                record.output_folder
            ),
            Ok(summary) if summary.skipped > 0 => log::warn!(
                "restored torrent {}: {} payload path(s) are occupied by something that is not \
                 a file and were left alone",
                short_hash(&record.info_hash),
                summary.skipped
            ),
            Ok(_) => {}
            Err(err) => log::warn!(
                "cannot pre-create payload for restored torrent {}: {err}",
                short_hash(&record.info_hash)
            ),
        }
    }
}

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
    let candidate = download_base_dir(settings, requested);

    fs::create_dir_all(&candidate).map_err(|e| {
        format!(
            "cannot create download directory {}: {e}",
            candidate.display()
        )
    })?;
    Ok(candidate)
}

/// The folder a torrent's payload folder is created in, without touching the disk.
///
/// Same priority as [`resolve_download_dir`] (explicit choice → configured default → OS
/// downloads folder) but side-effect free, so the add dialog can inspect a destination
/// before the user has committed to it.
fn download_base_dir(settings: &ClientSettings, requested: Option<&str>) -> PathBuf {
    requested
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
        .unwrap_or_else(|| std::env::temp_dir().join("MakeMakeDownloads"))
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

/// Turn a torrent name into a single, safe path component.
///
/// This delegates to `sanitize-filename`, which implements the same rules as Node's module
/// of that name: characters NTFS rejects (`\ / : * ? " < > |`) become `_`, control
/// characters are dropped, Windows device names (`CON`, `NUL`, `COM1`, …) are neutralised,
/// trailing dots/spaces are removed and the result is capped at 255 bytes. Ordinary
/// punctuation is *kept*, so `Cyberpunk 2077 [DODI Repack]` stays readable instead of
/// turning into `Cyberpunk 2077 _DODI Repack_`.
fn sanitize_file_name(name: &str) -> String {
    // Windows refuses to create a component that ends in a dot or a space. The crate would
    // replace that run with the replacement string instead of dropping it, so drop it first.
    let name = name.trim().trim_end_matches(['.', ' ']);
    if name.is_empty() {
        return "makemake-torrent".to_string();
    }

    let cleaned = sanitize_filename::sanitize_with_options(
        name,
        sanitize_filename::Options {
            // MakeMake only ships Windows builds, and a state/vault folder that is copied to
            // a network share should stay portable, so Windows rules are always applied.
            windows: true,
            truncate: true,
            replacement: "_",
        },
    );

    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned.chars().all(|c| c == '_') {
        return "makemake-torrent".to_string();
    }

    // Keep room for the archive suffix (`-<hash>.torrent`) and for the download folder to
    // nest a few levels deep below the user's chosen root.
    let trimmed: String = cleaned.chars().take(96).collect();
    trimmed.trim_end().to_string()
}

/// The folder a torrent's payload is written to: `<download folder>/<torrent name>`.
///
/// Every torrent keeps its output in a folder of its own — the folder is named after the
/// torrent's `name` from its metadata, which is the same title the UI shows. Without it, a
/// multi-file torrent drops its files straight into the chosen download folder, where they
/// collide with other torrents, with restored partial downloads, and with the user's own
/// files. This mirrors librqbit's own default layout (`output_folder` + the torrent name),
/// which MakeMake cannot use directly because it passes an explicit `output_folder` for the
/// per-add destination prompt.
///
/// The one exception is a torrent whose file paths already begin with their own name
/// (`Name/…`, which some trackers produce): the payload then nests itself, and another
/// `Name` folder would only add a redundant `Name/Name/…` level.
fn payload_dir(base_dir: &Path, name: &str, payload: &[(PathBuf, u64)]) -> PathBuf {
    let folder = sanitize_file_name(name);

    let already_nested = !payload.is_empty()
        && payload.iter().all(|(path, _)| {
            let mut components = path.components();
            match components.next() {
                Some(Component::Normal(first)) => {
                    components.next().is_some()
                        && sanitize_file_name(&first.to_string_lossy()) == folder
                }
                _ => false,
            }
        });

    if already_nested {
        base_dir.to_path_buf()
    } else {
        base_dir.join(folder)
    }
}

/// Everything needed to place one torrent's payload on disk.
///
/// Computed in exactly one place so the add dialog's "this folder already exists" question
/// and the actual write target can never disagree.
struct PayloadLayout {
    info_hash: String,
    /// `<download folder>/<torrent name>` (or the download folder itself for payloads that
    /// already nest inside a folder of the same name — see [`payload_dir`]).
    output_dir: PathBuf,
    /// Non-padding files, in torrent order, with their declared lengths.
    all_files: Vec<(PathBuf, u64)>,
    /// The same files, keeping the file index that `only_files` refers to.
    indexed_files: Vec<(usize, PathBuf, u64)>,
    /// Sum of every file's declared length (padding included), i.e. the torrent size.
    total_bytes: u64,
}

/// Resolve a torrent's payload layout against `base_dir`.
///
/// Fails only when the metadata itself is unusable (corrupt bencode, invalid info dict).
fn payload_layout(torrent_bytes: &[u8], base_dir: &Path) -> Result<PayloadLayout, String> {
    let parsed = torrent_from_bytes(torrent_bytes)
        .map_err(|e| format!("invalid .torrent payload: {e}"))?;
    let info = parsed
        .info
        .data
        .validate()
        .map_err(|e| format!("torrent metadata is invalid: {e}"))?;
    let info_hash = parsed.info_hash.as_string();
    let name = info
        .name_or_else(|| format!("Torrent {}", short_hash(&info_hash)))
        .into_owned();

    let indexed_files: Vec<(usize, PathBuf, u64)> = info
        .iter_file_details()
        .enumerate()
        .filter(|(_, details)| !details.attrs().padding)
        .map(|(index, details)| (index, details.filename.to_pathbuf(), details.len))
        .collect();
    let all_files: Vec<(PathBuf, u64)> = indexed_files
        .iter()
        .map(|(_, path, length)| (path.clone(), *length))
        .collect();

    // Every torrent is written into its own folder, named after the torrent itself, so a
    // payload never lands loose in the download folder next to other torrents (or the user's
    // own files). See [`payload_dir`].
    let output_dir = payload_dir(base_dir, &name, &all_files);
    let total_bytes = info.lengths().total_length();

    Ok(PayloadLayout {
        info_hash,
        output_dir,
        all_files,
        indexed_files,
        total_bytes,
    })
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

/// The payload files (relative path + length) that will end up on disk.
///
/// Padding files are never created, and a partial selection only touches the files the user
/// actually asked for.
fn payload_files<B: AsRef<[u8]>>(
    info: &ValidatedTorrentMetaV1Info<B>,
    only_files: Option<&[usize]>,
) -> Vec<(PathBuf, u64)> {
    info.iter_file_details()
        .enumerate()
        .filter(|(index, details)| {
            !details.attrs().padding
                && only_files
                    .map(|selected| selected.contains(index))
                    .unwrap_or(true)
        })
        .map(|(_, details)| (details.filename.to_pathbuf(), details.len))
        .collect()
}

/// Which files the user chose in the add dialog, if they chose a subset.
///
/// `None` means "everything"; an empty selection is a user error and is rejected here
/// rather than producing a torrent that can never finish.
fn selected_indices(preview: &TorrentMetadataPreview) -> Result<Option<Vec<usize>>, String> {
    // Padding files are never written to disk, so they are not part of the decision.
    let payload: Vec<&TorrentFileItem> = preview.files.iter().filter(|file| !file.padding).collect();

    if payload.is_empty() {
        // Magnet whose metadata has not arrived yet: everything will be downloaded.
        return Ok(None);
    }

    let selected: Vec<usize> = payload
        .iter()
        .filter(|file| file.selected)
        .map(|file| file.index)
        .collect();

    if selected.is_empty() {
        return Err("no files selected for download".to_string());
    }

    if selected.len() == payload.len() {
        Ok(None)
    } else {
        Ok(Some(selected))
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
                padding: details.attrs().padding,
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
fn build_item(
    handle: &Arc<ManagedTorrent>,
    stats: &TorrentStats,
    extras: &TorrentExtras,
    meta: Option<&CachedMeta>,
) -> TorrentItem {
    let info_hash = handle.info_hash().as_string();

    // Metadata comes from the per-session cache: walking `iter_file_details()` here allocated
    // a String per path component for every torrent on every single poll.
    let piece_count = meta.map(|m| m.piece_count).unwrap_or(0);
    let piece_length = meta.map(|m| m.piece_length).unwrap_or(0);
    let mut files = meta.map(|m| m.files.clone()).unwrap_or_default();

    // Honour the file selection the torrent was added with (if any).
    if let Some(only_files) = handle.only_files() {
        for file in files.iter_mut() {
            file.selected = only_files.contains(&file.index);
        }
    }

    let total_bytes = if stats.total_bytes > 0 {
        stats.total_bytes
    } else {
        meta.map(|m| m.total_bytes).unwrap_or(0)
    };
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

    // Verified pieces are derived from the bytes librqbit reports as present, so the number
    // is honest even though the visual map is a coarse bucketing of it.
    let pieces_completed = if piece_length > 0 {
        ((downloaded_bytes / piece_length) as usize).min(piece_count)
    } else {
        0
    };
    let pieces_bitfield = coarse_piece_map(downloaded_bytes, total_bytes);

    // librqbit only reports per-file progress once the torrent is initialized; pad the
    // vector so the UI can index it by file position without bounds checks.
    let mut file_progress = stats.file_progress.clone();
    if file_progress.len() < files.len() {
        file_progress.resize(files.len(), 0);
    }

    TorrentItem {
        id: info_hash.clone(),
        name: meta
            .map(|m| m.name.clone())
            .or_else(|| handle.name())
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
        resolving: false,
    }
}

/// Coarse, fixed-size map of how much of the payload is verified.
///
/// librqbit does not expose the real piece bitfield, and a torrent like a 133 GiB repack has
/// ~34k pieces — one DOM node per piece is what used to lock up the details drawer. The UI
/// only ever draws a small matrix, so it gets a constant number of buckets derived from the
/// verified byte count.
fn coarse_piece_map(downloaded_bytes: u64, total_bytes: u64) -> Vec<u8> {
    let fraction = if total_bytes == 0 {
        0.0
    } else {
        (downloaded_bytes as f64 / total_bytes as f64).clamp(0.0, 1.0)
    };
    let filled = (fraction * COARSE_BUCKETS as f64).floor() as usize;

    (0..COARSE_BUCKETS)
        .map(|bucket| u8::from(bucket < filled))
        .collect()
}









// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Torrent names become folders on disk, so they must survive sanitising *and* stay
    /// recognisable: only characters Windows rejects are replaced.
    #[test]
    fn torrent_names_stay_readable_but_path_safe() {
        assert_eq!(
            sanitize_file_name("Cyberpunk 2077 [DODI Repack]"),
            "Cyberpunk 2077 [DODI Repack]"
        );
        assert_eq!(
            sanitize_file_name("AC/DC: Live & Loud?"),
            "AC_DC_ Live & Loud_"
        );
        // Windows refuses trailing dots and spaces.
        assert_eq!(sanitize_file_name("ubuntu-24.04. "), "ubuntu-24.04");
        // Reserved device names would create an unusable path (or a device handle).
        assert!(!sanitize_file_name("CON").eq_ignore_ascii_case("con"));
        assert!(!sanitize_file_name("nul.txt").eq_ignore_ascii_case("nul.txt"));
        // Nothing usable left, or absurdly long: still a valid component.
        assert_eq!(sanitize_file_name("..."), "makemake-torrent");
        assert_eq!(sanitize_file_name("   "), "makemake-torrent");
        assert_eq!(sanitize_file_name(&"a".repeat(500)).chars().count(), 96);
    }

    /// `/` and `\` must never survive, or a torrent name could escape the download folder.
    #[test]
    fn sanitizing_never_produces_a_path_separator() {
        use std::path::Component;

        let hostile = sanitize_file_name("../../etc/passwd\\..\\boot.ini");
        assert!(!hostile.contains('/'), "got {hostile}");
        assert!(!hostile.contains('\\'), "got {hostile}");

        // The result has to be exactly one ordinary component: never `.`, never `..`, never a
        // prefix, so joining it onto the download folder cannot leave that folder.
        let mut components = Path::new(&hostile).components();
        assert!(matches!(components.next(), Some(Component::Normal(_))), "got {hostile}");
        assert!(components.next().is_none(), "got {hostile}");

        let base = Path::new("C:/Downloads/MakeMake");
        assert_eq!(
            base.join(&hostile).parent(),
            Some(base),
            "escaped the download folder"
        );
    }

    /// Every torrent is written into a folder named after itself — single-file torrents too,
    /// which used to be dropped loose into the download folder.
    #[test]
    fn payloads_land_in_a_folder_named_after_the_torrent() {
        let base = Path::new("C:/Downloads/MakeMake");

        // Multi-file torrent with flat paths, i.e. the `Cyberpunk 2077 [DODI Repack]` layout.
        let flat = [
            (PathBuf::from("Chinese.doi"), 10u64),
            (PathBuf::from("data1.doi"), 20),
        ];
        assert_eq!(
            payload_dir(base, "Cyberpunk 2077 [DODI Repack]", &flat),
            base.join("Cyberpunk 2077 [DODI Repack]")
        );

        // Single-file torrents are no longer left lying in the download folder.
        let single = [(PathBuf::from("ubuntu-24.04-desktop-amd64.iso"), 42u64)];
        assert_eq!(
            payload_dir(base, "ubuntu-24.04-desktop-amd64.iso", &single),
            base.join("ubuntu-24.04-desktop-amd64.iso")
        );

        // A torrent that already carries sub-folders keeps them *below* its own folder.
        let nested = [
            (PathBuf::from("Season 01/episode-01.mkv"), 1u64),
            (PathBuf::from("Season 01/episode-02.mkv"), 2),
        ];
        assert_eq!(
            payload_dir(base, "Some Show", &nested),
            base.join("Some Show")
        );
    }

    /// A torrent whose paths already start with their own name must not be nested twice.
    #[test]
    fn payloads_are_not_nested_twice() {
        let base = Path::new("C:/Downloads/MakeMake");

        let nested = [
            (PathBuf::from("Some Show/Season 01/e01.mkv"), 1u64),
            (PathBuf::from("Some Show/Season 01/e02.mkv"), 2),
        ];
        assert_eq!(payload_dir(base, "Some Show", &nested), base);

        // One file outside that leading folder means the payload would land in two places,
        // so the torrent folder is still required.
        let mixed = [
            (PathBuf::from("Some Show/Season 01/e01.mkv"), 1u64),
            (PathBuf::from("notes.txt"), 2),
        ];
        assert_eq!(
            payload_dir(base, "Some Show", &mixed),
            base.join("Some Show")
        );
    }

    /// The payload folder can never be placed outside the folder the user picked.
    #[test]
    fn payload_folder_cannot_escape_the_download_folder() {
        let base = Path::new("C:/Downloads/MakeMake");
        let flat = [(PathBuf::from("payload.bin"), 1u64)];

        let dir = payload_dir(base, "../../Windows/System32", &flat);
        assert_eq!(dir.parent(), Some(base), "got {}", dir.display());
    }

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

        // Production walks the same path: metadata is snapshotted once, then reused.
        let cached = CachedMeta::from_handle(&handle).expect("metadata should be available");
        assert_eq!(cached.piece_count, 1);
        assert_eq!(cached.files.len(), 1);

        let item = build_item(&handle, &stats, &extras, Some(&cached));
        assert_eq!(item.name, "test.txt");
        assert_eq!(item.total_bytes, 5);
        assert_eq!(item.piece_count, 1);
        assert_eq!(item.files.len(), 1);
        assert_eq!(item.pieces_bitfield.len(), COARSE_BUCKETS);
        assert!(!item.resolving);
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

    /// Single-file torrent whose payload is exactly `length` bytes.
    fn single_file_torrent_bencode(name: &str, length: u64, piece_length: u32) -> Vec<u8> {
        let pieces = (length.div_ceil(piece_length as u64) as usize) * 20;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"d4:infod6:lengthi");
        bytes.extend_from_slice(length.to_string().as_bytes());
        bytes.extend_from_slice(format!("e4:name{}:{name}12:piece lengthi", name.len()).as_bytes());
        bytes.extend_from_slice(piece_length.to_string().as_bytes());
        bytes.extend_from_slice(b"e6:pieces");
        bytes.extend_from_slice(pieces.to_string().as_bytes());
        bytes.extend_from_slice(b":");
        bytes.extend_from_slice(&vec![0u8; pieces]);
        bytes.extend_from_slice(b"ee");
        bytes
    }

    /// The `ON DISK` figure the drawer shows: the engine must see the full logical payload
    /// length while the filesystem has reserved almost nothing for the sparse placeholder.
    #[tokio::test]
    async fn disk_usage_reports_a_sparse_payload() {
        const LENGTH: u64 = 8 * 1024 * 1024;

        let root = std::env::temp_dir().join(format!("makemake-usage-engine-{}", std::process::id()));
        let output = root.join("out");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&output).unwrap();

        // Same pre-creation the add path performs before handing the torrent to librqbit.
        sparse::prepare_payload(&output, &[(PathBuf::from("big.bin"), LENGTH)]).unwrap();

        let bytes = single_file_torrent_bencode("big.bin", LENGTH, 16_384);
        let info_hash = torrent_from_bytes(&bytes)
            .expect("sample must parse")
            .info_hash
            .as_string();

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

        session
            .add_torrent(
                AddTorrent::from_bytes(bytes),
                Some(AddTorrentOptions {
                    paused: true,
                    overwrite: true,
                    ..Default::default()
                }),
            )
            .await
            .expect("torrent should be added");

        // `torrent_disk_usage` resolves the session through the engine's own lazily-created
        // cell; seeding it keeps the test offline.
        let engine = TorrentEngine::with_state_dir(root.join("state"));
        engine.session.set(session).ok();

        // librqbit extends the payload during initialisation, so wait for that to land.
        let mut usage = TorrentDiskUsage::default();
        for _ in 0..100 {
            usage = engine
                .torrent_disk_usage(&info_hash)
                .await
                .expect("usage must be measurable");
            if usage.logical_bytes == LENGTH {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        assert_eq!(usage.files, 1, "the payload file exists on disk");
        assert_eq!(usage.logical_bytes, LENGTH, "the declared size must be reported");
        assert!(
            usage.allocated_bytes < 1024 * 1024,
            "a sparse payload must not be allocated densely, got {} bytes",
            usage.allocated_bytes
        );

        fs::remove_dir_all(&root).ok();
    }

    /// Multi-file torrent with three files, the middle one a BEP-47 padding file.
    fn multi_file_torrent_bencode() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(
            b"d8:announce26:udp://tracker.test:1337/xx4:infod5:filesl\
              d6:lengthi5e4:pathl5:a.txtee\
              d4:attr1:p6:lengthi7e4:pathl7:pad.binee\
              d6:lengthi9e4:pathl5:c.txtee\
              e4:name3:dir12:piece lengthi16384e6:pieces20:",
        );
        bytes.extend_from_slice(&[b'A'; 20]);
        bytes.extend_from_slice(b"ee");
        bytes
    }

    #[test]
    fn payload_paths_skip_padding_and_follow_the_selection() {
        let bytes = multi_file_torrent_bencode();
        let parsed = torrent_from_bytes(&bytes).expect("sample must parse");
        let info = parsed.info.data.validate().expect("sample must validate");

        let all = payload_files(&info, None);
        assert_eq!(
            all,
            vec![
                (PathBuf::from("a.txt"), 5),
                (PathBuf::from("c.txt"), 9)
            ],
            "padding must never be created on disk"
        );

        // Selecting only the padding file leaves nothing to pre-create.
        assert!(payload_files(&info, Some(&[1])).is_empty());

        assert_eq!(payload_files(&info, Some(&[2])), vec![(PathBuf::from("c.txt"), 9)]);
    }

    /// End-to-end: the folder handed to librqbit is the folder the payload lands in, and
    /// nothing is written beside it into the shared download folder.
    #[tokio::test]
    async fn torrents_write_their_payload_into_their_own_folder() {
        let root = std::env::temp_dir().join(format!("makemake-layout-{}", std::process::id()));
        let base = root.join("downloads");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&base).unwrap();

        let bytes = multi_file_torrent_bencode();
        let parsed = torrent_from_bytes(&bytes).expect("sample must parse");
        let info = parsed.info.data.validate().expect("sample must validate");
        let name = info.name().expect("sample carries a name").into_owned();
        let payload = payload_files(&info, None);

        // The sample's paths (`a.txt`, `c.txt`) are flat, so the torrent gets its own folder.
        let output = payload_dir(&base, &name, &payload);
        assert_eq!(output, base.join("dir"));

        let session = Session::new_with_opts(
            base.clone(),
            SessionOptions {
                dht: None,
                persistence: None,
                listen: None,
                ..Default::default()
            },
        )
        .await
        .expect("offline session should start");

        // Deliberately *not* pre-created: librqbit has to create the payload itself, so this
        // also proves it honours the explicit `output_folder` instead of the session default.
        let response = session
            .add_torrent(
                AddTorrent::from_bytes(bytes),
                Some(AddTorrentOptions {
                    paused: true,
                    overwrite: true,
                    output_folder: Some(output.to_string_lossy().to_string()),
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
        assert_eq!(handle.output_folder(), output.as_path());

        // Payload files are opened (and extended) by librqbit's background initialisation.
        let nested = output.join("a.txt");
        for _ in 0..100 {
            if fs::metadata(&nested).map(|m| m.len()).unwrap_or(0) == 5 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        assert!(
            nested.is_file(),
            "the payload must be written inside the torrent folder"
        );
        assert!(
            !base.join("a.txt").exists(),
            "no payload file may land in the shared download folder"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn restored_payloads_are_pre_created_sparse() {
        let root = std::env::temp_dir().join(format!("makemake-restore-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        let persistence = root.join("session");
        let output = root.join("downloads");
        fs::create_dir_all(&persistence).unwrap();

        let bytes = multi_file_torrent_bencode();
        let info_hash = torrent_from_bytes(&bytes)
            .expect("sample must parse")
            .info_hash
            .as_string();
        fs::write(persistence.join(format!("{info_hash}.torrent")), &bytes).unwrap();

        let output_json = output.to_string_lossy().replace('\\', "\\\\");
        fs::write(
            persistence.join("session.json"),
            format!(
                r#"{{"torrents":{{"0":{{"info_hash":"{info_hash}","trackers":[],"output_folder":"{output_json}","only_files":[0],"is_paused":false}}}}}}"#
            ),
        )
        .unwrap();

        precreate_restored_payloads(&persistence);

        // librqbit extends every file of a torrent during initialisation, so every payload
        // file gets a sparse placeholder — padding files never do.
        for name in ["a.txt", "c.txt"] {
            let path = output.join(name);
            assert!(path.is_file(), "{name} must exist");
            assert_eq!(
                fs::metadata(&path).unwrap().len(),
                0,
                "placeholders stay empty so librqbit's check is instant"
            );
        }
        assert!(!output.join("pad.bin").exists(), "padding is never created");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn coarse_piece_map_stays_small_and_tracks_progress() {
        assert_eq!(coarse_piece_map(0, 0), vec![0u8; COARSE_BUCKETS]);

        let half = coarse_piece_map(50, 100);
        assert_eq!(half.len(), COARSE_BUCKETS);
        assert_eq!(half.iter().filter(|bit| **bit == 1).count(), COARSE_BUCKETS / 2);

        assert!(coarse_piece_map(100, 100).iter().all(|bit| *bit == 1));
        assert!(coarse_piece_map(10, 100).len() < 1000, "must not scale with piece count");
    }

    #[test]
    fn queued_magnets_are_listed_before_librqbit_knows_them() {
        let mut queued = PendingAdd {
            info_hash: "abcdef0123456789abcdef0123456789abcdef01".to_string(),
            name: String::new(),
            magnet_uri: "magnet:?xt=urn:btih:abc".to_string(),
            output_dir: PathBuf::from("D:/downloads"),
            only_files: None,
            created_at: 1,
            error: None,
            total_bytes: 0,
            piece_count: 0,
            files: Vec::new(),
            attempts: 1,
            resolving: true,
        };

        let item = queued.to_item();
        assert_eq!(item.status, "Resolving");
        assert!(item.resolving);
        assert_eq!(item.id, queued.info_hash);
        assert!(item.name.starts_with("Magnet "), "missing name gets a placeholder");
        assert_eq!(item.pieces_bitfield.len(), COARSE_BUCKETS);

        queued.error = Some("no metadata after 180s".to_string());
        let failed = queued.to_item();
        assert_eq!(failed.status, "Error");
        assert_eq!(failed.error.as_deref(), Some("no metadata after 180s"));
        assert!(failed.resolving, "a failed magnet is still a queue entry");
    }

    #[test]
    fn file_selection_becomes_an_only_files_list() {
        let file = |index: usize, selected: bool| TorrentFileItem {
            index,
            name: format!("file-{index}.bin"),
            path: format!("file-{index}.bin"),
            length: 1,
            selected,
            padding: false,
        };
        let mut preview = TorrentMetadataPreview {
            name: "payload".to_string(),
            info_hash: "00".to_string(),
            total_size: 2,
            piece_length: 1,
            piece_count: 2,
            files: vec![file(0, true), file(1, false)],
            is_magnet: false,
            magnet_uri: None,
            raw_bencode_base64: None,
        };

        assert_eq!(selected_indices(&preview).unwrap(), Some(vec![0]));

        preview.files[1].selected = true;
        assert_eq!(
            selected_indices(&preview).unwrap(),
            None,
            "selecting everything means 'no filter'"
        );

        for entry in preview.files.iter_mut() {
            entry.selected = false;
        }
        assert!(selected_indices(&preview).is_err(), "empty selection is rejected");

        // A magnet whose metadata has not arrived downloads everything.
        preview.files.clear();
        assert_eq!(selected_indices(&preview).unwrap(), None);
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

    /// Single-file torrent whose only piece hash is `piece_hash` (so it can be matched
    /// against real bytes written to disk).
    fn torrent_with_piece_hash(name: &str, length: u64, piece_hash: &[u8; 20]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"d4:infod6:lengthi");
        bytes.extend_from_slice(length.to_string().as_bytes());
        bytes.extend_from_slice(
            format!("e4:name{}:{name}12:piece lengthi16384e6:pieces20:", name.len()).as_bytes(),
        );
        bytes.extend_from_slice(piece_hash);
        bytes.extend_from_slice(b"ee");
        bytes
    }

    /// The whole point of the existing-folder prompt: data that is already on disk is
    /// verified and kept, only the missing pieces are fetched.
    #[tokio::test]
    async fn existing_payload_is_adopted_instead_of_re_downloaded() {
        // SHA-1 of b"hello world".
        const PIECE_HASH: [u8; 20] = [
            0x2a, 0xae, 0x6c, 0x35, 0xc9, 0x4f, 0xcf, 0xb4, 0x15, 0xdb, 0xe9, 0x5f, 0x40, 0x8b,
            0x9c, 0xe9, 0x1e, 0xe8, 0x46, 0xed,
        ];
        const PAYLOAD: &[u8] = b"hello world";

        let root = std::env::temp_dir().join(format!("makemake-resume-{}", std::process::id()));
        let base = root.join("downloads");
        let payload = base.join("resume.bin").join("resume.bin");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(payload.parent().unwrap()).unwrap();
        fs::write(&payload, PAYLOAD).unwrap();

        let bytes = torrent_with_piece_hash("resume.bin", PAYLOAD.len() as u64, &PIECE_HASH);
        let session = Session::new_with_opts(
            base.clone(),
            SessionOptions {
                dht: None,
                persistence: None,
                listen: None,
                ..Default::default()
            },
        )
        .await
        .expect("offline session should start");

        // Exactly what `add_resolved` does: the per-torrent folder as output, overwrite on.
        let response = session
            .add_torrent(
                AddTorrent::from_bytes(bytes),
                Some(AddTorrentOptions {
                    paused: true,
                    overwrite: true,
                    output_folder: Some(base.join("resume.bin").to_string_lossy().to_string()),
                    ..Default::default()
                }),
            )
            .await
            .expect("torrent should be added over the existing payload");
        let handle = match response {
            AddTorrentResponse::Added(_, handle)
            | AddTorrentResponse::AlreadyManaged(_, handle) => handle,
            _ => panic!("expected the torrent to be added"),
        };

        // The existing-file hash check runs asynchronously.
        let mut stats = handle.stats();
        for _ in 0..100 {
            if stats.progress_bytes >= PAYLOAD.len() as u64 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            stats = handle.stats();
        }

        assert_eq!(
            stats.progress_bytes,
            PAYLOAD.len() as u64,
            "the piece already on disk must be adopted, not downloaded again"
        );
        assert!(stats.finished, "a fully present payload verifies as complete");
        assert_eq!(
            fs::read(&payload).unwrap(),
            PAYLOAD,
            "resuming must never rewrite the payload"
        );

        fs::remove_dir_all(&root).ok();
    }

    /// The add dialog's pre-flight: what exists, how much of it is usable, and what else is
    /// in the folder.
    #[tokio::test]
    async fn inspect_destination_reports_the_existing_folder() {
        let root = std::env::temp_dir().join(format!("makemake-inspect-{}", std::process::id()));
        let base = root.join("downloads");
        fs::remove_dir_all(&root).ok();

        let engine = TorrentEngine::with_state_dir(root.join("state"));
        let bytes = multi_file_torrent_bencode();
        let preview = TorrentEngine::parse_torrent_file("pack.torrent", &BASE64.encode(&bytes))
            .expect("sample must parse");

        // Nothing there yet — and inspecting must not create anything.
        let absent = engine
            .inspect_destination(&preview, &base.to_string_lossy())
            .await
            .expect("inspection must succeed")
            .expect("a parsed torrent always has a destination");
        assert_eq!(absent.folder, base.join("dir").to_string_lossy());
        assert!(!absent.exists);
        assert_eq!(absent.files_total, 2, "the padding file is not payload");
        assert_eq!(absent.files_present, 0);
        assert!(!base.exists(), "inspecting a destination must be read-only");

        // One complete file, one partial, plus an unrelated file.
        let folder = base.join("dir");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("a.txt"), vec![0u8; 5]).unwrap();
        fs::write(folder.join("c.txt"), vec![0u8; 3]).unwrap();
        fs::write(folder.join("notes.txt"), b"mine").unwrap();

        let report = engine
            .inspect_destination(&preview, &base.to_string_lossy())
            .await
            .expect("inspection must succeed")
            .expect("a parsed torrent always has a destination");
        assert!(report.exists);
        assert_eq!(report.files_total, 2);
        assert_eq!(report.files_present, 2);
        assert_eq!(report.files_complete, 1);
        assert_eq!(report.bytes_total, 14, "5 + 9 payload bytes");
        assert_eq!(report.bytes_present, 8, "5 complete + 3 partial");
        assert_eq!(report.foreign_files, 1);
        assert!(!report.already_managed);

        // An unresolved magnet has no payload paths, so there is nothing to inspect.
        let magnet = TorrentMetadataPreview {
            name: "magnet".to_string(),
            info_hash: "00".repeat(20),
            total_size: 0,
            piece_length: 0,
            piece_count: 0,
            files: Vec::new(),
            is_magnet: true,
            magnet_uri: Some("magnet:?xt=urn:btih:".to_string()),
            raw_bencode_base64: None,
        };
        assert!(engine
            .inspect_destination(&magnet, &base.to_string_lossy())
            .await
            .expect("inspection must not fail")
            .is_none());

        fs::remove_dir_all(&root).ok();
    }

    /// "Start over" erases the torrent's own payload and nothing else, and "resume" never
    /// touches a byte.
    #[tokio::test]
    async fn add_mode_resume_keeps_files_and_start_over_erases_only_the_payload() {
        let root = std::env::temp_dir().join(format!("makemake-mode-{}", std::process::id()));
        let base = root.join("downloads");
        let folder = base.join("dir");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("a.txt"), b"stale").unwrap();
        fs::write(folder.join("keep.txt"), b"mine").unwrap();

        let engine = TorrentEngine::with_state_dir(root.join("state"));
        // Keep the engine's default folder inside the sandbox (the session reads it too).
        let mut settings = engine.get_settings().await;
        settings.default_download_dir = base.to_string_lossy().to_string();
        engine.update_settings(settings).await;

        let session = Session::new_with_opts(
            base.clone(),
            SessionOptions {
                dht: None,
                persistence: None,
                listen: None,
                ..Default::default()
            },
        )
        .await
        .expect("offline session should start");
        engine.session.set(session).ok();

        let bytes = multi_file_torrent_bencode();
        let preview = TorrentEngine::parse_torrent_file("pack.torrent", &BASE64.encode(&bytes))
            .expect("sample must parse");
        let target = base.to_string_lossy().to_string();

        // Resume: the stale payload is left exactly as it is (librqbit re-hashes it later).
        engine
            .add_torrent(preview.clone(), target.clone(), Some("resume".to_string()))
            .await
            .expect("resume add should succeed");
        assert_eq!(fs::read(folder.join("a.txt")).unwrap(), b"stale");

        // Start over: the declared payload is gone, the unrelated file is not.
        engine
            .add_torrent(preview, target, Some("replace".to_string()))
            .await
            .expect("start-over add should succeed");

        let payload = fs::read(folder.join("a.txt")).unwrap();
        assert_ne!(payload, b"stale", "start over must erase the old bytes");
        assert!(
            payload.iter().all(|byte| *byte == 0),
            "the payload is re-created as a sparse placeholder, not with old data"
        );
        assert_eq!(
            fs::read(folder.join("keep.txt")).unwrap(),
            b"mine",
            "files that are not part of the torrent must survive"
        );

        fs::remove_dir_all(&root).ok();
    }

    /// The run marker is what tells the next launch that the previous one crashed.
    #[tokio::test]
    async fn the_crash_marker_survives_a_crash_and_clears_on_a_clean_seal() {
        let root = std::env::temp_dir().join(format!("makemake-marker-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();

        let engine = TorrentEngine::with_state_dir(root.clone());
        assert!(!engine.crashed_last_run(), "a first run has nothing to recover");
        assert!(
            root.join(CRASH_MARKER_NAME).is_file(),
            "the marker must be armed while the app runs"
        );

        // A second engine on the same state dir sees the marker: the first run "crashed".
        let crashed = TorrentEngine::with_state_dir(root.clone());
        assert!(crashed.crashed_last_run());

        // A clean seal removes it again.
        engine.shutdown().await.expect("shutdown must succeed");
        assert!(
            !root.join(CRASH_MARKER_NAME).exists(),
            "a sealed run must clear its marker"
        );

        fs::remove_dir_all(&root).ok();
    }
}
