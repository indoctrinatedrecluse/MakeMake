export interface TorrentFileItem {
  index: number;
  name: string;
  path: string;
  length: number;
  selected: boolean;
}

export interface TorrentMetadataPreview {
  name: string;
  infoHash: string;
  totalSize: number;
  pieceLength: number;
  pieceCount: number;
  files: TorrentFileItem[];
  isMagnet: boolean;
  magnetUri?: string;
  rawBencodeBase64?: string;
}

export interface TorrentItem {
  id: string; // infoHash
  name: string;
  infoHash: string;
  magnetUri?: string;
  totalBytes: number;
  downloadedBytes: number;
  uploadedBytes: number;
  downloadSpeed: number; // bytes/sec
  uploadSpeed: number; // bytes/sec
  progress: number; // 0 to 100
  status: 'Downloading' | 'Seeding' | 'Paused' | 'Checking' | 'Queued' | 'Completed' | 'Error';
  peersConnected: number;
  peersTotal: number;
  seedsConnected: number;
  seedsTotal: number;
  etaSeconds: number | null;
  downloadDir: string;
  files: TorrentFileItem[];
  pieceCount: number;
  piecesCompleted: number;
  piecesBitfield: number[]; // sampled or compressed bitfield (0 = missing, 1 = downloaded)
  fileProgress?: number[]; // per-file downloaded bytes, aligned with `files`
  trackers?: string[]; // announce URLs declared by the torrent metadata
  createdAt: number;
  completedAt?: number | null;
  backedUp: boolean;
  backupPath?: string;
  rawTorrentBase64?: string;
  priority: 'High' | 'Normal' | 'Low';
  error?: string | null;
}

export interface PeerDetail {
  address: string;
  state: string;
  client?: string | null;
  connection?: string | null;
  downloadedBytes: number;
  uploadedBytes: number;
}

export interface ClientSettings {
  /**
   * Empty string means "not configured" — MakeMake will then ask for a folder
   * every time a torrent is added.
   */
  defaultDownloadDir: string;
  alwaysAskDownloadDir: boolean;
  autoBackupEnabled: boolean;
  backupIntervalHours: number; // 0 = immediate, 1, 6, 12, 24, 72, 168
  backupDir: string;
  moveCompletedTorrentEnabled: boolean;
  completedTorrentDir: string;
  maxDownloadSpeed: number; // 0 for unlimited
  maxUploadSpeed: number; // 0 for unlimited
  turtleModeEnabled: boolean;
  turtleDownloadSpeed: number;
  turtleUploadSpeed: number;
  seedAfterComplete: boolean;
  listenPort: number;
  enableSoundFx: boolean;
  theme: 'cyber-obsidian' | 'neon-caldera' | 'solar-birdman';
}

export interface SystemStats {
  globalDownloadSpeed: number;
  globalUploadSpeed: number;
  totalActivePeers: number;
  dhtNodes: number;
  totalTorrents: number;
  activeTorrents: number;
  totalDownloadedAllTime: number;
}
