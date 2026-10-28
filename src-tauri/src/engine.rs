use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use sha1::Digest;
use tokio::sync::RwLock;
use url::Url;

use crate::models::{ClientSettings, SystemStats, TorrentFileItem, TorrentItem, TorrentMetadataPreview};

pub struct TorrentEngine {
    torrents: Arc<RwLock<Vec<TorrentItem>>>,
    settings: Arc<RwLock<ClientSettings>>,
}

impl TorrentEngine {
    pub fn new() -> Self {
        let default_download = dirs::download_dir()
            .map(|p| p.join("MakeMake").to_string_lossy().to_string())
            .unwrap_or_else(|| "C:/MakeMake/Downloads".to_string());

        let default_backup = dirs::document_dir()
            .map(|p| p.join("MakeMake").join("TorrentBackups").to_string_lossy().to_string())
            .unwrap_or_else(|| "C:/MakeMake/TorrentBackups".to_string());

        let default_completed = dirs::document_dir()
            .map(|p| p.join("MakeMake").join("CompletedTorrents").to_string_lossy().to_string())
            .unwrap_or_else(|| "C:/MakeMake/CompletedTorrents".to_string());

        let default_settings = ClientSettings {
            default_download_dir: default_download,
            auto_backup_enabled: true,
            backup_interval_hours: 6,
            backup_dir: default_backup,
            move_completed_torrent_enabled: true,
            completed_torrent_dir: default_completed,
            max_download_speed: 0,
            max_upload_speed: 0,
            listen_port: 6881,
            enable_sound_fx: true,
            theme: "cyber-obsidian".to_string(),
        };

        let initial_torrents = Self::create_sample_torrents(&default_settings.default_download_dir);

        let engine = Self {
            torrents: Arc::new(RwLock::new(initial_torrents)),
            settings: Arc::new(RwLock::new(default_settings)),
        };

        engine.spawn_background_worker();
        engine
    }

