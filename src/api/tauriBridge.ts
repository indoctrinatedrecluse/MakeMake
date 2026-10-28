import { TorrentItem, TorrentMetadataPreview, ClientSettings, SystemStats } from '../types/torrent';

// Detect whether we are running within the Tauri desktop container
const isTauriEnv = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

// Safe invoke wrapper
async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriEnv()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<T>(cmd, args);
    } catch (err) {
      console.warn(`[Tauri invoke error for ${cmd}]:`, err);
      throw err;
    }
  }
  throw new Error('Not in Tauri environment');
}

// -------------------------------------------------------------
// IN-MEMORY DEV / MOCK ENGINE FOR BROWSER RUNTIME
// -------------------------------------------------------------
const STORAGE_TORRENTS_KEY = 'makemake_torrents_dev';
const STORAGE_SETTINGS_KEY = 'makemake_settings_dev';

const DEFAULT_SETTINGS: ClientSettings = {
  defaultDownloadDir: 'C:/MakeMake/Downloads',
  autoBackupEnabled: true,
  backupIntervalHours: 6, // 6 hours
  backupDir: 'C:/MakeMake/TorrentBackups',
  moveCompletedTorrentEnabled: true,
  completedTorrentDir: 'C:/MakeMake/CompletedTorrents',
  maxDownloadSpeed: 0,
  maxUploadSpeed: 0,
  listenPort: 6881,
  enableSoundFx: true,
  theme: 'cyber-obsidian',
};

