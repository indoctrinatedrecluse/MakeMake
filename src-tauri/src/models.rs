use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFileItem {
    pub index: usize,
    pub name: String,
    pub path: String,
    pub length: u64,
    pub selected: bool,
    /// BEP-47 padding file: it is never written to disk, so it must not be offered for
    /// selection nor counted when MakeMake inspects an existing payload folder.
    #[serde(default)]
    pub padding: bool,
}

/// What already sits in the folder a torrent is about to be written to.
///
/// MakeMake resolves every torrent to `<download folder>/<torrent name>`, so an existing
/// folder means the user either has an earlier attempt, a complete copy, or an unrelated
/// folder that happens to share the name. The add dialog asks before touching it; when the
/// user confirms, librqbit only has to hash the files that are already there and download
/// the missing pieces instead of starting from zero.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingPayload {
    /// Absolute path of the per-torrent folder (`<download folder>/<torrent name>`).
    pub folder: String,
    /// `true` when that folder already exists on disk.
    pub exists: bool,
    /// Payload files (of the current selection) that exist on disk.
    pub files_present: usize,
    /// Payload files (of the current selection) that are already at their full length.
    pub files_complete: usize,
    /// Number of payload files in the current selection.
    pub files_total: usize,
    /// Logical bytes on disk for those files, capped at each file's declared length.
    pub bytes_present: u64,
    /// Declared bytes of the current selection.
    pub bytes_total: u64,
    /// Entries inside the folder that are *not* part of this torrent (capped).
    pub foreign_files: usize,
    /// The swarm is already in the queue, so re-adding it will resume rather than restart.
    pub already_managed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentMetadataPreview {
    pub name: String,
    pub info_hash: String,
    pub total_size: u64,
    pub piece_length: u64,
    pub piece_count: usize,
    pub files: Vec<TorrentFileItem>,
    pub is_magnet: bool,
    pub magnet_uri: Option<String>,
    pub raw_bencode_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentItem {
    pub id: String,
    pub name: String,
    pub info_hash: String,
    pub magnet_uri: Option<String>,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub download_speed: u64,
    pub upload_speed: u64,
    pub progress: f32,
    pub status: String,
    pub peers_connected: u32,
    pub peers_total: u32,
    pub seeds_connected: u32,
    pub seeds_total: u32,
    pub eta_seconds: Option<i64>,
    pub download_dir: String,
    pub files: Vec<TorrentFileItem>,
    pub piece_count: usize,
    pub pieces_completed: usize,
    pub pieces_bitfield: Vec<u8>,
    /// Per-file downloaded byte counts, in `files` order (straight from librqbit).
    pub file_progress: Vec<u64>,
    /// Announce URLs declared by the torrent metadata.
    pub trackers: Vec<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub backed_up: bool,
    pub backup_path: Option<String>,
    pub priority: String,
    /// Last error reported by librqbit for this torrent, if any.
    pub error: Option<String>,
    /// True while the torrent is only queued (a magnet that has not resolved its metadata
    /// yet). Such an item has no librqbit handle behind it.
    #[serde(default)]
    pub resolving: bool,
}

/// One UI poll: the whole queue plus the global counters, in a single round trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentSnapshot {
    pub torrents: Vec<TorrentItem>,
    pub stats: SystemStats,
}

/// How much of a torrent's payload actually exists on disk.
///
/// `logical_bytes` is what the torrent declares (the sum of `File::len()`), while
/// `allocated_bytes` is what the filesystem reserved for those files. MakeMake pre-creates
/// payload files as *sparse*, so a freshly added torrent reports the full logical length and
/// almost no allocation, and the gap closes as pieces are written.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentDiskUsage {
    /// Files of this torrent that exist on disk.
    pub files: usize,
    /// Sum of the logical file lengths (i.e. downloaded bytes once complete).
    pub logical_bytes: u64,
    /// Bytes the filesystem actually reserved for those files.
    pub allocated_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSettings {
    /// Empty string means "unset" — MakeMake then asks for a location every time.
    pub default_download_dir: String,
    /// When true the native folder picker is shown for every new torrent.
    #[serde(default = "default_true")]
    pub always_ask_download_dir: bool,
    pub auto_backup_enabled: bool,
    pub backup_interval_hours: u32,
    pub backup_dir: String,
    pub move_completed_torrent_enabled: bool,
    pub completed_torrent_dir: String,
    pub max_download_speed: u64,
    pub max_upload_speed: u64,
    /// Alternate (turtle) throttle limits, applied while `turtle_mode_enabled` is true.
    #[serde(default)]
    pub turtle_mode_enabled: bool,
    #[serde(default = "default_turtle_download")]
    pub turtle_download_speed: u64,
    #[serde(default = "default_turtle_upload")]
    pub turtle_upload_speed: u64,
    /// Keep seeding once a download finishes.
    #[serde(default = "default_true")]
    pub seed_after_complete: bool,
    pub listen_port: u16,
    pub enable_sound_fx: bool,
    pub theme: String,
    /// Re-start the torrents that were active when the app was last closed.
    ///
    /// MakeMake always pauses every swarm before exiting (so no partially written
    /// piece is ever committed); this flag decides whether those swarms are
    /// re-armed on the next launch or left dormant.
    #[serde(default = "default_true")]
    pub resume_on_launch: bool,
}

fn default_true() -> bool {
    true
}

fn default_turtle_download() -> u64 {
    512 * 1024
}

fn default_turtle_upload() -> u64 {
    64 * 1024
}

impl ClientSettings {
    /// Limits that are actually applied to the live session right now.
    pub fn effective_limits(&self) -> (u64, u64) {
        if self.turtle_mode_enabled {
            (self.turtle_download_speed, self.turtle_upload_speed)
        } else {
            (self.max_download_speed, self.max_upload_speed)
        }
    }
}

/// One connected swarm peer, straight from librqbit's live peer registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerDetail {
    pub address: String,
    pub state: String,
    pub client: Option<String>,
    pub connection: Option<String>,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub success: bool,
    pub path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub global_download_speed: u64,
    pub global_upload_speed: u64,
    pub total_active_peers: u32,
    pub dht_nodes: u32,
    pub total_torrents: usize,
    pub active_torrents: usize,
    pub paused_torrents: usize,
    pub completed_torrents: usize,
    pub total_downloaded_all_time: u64,
    /// Torrents librqbit restored from its session database on this launch.
    pub restored_torrents: u32,
    /// Of those, the ones MakeMake re-armed automatically.
    pub resumed_torrents: u32,
    /// Unix ms of the last durable state checkpoint written to disk.
    pub checkpoint_at: i64,
    /// Bytes available to the user on the volume that holds the download directory.
    #[serde(default)]
    pub disk_free_bytes: u64,
    /// Total size of that volume.
    #[serde(default)]
    pub disk_total_bytes: u64,
    /// The previous run ended without sealing the session (crash, power loss, kill).
    /// The next launch re-arms the restored swarms and re-writes any missing
    /// `.torrent` archive, so the vault can never be left incomplete.
    #[serde(default)]
    pub crashed_last_run: bool,
}