    fn create_sample_torrents(download_dir: &str) -> Vec<TorrentItem> {
        let generate_bitfield = |completed_ratio: f32, length: usize| -> Vec<u8> {
            (0..length)
                .map(|i| if (i as f32 / length as f32) < completed_ratio { 1 } else { 0 })
                .collect()
        };

        vec![
            TorrentItem {
                id: "8f7a3bc21e98d02468abce57109284fa0c567891".to_string(),
                name: "Tangata-Manu-Rano-Kau-Photogrammetry-8K.tar".to_string(),
                info_hash: "8f7a3bc21e98d02468abce57109284fa0c567891".to_string(),
                magnet_uri: Some("magnet:?xt=urn:btih:8f7a3bc21e98d02468abce57109284fa0c567891&dn=Tangata-Manu-Rano-Kau-Photogrammetry-8K".to_string()),
                total_bytes: 18450123980,
                downloaded_bytes: 12546084306,
                uploaded_bytes: 3412095810,
                download_speed: 14205000,
                upload_speed: 2150000,
                progress: 68.0,
                status: "Downloading".to_string(),
                peers_connected: 48,
                peers_total: 124,
                seeds_connected: 34,
                seeds_total: 86,
                eta_seconds: Some(415),
                download_dir: download_dir.to_string(),
                files: vec![
                    TorrentFileItem {
                        index: 0,
                        name: "rano_kau_crater_pointcloud.ply".to_string(),
                        path: "geometry/rano_kau_crater_pointcloud.ply".to_string(),
                        length: 11200000000,
                        selected: true,
                    },
                    TorrentFileItem {
                        index: 1,
                        name: "obsidian_cliff_textures_8k.exr".to_string(),
                        path: "textures/obsidian_cliff_textures_8k.exr".to_string(),
                        length: 5400000000,
                        selected: true,
                    },
                    TorrentFileItem {
                        index: 2,
                        name: "makemake_shrine_photogrammetry.fbx".to_string(),
                        path: "models/makemake_shrine_photogrammetry.fbx".to_string(),
                        length: 1850123980,
                        selected: true,
                    },
                ],
                piece_count: 64,
                pieces_completed: 43,
                pieces_bitfield: generate_bitfield(0.68, 64),
                created_at: chrono::Utc::now().timestamp_millis() - 7200000,
                completed_at: None,
                backed_up: true,
                backup_path: Some(format!("{}/Tangata-Manu-Rano-Kau-8K.torrent", download_dir)),
                priority: "High".to_string(),
            },
            TorrentItem {
                id: "2b4c6e8013579bdfa0e2468ace13579bdf2468ac".to_string(),
                name: "Rongorongo-Decrypted-Tablets-Audiobook-FLAC".to_string(),
                info_hash: "2b4c6e8013579bdfa0e2468ace13579bdf2468ac".to_string(),
                magnet_uri: Some("magnet:?xt=urn:btih:2b4c6e8013579bdfa0e2468ace13579bdf2468ac&dn=Rongorongo-Decrypted-Tablets".to_string()),
                total_bytes: 4210543200,
                downloaded_bytes: 4210543200,
                uploaded_bytes: 9812450000,
                download_speed: 0,
                upload_speed: 4850000,
                progress: 100.0,
                status: "Seeding".to_string(),
                peers_connected: 29,
                peers_total: 58,
                seeds_connected: 14,
                seeds_total: 18,
                eta_seconds: Some(0),
                download_dir: download_dir.to_string(),
                files: vec![
                    TorrentFileItem {
                        index: 0,
                        name: "Track01_Creation_Of_Humanity.flac".to_string(),
                        path: "audio/Track01_Creation_Of_Humanity.flac".to_string(),
                        length: 820000000,
                        selected: true,
                    },
                    TorrentFileItem {
                        index: 1,
                        name: "Track02_Chant_Of_Metoro.flac".to_string(),
                        path: "audio/Track02_Chant_Of_Metoro.flac".to_string(),
                        length: 1100000000,
                        selected: true,
                    },
                    TorrentFileItem {
                        index: 2,
                        name: "Track03_Sooty_Tern_Flight.flac".to_string(),
                        path: "audio/Track03_Sooty_Tern_Flight.flac".to_string(),
                        length: 1450000000,
                        selected: true,
                    },
                    TorrentFileItem {
                        index: 3,
                        name: "LinerNotes_Boustrophedon_Guide.pdf".to_string(),
                        path: "docs/LinerNotes_Boustrophedon_Guide.pdf".to_string(),
                        length: 840543200,
                        selected: true,
                    },
                ],
                piece_count: 64,
                pieces_completed: 64,
                pieces_bitfield: generate_bitfield(1.0, 64),
                created_at: chrono::Utc::now().timestamp_millis() - 86400000,
                completed_at: Some(chrono::Utc::now().timestamp_millis() - 64800000),
                backed_up: true,
                backup_path: Some(format!("{}/Rongorongo-Decrypted-Tablets.torrent", download_dir)),
                priority: "Normal".to_string(),
            },
        ]
    }

    fn spawn_background_worker(&self) {
        let torrents_clone = self.torrents.clone();
        let settings_clone = self.settings.clone();

        std::thread::Builder::new()
            .name("makemake-engine-worker".to_string())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                    Ok(rt) => rt,
                    Err(e) => {
                        eprintln!("Failed to initialize Tokio runtime for MakeMake engine: {}", e);
                        return;
                    }
                };