// Generate initial mock torrents
function createInitialMockTorrents(): TorrentItem[] {
  const generateBitfield = (completedRatio: number, length = 64): number[] => {
    return Array.from({ length }, (_, i) => (i / length < completedRatio ? 1 : 0));
  };

  return [
    {
      id: '8f7a3bc21e98d02468abce57109284fa0c567891',
      name: 'Tangata-Manu-Rano-Kau-Photogrammetry-8K.tar',
      infoHash: '8f7a3bc21e98d02468abce57109284fa0c567891',
      magnetUri: 'magnet:?xt=urn:btih:8f7a3bc21e98d02468abce57109284fa0c567891&dn=Tangata-Manu-Rano-Kau-Photogrammetry-8K',
      totalBytes: 18450123980,
      downloadedBytes: 12546084306,
      uploadedBytes: 3412095810,
      downloadSpeed: 14205000, // 14.2 MB/s
      uploadSpeed: 2150000,   // 2.15 MB/s
      progress: 68.0,
      status: 'Downloading',
      peersConnected: 48,
      peersTotal: 124,
      seedsConnected: 34,
      seedsTotal: 86,
      etaSeconds: 415,
      downloadDir: 'C:/MakeMake/Downloads',
      pieceCount: 64,
      piecesCompleted: 43,
      piecesBitfield: generateBitfield(0.68, 64),
      createdAt: Date.now() - 3600000 * 2,
      completedAt: null,
      backedUp: true,
      backupPath: 'C:/MakeMake/TorrentBackups/Tangata-Manu-Rano-Kau-8K.torrent',
      priority: 'High',
      files: [
        { index: 0, name: 'rano_kau_crater_pointcloud.ply', path: 'geometry/rano_kau_crater_pointcloud.ply', length: 11200000000, selected: true },
        { index: 1, name: 'obsidian_cliff_textures_8k.exr', path: 'textures/obsidian_cliff_textures_8k.exr', length: 5400000000, selected: true },
        { index: 2, name: 'makemake_shrine_photogrammetry.fbx', path: 'models/makemake_shrine_photogrammetry.fbx', length: 1850123980, selected: true },
      ],
    },
    {
      id: '2b4c6e8013579bdfa0e2468ace13579bdf2468ac',
      name: 'Rongorongo-Decrypted-Tablets-Audiobook-FLAC',
      infoHash: '2b4c6e8013579bdfa0e2468ace13579bdf2468ac',
      magnetUri: 'magnet:?xt=urn:btih:2b4c6e8013579bdfa0e2468ace13579bdf2468ac&dn=Rongorongo-Decrypted-Tablets',
      totalBytes: 4210543200,
      downloadedBytes: 4210543200,
      uploadedBytes: 9812450000,
      downloadSpeed: 0,
      uploadSpeed: 4850000, // 4.85 MB/s
      progress: 100.0,
      status: 'Seeding',
      peersConnected: 29,
      peersTotal: 58,
      seedsConnected: 14,
      seedsTotal: 18,
      etaSeconds: 0,
      downloadDir: 'C:/MakeMake/Downloads',
      pieceCount: 64,
      piecesCompleted: 64,
      piecesBitfield: generateBitfield(1.0, 64),
      createdAt: Date.now() - 3600000 * 24,
      completedAt: Date.now() - 3600000 * 18,
      backedUp: true,
      backupPath: 'C:/MakeMake/CompletedTorrents/Rongorongo-Decrypted-Tablets.torrent',
      priority: 'Normal',
      files: [
        { index: 0, name: 'Track01_Creation_Of_Humanity.flac', path: 'audio/Track01_Creation_Of_Humanity.flac', length: 820000000, selected: true },
        { index: 1, name: 'Track02_Chant_Of_Metoro.flac', path: 'audio/Track02_Chant_Of_Metoro.flac', length: 1100000000, selected: true },
        { index: 2, name: 'Track03_Sooty_Tern_Flight.flac', path: 'audio/Track03_Sooty_Tern_Flight.flac', length: 1450000000, selected: true },
        { index: 3, name: 'LinerNotes_Boustrophedon_Guide.pdf', path: 'docs/LinerNotes_Boustrophedon_Guide.pdf', length: 840543200, selected: true },
      ],
    },
    {
      id: '9901ef23456789abcd0123456789abcdef012345',
      name: 'Polynesian-Wayfinding-Cyber-Astrolabe-Engine-v2.iso',
      infoHash: '9901ef23456789abcd0123456789abcdef012345',
      magnetUri: 'magnet:?xt=urn:btih:9901ef23456789abcd0123456789abcdef012345&dn=Polynesian-Wayfinding-Cyber-Astrolabe',
      totalBytes: 7890000000,
      downloadedBytes: 1578000000,
      uploadedBytes: 250000000,
      downloadSpeed: 8750000, // 8.75 MB/s
      uploadSpeed: 850000,   // 850 KB/s
      progress: 20.0,
      status: 'Downloading',
      peersConnected: 33,
      peersTotal: 92,
      seedsConnected: 21,
      seedsTotal: 55,
      etaSeconds: 721,
      downloadDir: 'C:/MakeMake/Downloads',
      pieceCount: 64,
      piecesCompleted: 13,
      piecesBitfield: generateBitfield(0.2, 64),
      createdAt: Date.now() - 3600000 * 1,
      completedAt: null,
      backedUp: false,
      priority: 'Normal',
      files: [
        { index: 0, name: 'wayfinding_firmware.bin', path: 'firmware/wayfinding_firmware.bin', length: 4890000000, selected: true },
        { index: 1, name: 'star_compass_ephemeris.db', path: 'data/star_compass_ephemeris.db', length: 3000000000, selected: true },
      ],
    },
    {
      id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e',
      name: 'Ahu-Tongariki-15-Moai-Photogrammetric-LiDAR.zip',
      infoHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e',
      magnetUri: 'magnet:?xt=urn:btih:a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e&dn=Ahu-Tongariki-15-Moai',
      totalBytes: 26400000000,
      downloadedBytes: 9240000000,
      uploadedBytes: 1840000000,
      downloadSpeed: 0,
      uploadSpeed: 0,
      progress: 35.0,
      status: 'Paused',
      peersConnected: 0,
      peersTotal: 84,
      seedsConnected: 0,
      seedsTotal: 62,
      etaSeconds: null,
      downloadDir: 'C:/MakeMake/Downloads',
      pieceCount: 64,
      piecesCompleted: 22,
      piecesBitfield: generateBitfield(0.35, 64),
      createdAt: Date.now() - 3600000 * 5,
      completedAt: null,
      backedUp: true,
      backupPath: 'C:/MakeMake/TorrentBackups/Ahu-Tongariki-15-Moai.torrent',
      priority: 'Low',
      files: [
        { index: 0, name: 'ahu_tongariki_lidar_cloud.laz', path: 'lidar/ahu_tongariki_lidar_cloud.laz', length: 19400000000, selected: true },
        { index: 1, name: '15_moai_pukao_mesh_alignment.gltf', path: 'meshes/15_moai_pukao_mesh_alignment.gltf', length: 7000000000, selected: true },
      ],
    },
  ];
}

