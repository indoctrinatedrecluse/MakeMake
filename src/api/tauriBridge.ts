import { TorrentItem, TorrentMetadataPreview, ClientSettings, SystemStats, PeerDetail } from '../types/torrent';

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
// BROWSER DEV STORE
// -------------------------------------------------------------
// The desktop app always talks to the real librqbit engine through Tauri.
// When the UI runs in a plain browser tab (vite dev/preview) there is no
// backend at all, so we keep a small in-memory store that starts EMPTY and
// only reflects torrents the developer adds during that session. Nothing is
// fabricated: no seed torrents, no fake progress.

const DEFAULT_SETTINGS: ClientSettings = {
  defaultDownloadDir: 'C:/MakeMake/Downloads',
  alwaysAskDownloadDir: true,
  autoBackupEnabled: true,
  backupIntervalHours: 6,
  backupDir: 'C:/MakeMake/TorrentBackups',
  moveCompletedTorrentEnabled: true,
  completedTorrentDir: 'C:/MakeMake/CompletedTorrents',
  maxDownloadSpeed: 0,
  maxUploadSpeed: 0,
  turtleModeEnabled: false,
  turtleDownloadSpeed: 512 * 1024,
  turtleUploadSpeed: 64 * 1024,
  seedAfterComplete: true,
  listenPort: 6881,
  enableSoundFx: true,
  theme: 'cyber-obsidian',
  resumeOnLaunch: true,
};

class DevStore {
  private torrents: TorrentItem[] = [];
  private settings: ClientSettings = { ...DEFAULT_SETTINGS };

  public getTorrents(): TorrentItem[] {
    return this.torrents;
  }

  public getSettings(): ClientSettings {
    return this.settings;
  }

  public updateSettings(next: ClientSettings): ClientSettings {
    this.settings = { ...this.settings, ...next };
    return this.settings;
  }

  public startTorrent(id: string): void {
    this.torrents = this.torrents.map((t) =>
      t.id === id ? { ...t, status: t.progress >= 100 ? 'Seeding' : 'Downloading' } : t,
    );
  }

  public pauseTorrent(id: string): void {
    this.torrents = this.torrents.map((t) =>
      t.id === id ? { ...t, status: 'Paused', downloadSpeed: 0, uploadSpeed: 0 } : t,
    );
  }

  public forceRecheck(id: string): void {
    this.torrents = this.torrents.map((t) =>
      t.id === id ? { ...t, status: 'Checking', downloadSpeed: 0, uploadSpeed: 0 } : t,
    );
  }

  public backupTorrentNow(id: string): { success: boolean; path: string } {
    const target = this.torrents.find((t) => t.id === id);
    if (!target) {
      throw new Error(`Torrent ${id} not found`);
    }
    const path = `${this.settings.backupDir}/${target.name}.torrent`;
    this.torrents = this.torrents.map((t) =>
      t.id === id ? { ...t, backedUp: true, backupPath: path } : t,
    );
    return { success: true, path };
  }

  public deleteTorrent(id: string, _deleteFiles: boolean): void {
    this.torrents = this.torrents.filter((t) => t.id !== id);
  }

  public pauseAll(): void {
    this.torrents = this.torrents.map((t) => ({
      ...t,
      status: 'Paused',
      downloadSpeed: 0,
      uploadSpeed: 0,
    }));
  }

  public resumeAll(): void {
    this.torrents = this.torrents.map((t) => ({
      ...t,
      status: t.progress >= 100 ? 'Seeding' : 'Downloading',
    }));
  }

  public setPriority(id: string, priority: TorrentItem['priority']): void {
    this.torrents = this.torrents.map((t) => (t.id === id ? { ...t, priority } : t));
  }

  public setFileSelection(id: string, files: number[]): void {
    const selected = new Set(files);
    this.torrents = this.torrents.map((t) =>
      t.id === id
        ? { ...t, files: t.files.map((f) => ({ ...f, selected: selected.has(f.index) })) }
        : t,
    );
  }

  public getPeers(_id: string): PeerDetail[] {
    // The browser preview has no BitTorrent engine, so it honestly reports none.
    return [];
  }

  public exportTorrent(id: string, path: string): { success: boolean; path: string } {
    const target = this.torrents.find((t) => t.id === id);
    if (!target) {
      throw new Error(`Torrent ${id} not found`);
    }
    this.torrents = this.torrents.map((t) =>
      t.id === id ? { ...t, backedUp: true, backupPath: path } : t,
    );
    return { success: true, path };
  }