                rt.block_on(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
                    loop {
                        interval.tick().await;
                        let now = chrono::Utc::now().timestamp_millis();
                        let settings = settings_clone.read().await.clone();
                        let mut torrents = torrents_clone.write().await;

                        for t in torrents.iter_mut() {
                            if t.status == "Downloading" {
                                // Fluctuate speed slightly
                                let jitter = ((now % 997) as i64 - 500) * 1200;
                                let speed = (t.download_speed as i64 + jitter).clamp(2_500_000, 25_000_000) as u64;
                                t.download_speed = speed;
                                t.upload_speed = ((speed / 6) as i64 + jitter / 4).clamp(300_000, 3_000_000) as u64;

                                t.downloaded_bytes = (t.downloaded_bytes + t.download_speed).min(t.total_bytes);
                                t.progress = ((t.downloaded_bytes as f64 / t.total_bytes as f64) * 100.0) as f32;

                                let remaining = t.total_bytes.saturating_sub(t.downloaded_bytes);
                                t.eta_seconds = if t.download_speed > 0 {
                                    Some((remaining / t.download_speed) as i64)
                                } else {
                                    None
                                };

                                let pc = t.piece_count.max(1);
                                t.pieces_completed = ((t.downloaded_bytes as f64 / t.total_bytes as f64) * pc as f64) as usize;
                                t.pieces_bitfield = (0..pc)
                                    .map(|i| if i < t.pieces_completed { 1 } else { 0 })
                                    .collect();

                                // Completion trigger
                                if t.progress >= 100.0 {
                                    t.status = "Seeding".to_string();
                                    t.progress = 100.0;
                                    t.download_speed = 0;
                                    t.eta_seconds = Some(0);
                                    t.completed_at = Some(now);

                                    // Auto-move .torrent file on completion if enabled
                                    if settings.move_completed_torrent_enabled && !settings.completed_torrent_dir.is_empty() {
                                        let _ = fs::create_dir_all(&settings.completed_torrent_dir);
                                        let dest = Path::new(&settings.completed_torrent_dir).join(format!("{}.torrent", t.name));
                                        let _ = fs::write(&dest, format!("d8:announce31:http://tracker.makemake.sw:69694:infod4:name{}:{}12:piece lengthi262144e6:pieces20:{}ee", t.name.len(), t.name, t.info_hash));
                                        t.backed_up = true;
                                        t.backup_path = Some(dest.to_string_lossy().to_string());
                                    }
                                }
                            } else if t.status == "Seeding" {
                                t.upload_speed = (1_200_000 + ((now % 500) * 1000)) as u64;
                                t.uploaded_bytes += t.upload_speed;
                            }

                            // Temporal Auto-Backup check
                            if settings.auto_backup_enabled && !t.backed_up && !settings.backup_dir.is_empty() {
                                let age_hours = (now - t.created_at) as f64 / 3_600_000.0;
                                if settings.backup_interval_hours == 0 || age_hours >= settings.backup_interval_hours as f64 {
                                    let _ = fs::create_dir_all(&settings.backup_dir);
                                    let dest = Path::new(&settings.backup_dir).join(format!("{}.torrent", t.name));
                                    let _ = fs::write(&dest, format!("d8:announce31:http://tracker.makemake.sw:69694:infod4:name{}:{}12:piece lengthi262144e6:pieces20:{}ee", t.name.len(), t.name, t.info_hash));
                                    t.backed_up = true;
                                    t.backup_path = Some(dest.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                });
            })
            .expect("Failed to spawn MakeMake engine worker thread");
    }

    pub async fn get_torrents(&self) -> Vec<TorrentItem> {
        self.torrents.read().await.clone()
    }

    pub async fn get_settings(&self) -> ClientSettings {
        self.settings.read().await.clone()
    }

    pub async fn update_settings(&self, new_settings: ClientSettings) -> ClientSettings {
        let mut settings = self.settings.write().await;
        *settings = new_settings;
        settings.clone()
    }

    pub async fn start_torrent(&self, id: &str) {
        let mut torrents = self.torrents.write().await;
        if let Some(t) = torrents.iter_mut().find(|t| t.id == id) {
            if t.status == "Paused" || t.status == "Error" {
                t.status = if t.progress >= 100.0 { "Seeding".to_string() } else { "Downloading".to_string() };
                t.download_speed = if t.status == "Downloading" { 8_500_000 } else { 0 };
                t.upload_speed = 1_200_000;
                t.peers_connected = 24;
            }
        }
    }

    pub async fn pause_torrent(&self, id: &str) {
        let mut torrents = self.torrents.write().await;
        if let Some(t) = torrents.iter_mut().find(|t| t.id == id) {
            t.status = "Paused".to_string();
            t.download_speed = 0;
            t.upload_speed = 0;
            t.peers_connected = 0;
        }
    }

    pub async fn force_recheck(&self, id: &str) {
        let mut torrents = self.torrents.write().await;
        if let Some(t) = torrents.iter_mut().find(|t| t.id == id) {
            t.status = "Checking".to_string();
            t.download_speed = 0;
            t.upload_speed = 0;
        }
    }

    pub async fn backup_torrent_now(&self, id: &str) -> Result<String, String> {
        let settings = self.settings.read().await.clone();
        let mut torrents = self.torrents.write().await;
        if let Some(t) = torrents.iter_mut().find(|t| t.id == id) {
            fs::create_dir_all(&settings.backup_dir).map_err(|e| e.to_string())?;
            let dest = Path::new(&settings.backup_dir).join(format!("{}.torrent", t.name));
            let content = format!("d8:announce31:http://tracker.makemake.sw:69694:infod4:name{}:{}12:piece lengthi262144e6:pieces20:{}ee", t.name.len(), t.name, t.info_hash);
            fs::write(&dest, content).map_err(|e| e.to_string())?;
            let path_str = dest.to_string_lossy().to_string();
            t.backed_up = true;
            t.backup_path = Some(path_str.clone());
            Ok(path_str)
        } else {
            Err("Torrent not found".to_string())
        }
    }

    pub async fn delete_torrent(&self, id: &str, delete_files: bool) -> Result<(), String> {
        let mut torrents = self.torrents.write().await;
        if let Some(pos) = torrents.iter().position(|t| t.id == id) {
            let item = torrents.remove(pos);
            if delete_files {
                let target_path = PathBuf::from(&item.download_dir).join(&item.name);
                if target_path.exists() {
                    if target_path.is_dir() {
                        let _ = fs::remove_dir_all(target_path);
                    } else {
                        let _ = fs::remove_file(target_path);
                    }
                }
            }
            Ok(())
        } else {
            Err("Torrent not found".to_string())
        }
    }

    pub async fn add_torrent(&self, preview: TorrentMetadataPreview, target_dir: String) -> TorrentItem {
        let settings = self.settings.read().await.clone();
        let selected_files: Vec<TorrentFileItem> = preview.files.into_iter().filter(|f| f.selected).collect();
        let total_bytes: u64 = selected_files.iter().map(|f| f.length).sum();
        let piece_count = preview.piece_count.max(1);

        let dl_dir = if target_dir.trim().is_empty() {
            settings.default_download_dir.clone()
        } else {
            target_dir
        };

        let new_torrent = TorrentItem {
            id: preview.info_hash.clone(),
            name: preview.name.clone(),
            info_hash: preview.info_hash.clone(),
            magnet_uri: preview.magnet_uri,
            total_bytes,
            downloaded_bytes: 0,
            uploaded_bytes: 0,
            download_speed: 6_200_000,
            upload_speed: 480_000,
            progress: 0.0,
            status: "Downloading".to_string(),
            peers_connected: 18,
            peers_total: 72,
            seeds_connected: 10,
            seeds_total: 45,
            eta_seconds: if total_bytes > 0 { Some((total_bytes / 6_200_000) as i64) } else { None },
            download_dir: dl_dir,
            files: selected_files,
            piece_count,
            pieces_completed: 0,
            pieces_bitfield: vec![0; piece_count],
            created_at: chrono::Utc::now().timestamp_millis(),
            completed_at: None,
            backed_up: settings.auto_backup_enabled && settings.backup_interval_hours == 0,
            backup_path: if settings.auto_backup_enabled && settings.backup_interval_hours == 0 {
                Some(format!("{}/{}.torrent", settings.backup_dir, preview.name))
            } else {
                None
            },
            priority: "Normal".to_string(),
        };

        let mut torrents = self.torrents.write().await;
        torrents.insert(0, new_torrent.clone());
        new_torrent
    }

    pub fn parse_magnet_link(magnet_uri: &str) -> Result<TorrentMetadataPreview, String> {
        let dummy_url = magnet_uri.replace("magnet:?", "http://makemake.local/?");
        let parsed = Url::parse(&dummy_url).map_err(|e| format!("Invalid magnet URL: {}", e))?;

        let mut info_hash = String::new();
        let mut name = String::new();

        for (k, v) in parsed.query_pairs() {
            if k == "xt" && v.starts_with("urn:btih:") {
                info_hash = v.replace("urn:btih:", "").to_lowercase();
            } else if k == "dn" {
                name = v.to_string();
            }
        }

        if info_hash.is_empty() {
            info_hash = "9f8e7d6c5b4a392817263544abcdef0123456789".to_string();
        }
        if name.is_empty() {
            name = format!("Swarm_Payload_{}", &info_hash[0..8.min(info_hash.len())]);
        }

        let total_size = 5_800_000_000u64;
        let files = vec![
            TorrentFileItem {
                index: 0,
                name: format!("{}.mkv", name),
                path: format!("{}/{}.mkv", name, name),
                length: 5_650_000_000,
                selected: true,
            },
            TorrentFileItem {
                index: 1,
                name: "subtitles_en.srt".to_string(),
                path: format!("{}/subs/subtitles_en.srt", name),
                length: 125_000,
                selected: true,
            },
            TorrentFileItem {
                index: 2,
                name: "tangata_manu_provenance.nfo".to_string(),
                path: format!("{}/tangata_manu_provenance.nfo", name),
                length: 85_000,
                selected: true,
            },
        ];

        Ok(TorrentMetadataPreview {
            name,
            info_hash,
            total_size,
            piece_length: 2_097_152,
            piece_count: 64,
            files,
            is_magnet: true,
            magnet_uri: Some(magnet_uri.to_string()),
            raw_bencode_base64: None,
        })
    }

    pub fn parse_torrent_file(file_name: &str, _content_base64: &str) -> Result<TorrentMetadataPreview, String> {
        let clean_name = file_name.replace(".torrent", "");
        let info_hash = format!("{:x}", sha1::Sha1::digest(clean_name.as_bytes()));

        let files = vec![
            TorrentFileItem {
                index: 0,
                name: format!("{}_Master.iso", clean_name),
                path: format!("{}_Master.iso", clean_name),
                length: 14_200_000_000,
                selected: true,
            },
            TorrentFileItem {
                index: 1,
                name: "Verification_Signatures.sig".to_string(),
                path: "Verification_Signatures.sig".to_string(),
                length: 450_000,
                selected: true,
            },
        ];

        Ok(TorrentMetadataPreview {
            name: clean_name,
            info_hash,
            total_size: 14_200_450_000,
            piece_length: 4_194_304,
            piece_count: 64,
            files,
            is_magnet: false,
            magnet_uri: None,
            raw_bencode_base64: None,
        })
    }

    pub async fn get_system_stats(&self) -> SystemStats {
        let torrents = self.torrents.read().await;
        let mut global_dl = 0;
        let mut global_ul = 0;
        let mut active_peers = 0;
        let mut active_torrents = 0;
        let mut total_downloaded = 0;

        for t in torrents.iter() {
            global_dl += t.download_speed;
            global_ul += t.upload_speed;
            active_peers += t.peers_connected;
            total_downloaded += t.downloaded_bytes;
            if t.status == "Downloading" || t.status == "Seeding" {
                active_torrents += 1;
            }
        }

        SystemStats {
            global_download_speed: global_dl,
            global_upload_speed: global_ul,
            total_active_peers: active_peers,
            dht_nodes: 9142,
            total_torrents: torrents.len(),
            active_torrents,
            total_downloaded_all_time: total_downloaded,
        }
    }
}
