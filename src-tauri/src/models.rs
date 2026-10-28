use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFileItem {
    pub index: usize,
    pub name: String,
    pub path: String,
    pub length: u64,
    pub selected: bool,
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
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub backed_up: bool,
    pub backup_path: Option<String>,
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSettings {
    pub default_download_dir: String,
    pub auto_backup_enabled: bool,
    pub backup_interval_hours: u32,
    pub backup_dir: String,
    pub move_completed_torrent_enabled: bool,
    pub completed_torrent_dir: String,
    pub max_download_speed: u64,
    pub max_upload_speed: u64,
    pub listen_port: u16,
    pub enable_sound_fx: bool,
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub global_download_speed: u64,
    pub global_upload_speed: u64,
    pub total_active_peers: u32,
    pub dht_nodes: u32,
    pub total_torrents: usize,
    pub active_torrents: usize,
    pub total_downloaded_all_time: u64,
}