  public setTurtleMode(enabled: boolean): ClientSettings {
    this.settings = { ...this.settings, turtleModeEnabled: enabled };
    return this.settings;
  }

  public addTorrent(preview: TorrentMetadataPreview, targetDir: string): TorrentItem {
    const item: TorrentItem = {
      id: preview.infoHash,
      name: preview.name,
      infoHash: preview.infoHash,
      magnetUri: preview.magnetUri,
      totalBytes: preview.totalSize,
      downloadedBytes: 0,
      uploadedBytes: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      progress: 0,
      status: 'Queued',
      peersConnected: 0,
      peersTotal: 0,
      seedsConnected: 0,
      seedsTotal: 0,
      etaSeconds: null,
      downloadDir: targetDir,
      files: preview.files,
      pieceCount: preview.pieceCount,
      piecesCompleted: 0,
      piecesBitfield: Array.from({ length: 64 }, () => 0),
      fileProgress: preview.files.map(() => 0),
      trackers: [],
      createdAt: Date.now(),
      completedAt: null,
      backedUp: false,
      backupPath: undefined,
      priority: 'Normal',
    };
    this.torrents = [item, ...this.torrents.filter((t) => t.id !== item.id)];
    return item;
  }

  public parseMagnet(magnetUri: string): TorrentMetadataPreview {
    const hashMatch = /xt=urn:btih:([a-zA-Z0-9]+)/i.exec(magnetUri);
    const infoHash = (hashMatch?.[1] ?? '').toLowerCase();
    if (!infoHash) {
      throw new Error('Invalid magnet link: missing btih info hash');
    }
    const nameMatch = /[?&]dn=([^&]+)/.exec(magnetUri);
    const name = nameMatch
      ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' '))
      : `Magnet ${infoHash.slice(0, 8)}`;
    return {
      name,
      infoHash,
      totalSize: 0,
      pieceLength: 0,
      pieceCount: 0,
      files: [],
      isMagnet: true,
      magnetUri,
    };
  }

  public parseTorrentFile(fileName: string, _contentBase64: string): TorrentMetadataPreview {
    throw new Error(`Parsing ${fileName} requires the MakeMake desktop app`);
  }

  public getSystemStats(): SystemStats {
    let globalDownloadSpeed = 0;
    let globalUploadSpeed = 0;
    let totalActivePeers = 0;
    let activeTorrents = 0;
    let pausedTorrents = 0;
    let completedTorrents = 0;
    let totalDownloadedAllTime = 0;

    for (const t of this.torrents) {
      globalDownloadSpeed += t.downloadSpeed;
      globalUploadSpeed += t.uploadSpeed;
      totalActivePeers += t.peersConnected;
      totalDownloadedAllTime += t.downloadedBytes;
      if (t.status === 'Downloading' || t.status === 'Seeding') activeTorrents += 1;
      if (t.status === 'Paused') pausedTorrents += 1;
      if (t.progress >= 100 || t.completedAt) completedTorrents += 1;
    }

    return {
      globalDownloadSpeed,
      globalUploadSpeed,
      totalActivePeers,
      dhtNodes: 0,
      totalTorrents: this.torrents.length,
      activeTorrents,
      pausedTorrents,
      completedTorrents,
      totalDownloadedAllTime,
      restoredTorrents: 0,
      resumedTorrents: 0,
      checkpointAt: Date.now(),
    };
  }
}

const devStore = new DevStore();


// -------------------------------------------------------------
// UNIFIED TAURI BRIDGE
// -------------------------------------------------------------
// In the desktop app every call goes straight to the Rust engine and errors
// are propagated to the UI (never replaced by fabricated data).

