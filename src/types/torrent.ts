export interface TorrentFileItem {
  index: number;
  name: string;
  path: string;
  length: number;
  selected: boolean;
  /** BEP-47 padding file: never written to disk, cannot be selected. */
  padding?: boolean;
}

/**
 * What already sits in the folder a torrent is about to be written to.
 *
 * Every torrent gets its own folder (`<download folder>/<torrent name>`), so an existing
 * folder means an earlier attempt, a finished copy, or an unrelated folder with the same
 * name. The add dialog asks before touching it; on resume, the engine verifies the pieces
 * that are already on disk and only downloads what is missing.
 */
export interface ExistingPayload {
  /** Absolute path of the per-torrent folder. */
  folder: string;
  /** The folder already exists on disk. */
  exists: boolean;
  filesPresent: number;
  filesComplete: number;
  filesTotal: number;
  /** Bytes of the selection that are already on disk (capped per file). */
  bytesPresent: number;
  /** Declared bytes of the selection. */
  bytesTotal: number;
  /** Entries in the folder that are not part of this torrent. */
  foreignFiles: number;
  /** This info hash is already in the queue. */
  alreadyManaged: boolean;
}

/** How an existing destination folder is treated when a torrent is added. */
export type AddMode = 'resume' | 'replace';

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
  status:
    | 'Downloading'
    | 'Seeding'
    | 'Paused'
    | 'Checking'
    | 'Queued'
    | 'Resolving'
    | 'Completed'
    | 'Error';
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
  /** True while the torrent is a queued magnet that has not resolved its metadata yet. */
  resolving?: boolean;
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
  /** Re-arm the swarms that were running when the app was last closed. */
  resumeOnLaunch: boolean;
}

export interface TorrentSnapshot {
  torrents: TorrentItem[];
  stats: SystemStats;
}

/**
 * Logical size vs. bytes actually allocated on disk for one torrent.
 *
 * MakeMake pre-creates payload files as sparse files, so a freshly added 133 GiB torrent
 * reports the full logical length and only a few megabytes of allocation; the gap closes as
 * pieces are written.
 */
export interface TorrentDiskUsage {
  /** Payload files of this torrent that exist on disk. */
  files: number;
  /** Sum of the logical file lengths (the declared torrent size). */
  logicalBytes: number;
  /** Bytes the filesystem actually reserved for those files. */
  allocatedBytes: number;
}

export interface SystemStats {
  globalDownloadSpeed: number;
  globalUploadSpeed: number;
  totalActivePeers: number;
  dhtNodes: number;
  totalTorrents: number;
  activeTorrents: number;
  pausedTorrents: number;
  completedTorrents: number;
  totalDownloadedAllTime: number;
  /** Torrents the engine restored from its session database on this launch. */
  restoredTorrents: number;
  /** Of those, the ones re-armed automatically. */
  resumedTorrents: number;
  /** Unix ms of the last durable state checkpoint. */
  checkpointAt: number;
  /** Free bytes on the volume that holds the download folder (0 = unknown). */
  diskFreeBytes?: number;
  /** Total size of that volume (0 = unknown). */
  diskTotalBytes?: number;
  /** The previous run ended without sealing its session (crash, power loss, kill). */
  crashedLastRun?: boolean;
}