class DevMockEngine {
  private torrents: TorrentItem[];
  private settings: ClientSettings;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const savedTorrents = localStorage.getItem(STORAGE_TORRENTS_KEY);
    if (savedTorrents) {
      try {
        this.torrents = JSON.parse(savedTorrents);
      } catch {
        this.torrents = createInitialMockTorrents();
      }
    } else {
      this.torrents = createInitialMockTorrents();
      this.persistTorrents();
    }

    const savedSettings = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (savedSettings) {
      try {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
      } catch {
        this.settings = DEFAULT_SETTINGS;
      }
    } else {
      this.settings = DEFAULT_SETTINGS;
      this.persistSettings();
    }

    this.startSimulationLoop();
  }

  private persistTorrents() {
    try {
      localStorage.setItem(STORAGE_TORRENTS_KEY, JSON.stringify(this.torrents));
    } catch (e) {
      console.warn('Failed to persist torrents to localStorage', e);
    }
  }

  private persistSettings() {
    try {
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Failed to persist settings to localStorage', e);
    }
  }

  private startSimulationLoop() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = setInterval(() => {
      let changed = false;
      const now = Date.now();

      this.torrents = this.torrents.map((t) => {
        if (t.status === 'Downloading') {
          changed = true;
          // Random slight speed fluctuations for alive cyberpunk feel
          const jitter = (Math.random() - 0.48) * 800000;
          const currentSpeed = Math.max(1200000, Math.min(28000000, t.downloadSpeed + jitter));
          const upJitter = (Math.random() - 0.5) * 200000;
          const uploadSpeed = Math.max(400000, t.uploadSpeed + upJitter);

          const newDownloaded = Math.min(t.totalBytes, t.downloadedBytes + currentSpeed);
          const progress = (newDownloaded / t.totalBytes) * 100;
          const remainingBytes = t.totalBytes - newDownloaded;
          const eta = currentSpeed > 0 ? Math.ceil(remainingBytes / currentSpeed) : null;

          // Update bitfield blocks
          const pieceCount = t.pieceCount || 64;
          const piecesCompleted = Math.floor((newDownloaded / t.totalBytes) * pieceCount);
          const bitfield = Array.from({ length: pieceCount }, (_, i) => (i < piecesCompleted ? 1 : 0));

          if (progress >= 100) {
            // Completed! Transition to Seeding
            const completedTorrent: TorrentItem = {
              ...t,
              status: 'Seeding',
              downloadedBytes: t.totalBytes,
              progress: 100.0,
              downloadSpeed: 0,
              uploadSpeed: uploadSpeed * 1.5,
              etaSeconds: 0,
              piecesCompleted: pieceCount,
              piecesBitfield: Array(pieceCount).fill(1),
              completedAt: now,
            };

            // Post-completion auto-relocation check
            if (this.settings.moveCompletedTorrentEnabled && this.settings.completedTorrentDir) {
              completedTorrent.backedUp = true;
              completedTorrent.backupPath = `${this.settings.completedTorrentDir}/${t.name}.torrent`;
            }

            return completedTorrent;
          }

          return {
            ...t,
            downloadedBytes: newDownloaded,
            progress: Number(progress.toFixed(1)),
            downloadSpeed: Math.round(currentSpeed),
            uploadSpeed: Math.round(uploadSpeed),
            etaSeconds: eta,
            piecesCompleted,
            piecesBitfield: bitfield,
          };
        } else if (t.status === 'Seeding') {
          // Uploading
          const upJitter = (Math.random() - 0.5) * 300000;
          const uploadSpeed = Math.max(800000, t.uploadSpeed + upJitter);
          return {
            ...t,
            uploadSpeed: Math.round(uploadSpeed),
            uploadedBytes: t.uploadedBytes + uploadSpeed,
          };
        }
        return t;
      });

      // Temporal auto-backup check
      if (this.settings.autoBackupEnabled) {
        this.torrents.forEach((t) => {
          if (!t.backedUp) {
            const ageHours = (now - t.createdAt) / 3600000;
            if (this.settings.backupIntervalHours === 0 || ageHours >= this.settings.backupIntervalHours) {
              t.backedUp = true;
              t.backupPath = `${this.settings.backupDir}/${t.name}.torrent`;
              changed = true;
            }
          }
        });
      }

      if (changed) {
        this.persistTorrents();
      }
    }, 1000);
  }

  public getTorrents(): TorrentItem[] {
    return this.torrents;
  }

  public getSettings(): ClientSettings {
    return this.settings;
  }

  public updateSettings(newSettings: ClientSettings): ClientSettings {
    this.settings = { ...this.settings, ...newSettings };
    this.persistSettings();
    return this.settings;
  }

  public startTorrent(id: string): void {
    this.torrents = this.torrents.map((t) => {
      if (t.id === id && (t.status === 'Paused' || t.status === 'Error')) {
        const nextStatus = t.progress >= 100 ? 'Seeding' : 'Downloading';
        return {
          ...t,
          status: nextStatus,
          downloadSpeed: nextStatus === 'Downloading' ? 8500000 : 0,
          uploadSpeed: 1200000,
          peersConnected: Math.floor(Math.random() * 25) + 10,
        };
      }
      return t;
    });
    this.persistTorrents();
  }

  public pauseTorrent(id: string): void {
    this.torrents = this.torrents.map((t) => {
      if (t.id === id) {
        return {
          ...t,
          status: 'Paused',
          downloadSpeed: 0,
          uploadSpeed: 0,
          peersConnected: 0,
        };
      }
      return t;
    });
    this.persistTorrents();
  }

  public forceRecheck(id: string): void {
    this.torrents = this.torrents.map((t) => {
      if (t.id === id) {
        return {
          ...t,
          status: 'Checking',
          downloadSpeed: 0,
          uploadSpeed: 0,
        };
      }
      return t;
    });
    this.persistTorrents();

    // After 2 seconds recheck completes
    setTimeout(() => {
      this.torrents = this.torrents.map((t) => {
        if (t.id === id && t.status === 'Checking') {
          return {
            ...t,
            status: t.progress >= 100 ? 'Seeding' : 'Downloading',
            downloadSpeed: t.progress >= 100 ? 0 : 7800000,
          };
        }
        return t;
      });
      this.persistTorrents();
    }, 2000);
  }

  public backupTorrentNow(id: string): { success: boolean; path: string } {
    let backupPath = '';
    this.torrents = this.torrents.map((t) => {
      if (t.id === id) {
        backupPath = `${this.settings.backupDir}/${t.name}.torrent`;
        return {
          ...t,
          backedUp: true,
          backupPath,
        };
      }
      return t;
    });
    this.persistTorrents();
    return { success: true, path: backupPath };
  }

  public deleteTorrent(id: string, deleteFiles: boolean): void {
    this.torrents = this.torrents.filter((t) => t.id !== id);
    this.persistTorrents();
    console.log(`[Torrent Deleted] ID: ${id}, Deleted Disk Files: ${deleteFiles}`);
  }

  public addTorrent(preview: TorrentMetadataPreview, targetDir: string): TorrentItem {
    const selectedFiles = preview.files.filter((f) => f.selected);
    const totalBytes = selectedFiles.reduce((acc, f) => acc + f.length, 0);
    const pieceCount = preview.pieceCount || 64;

    const newTorrent: TorrentItem = {
      id: preview.infoHash,
      name: preview.name,
      infoHash: preview.infoHash,
      magnetUri: preview.magnetUri,
      totalBytes,
      downloadedBytes: 0,
      uploadedBytes: 0,
      downloadSpeed: 5200000,
      uploadSpeed: 450000,
      progress: 0.0,
      status: 'Downloading',
      peersConnected: 12,
      peersTotal: 65,
      seedsConnected: 8,
      seedsTotal: 40,
      etaSeconds: Math.ceil(totalBytes / 5200000),
      downloadDir: targetDir || this.settings.defaultDownloadDir,
      files: preview.files,
      pieceCount,
      piecesCompleted: 0,
      piecesBitfield: Array(pieceCount).fill(0),
      createdAt: Date.now(),
      completedAt: null,
      backedUp: this.settings.autoBackupEnabled && this.settings.backupIntervalHours === 0,
      backupPath:
        this.settings.autoBackupEnabled && this.settings.backupIntervalHours === 0
          ? `${this.settings.backupDir}/${preview.name}.torrent`
          : undefined,
      priority: 'Normal',
    };

    this.torrents = [newTorrent, ...this.torrents];
    this.persistTorrents();
    return newTorrent;
  }

  public parseMagnet(magnetUri: string): TorrentMetadataPreview {
    // Parse magnet params
    const url = new URL(magnetUri.replace('magnet:?', 'http://dummy.com/?'));
    const xt = url.searchParams.get('xt') || '';
    const infoHash = xt.replace('urn:btih:', '').toLowerCase() || Math.random().toString(16).slice(2, 42);
    const dn = url.searchParams.get('dn') || `Swarm_Payload_${infoHash.slice(0, 8)}`;

    return {
      name: decodeURIComponent(dn).replace(/\+/g, ' '),
      infoHash,
      totalSize: 4890000000,
      pieceLength: 2097152, // 2MB
      pieceCount: 64,
      isMagnet: true,
      magnetUri,
      files: [
        { index: 0, name: `${dn}.mkv`, path: `${dn}/${dn}.mkv`, length: 4720000000, selected: true },
        { index: 1, name: 'subtitles_en.srt', path: `${dn}/subs/subtitles_en.srt`, length: 120000, selected: true },
        { index: 2, name: 'swarm_provenance.nfo', path: `${dn}/swarm_provenance.nfo`, length: 80000, selected: true },
        { index: 3, name: 'tangata_manu_checksums.sfv', path: `${dn}/tangata_manu_checksums.sfv`, length: 25000, selected: true },
      ],
    };
  }

  public parseTorrentFile(fileName: string, _contentBase64: string): TorrentMetadataPreview {
    const cleanName = fileName.replace(/\.torrent$/i, '');
    const infoHash = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    return {
      name: cleanName,
      infoHash,
      totalSize: 12450000000,
      pieceLength: 4194304, // 4MB
      pieceCount: 64,
      isMagnet: false,
      files: [
        { index: 0, name: `${cleanName}_Master.iso`, path: `${cleanName}_Master.iso`, length: 11950000000, selected: true },
        { index: 1, name: 'Verification_Signatures.sig', path: 'Verification_Signatures.sig', length: 500000, selected: true },
      ],
    };
  }

  public getSystemStats(): SystemStats {
    let globalDl = 0;
    let globalUl = 0;
    let activePeers = 0;
    let activeTorrents = 0;
    let totalDownloaded = 0;

    this.torrents.forEach((t) => {
      globalDl += t.downloadSpeed;
      globalUl += t.uploadSpeed;
      activePeers += t.peersConnected;
      totalDownloaded += t.downloadedBytes;
      if (t.status === 'Downloading' || t.status === 'Seeding') {
        activeTorrents++;
      }
    });

    return {
      globalDownloadSpeed: globalDl,
      globalUploadSpeed: globalUl,
      totalActivePeers: activePeers,
      dhtNodes: 8492,
      totalTorrents: this.torrents.length,
      activeTorrents,
      totalDownloadedAllTime: totalDownloaded,
    };
  }
}