export const TauriBridge = {
  isDesktop: isTauriEnv,

  async getTorrents(): Promise<TorrentItem[]> {
    if (isTauriEnv()) {
      return invokeTauri<TorrentItem[]>('get_torrents');
    }
    return devStore.getTorrents();
  },

  async getSettings(): Promise<ClientSettings> {
    if (isTauriEnv()) {
      return invokeTauri<ClientSettings>('get_settings');
    }
    return devStore.getSettings();
  },

  async updateSettings(settings: ClientSettings): Promise<ClientSettings> {
    if (isTauriEnv()) {
      return invokeTauri<ClientSettings>('update_settings', { settings });
    }
    return devStore.updateSettings(settings);
  },

  async startTorrent(id: string): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('start_torrent', { id });
      return;
    }
    devStore.startTorrent(id);
  },

  async pauseTorrent(id: string): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('pause_torrent', { id });
      return;
    }
    devStore.pauseTorrent(id);
  },

  async forceRecheck(id: string): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('force_recheck', { id });
      return;
    }
    devStore.forceRecheck(id);
  },

  async backupTorrentNow(id: string): Promise<{ success: boolean; path: string }> {
    if (isTauriEnv()) {
      return invokeTauri<{ success: boolean; path: string }>('backup_torrent_now', { id });
    }
    return devStore.backupTorrentNow(id);
  },

  async deleteTorrent(id: string, deleteFiles: boolean): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('delete_torrent', { id, deleteFiles });
      return;
    }
    devStore.deleteTorrent(id, deleteFiles);
  },

  async pauseAll(): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('pause_all');
      return;
    }
    devStore.pauseAll();
  },

  async resumeAll(): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('resume_all');
      return;
    }
    devStore.resumeAll();
  },

  async setPriority(id: string, priority: TorrentItem['priority']): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('set_priority', { id, priority });
      return;
    }
    devStore.setPriority(id, priority);
  },

  async setFileSelection(id: string, files: number[]): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('set_file_selection', { id, files });
      return;
    }
    devStore.setFileSelection(id, files);
  },

  async getTorrentPeers(id: string): Promise<PeerDetail[]> {
    if (isTauriEnv()) {
      return invokeTauri<PeerDetail[]>('get_torrent_peers', { id });
    }
    return devStore.getPeers(id);
  },

  async exportTorrent(id: string, path: string): Promise<{ success: boolean; path: string }> {
    if (isTauriEnv()) {
      return invokeTauri<{ success: boolean; path: string }>('export_torrent', { id, path });
    }
    return devStore.exportTorrent(id, path);
  },

  async setTurtleMode(enabled: boolean): Promise<ClientSettings> {
    if (isTauriEnv()) {
      return invokeTauri<ClientSettings>('set_turtle_mode', { enabled });
    }
    return devStore.setTurtleMode(enabled);
  },

  async openPath(path: string): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('open_path', { path });
      return;
    }
    console.log(`[Open Path]: ${path}`);
  },

  async revealPath(path: string): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('reveal_path', { path });
      return;
    }
    console.log(`[Reveal Path]: ${path}`);
  },

  async addTorrent(preview: TorrentMetadataPreview, targetDir: string): Promise<TorrentItem> {
    if (isTauriEnv()) {
      return invokeTauri<TorrentItem>('add_torrent', { preview, targetDir });
    }
    return devStore.addTorrent(preview, targetDir);
  },

  async parseMagnetLink(magnetUri: string): Promise<TorrentMetadataPreview> {
    if (isTauriEnv()) {
      return invokeTauri<TorrentMetadataPreview>('parse_magnet_link', { magnetUri });
    }
    return devStore.parseMagnet(magnetUri);
  },

  async parseTorrentFile(fileName: string, contentBase64: string): Promise<TorrentMetadataPreview> {
    if (isTauriEnv()) {
      return invokeTauri<TorrentMetadataPreview>('parse_torrent_file', { fileName, contentBase64 });
    }
    return devStore.parseTorrentFile(fileName, contentBase64);
  },

  async openFolder(path: string): Promise<void> {
    if (isTauriEnv()) {
      await invokeTauri<void>('open_folder', { path });
      return;
    }
    console.log(`[Open Folder]: ${path}`);
  },

  async getSystemStats(): Promise<SystemStats> {
    if (isTauriEnv()) {
      return invokeTauri<SystemStats>('get_system_stats');
    }
    return devStore.getSystemStats();
  },

  async selectDirectory(
    title = 'Select Destination Folder',
    defaultPath?: string,
  ): Promise<string | null> {
    if (isTauriEnv()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title,
        defaultPath: defaultPath && defaultPath.trim() ? defaultPath : undefined,
      });
      return typeof selected === 'string' ? selected : null;
    }
    // Browser fallback for the vite dev preview only.
    return window.prompt('Enter Directory Path:', defaultPath || 'C:/MakeMake/Downloads') || null;
  },

  async chooseSaveTorrentPath(defaultFileName: string): Promise<string | null> {
    if (isTauriEnv()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const selected = await save({
        title: 'Save .torrent As',
        defaultPath: defaultFileName,
        filters: [{ name: 'BitTorrent metadata', extensions: ['torrent'] }],
      });
      return selected ?? null;
    }
    return window.prompt('Save .torrent to:', defaultFileName) || null;
  },
};