// Global dev mock singleton
const devEngine = new DevMockEngine();

// -------------------------------------------------------------
// UNIFIED TAURI BRIDGE EXPORTED METHODS
// -------------------------------------------------------------

export const TauriBridge = {
  isDesktop: isTauriEnv,

  async getTorrents(): Promise<TorrentItem[]> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri<TorrentItem[]>('get_torrents');
      } catch {
        return devEngine.getTorrents();
      }
    }
    return devEngine.getTorrents();
  },

  async getSettings(): Promise<ClientSettings> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri<ClientSettings>('get_settings');
      } catch {
        return devEngine.getSettings();
      }
    }
    return devEngine.getSettings();
  },

  async updateSettings(settings: ClientSettings): Promise<ClientSettings> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri<ClientSettings>('update_settings', { settings });
      } catch {
        return devEngine.updateSettings(settings);
      }
    }
    return devEngine.updateSettings(settings);
  },

  async startTorrent(id: string): Promise<void> {
    if (isTauriEnv()) {
      try {
        await invokeTauri('start_torrent', { id });
        return;
      } catch {
        devEngine.startTorrent(id);
        return;
      }
    }
    devEngine.startTorrent(id);
  },

  async pauseTorrent(id: string): Promise<void> {
    if (isTauriEnv()) {
      try {
        await invokeTauri('pause_torrent', { id });
        return;
      } catch {
        devEngine.pauseTorrent(id);
        return;
      }
    }
    devEngine.pauseTorrent(id);
  },

  async forceRecheck(id: string): Promise<void> {
    if (isTauriEnv()) {
      try {
        await invokeTauri('force_recheck', { id });
        return;
      } catch {
        devEngine.forceRecheck(id);
        return;
      }
    }
    devEngine.forceRecheck(id);
  },

  async backupTorrentNow(id: string): Promise<{ success: boolean; path: string }> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri('backup_torrent_now', { id });
      } catch {
        return devEngine.backupTorrentNow(id);
      }
    }
    return devEngine.backupTorrentNow(id);
  },

  async deleteTorrent(id: string, deleteFiles: boolean): Promise<void> {
    if (isTauriEnv()) {
      try {
        await invokeTauri('delete_torrent', { id, deleteFiles });
        return;
      } catch {
        devEngine.deleteTorrent(id, deleteFiles);
        return;
      }
    }
    devEngine.deleteTorrent(id, deleteFiles);
  },

  async addTorrent(preview: TorrentMetadataPreview, targetDir: string): Promise<TorrentItem> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri<TorrentItem>('add_torrent', { preview, targetDir });
      } catch {
        return devEngine.addTorrent(preview, targetDir);
      }
    }
    return devEngine.addTorrent(preview, targetDir);
  },

  async parseMagnetLink(magnetUri: string): Promise<TorrentMetadataPreview> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri<TorrentMetadataPreview>('parse_magnet_link', { magnetUri });
      } catch {
        return devEngine.parseMagnet(magnetUri);
      }
    }
    return devEngine.parseMagnet(magnetUri);
  },

  async parseTorrentFile(fileName: string, contentBase64: string): Promise<TorrentMetadataPreview> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri<TorrentMetadataPreview>('parse_torrent_file', { fileName, contentBase64 });
      } catch {
        return devEngine.parseTorrentFile(fileName, contentBase64);
      }
    }
    return devEngine.parseTorrentFile(fileName, contentBase64);
  },

  async openFolder(path: string): Promise<void> {
    if (isTauriEnv()) {
      try {
        await invokeTauri('open_folder', { path });
        return;
      } catch (e) {
        console.warn('Failed to open folder via Tauri', e);
      }
    }
    console.log(`[Open Folder]: ${path}`);
  },

  async getSystemStats(): Promise<SystemStats> {
    if (isTauriEnv()) {
      try {
        return await invokeTauri<SystemStats>('get_system_stats');
      } catch {
        return devEngine.getSystemStats();
      }
    }
    return devEngine.getSystemStats();
  },

  async selectDirectory(title = 'Select Sacred Destination Folder'): Promise<string | null> {
    if (isTauriEnv()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          directory: true,
          multiple: false,
          title,
        });
        if (typeof selected === 'string') return selected;
      } catch (e) {
        console.warn('Dialog plugin open failed', e);
      }
    }
    // Browser prompt fallback
    return prompt('Enter Directory Path:', 'C:/MakeMake/Downloads') || null;
  },
};
