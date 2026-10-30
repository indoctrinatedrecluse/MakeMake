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
    | 'Deleting'
    | 'Error';
  peersConnected: number;
  peersTotal: number;
  /** Peers in a handshake right now. */
  peersConnecting: number;
  /** Peers discovered but not dialled yet. */
  peersQueued: number;
  /** Peers the engine gave up on (timeouts, refusals). */
  peersDead: number;
  /**
   * Seeds in the swarm, scraped from the torrent's trackers.
   *
   * `swarmSources === 0` means no tracker answered (DHT-only torrent, private tracker down),
   * so `0` seeds must be shown as "unknown" rather than as an empty swarm.
   */
  seedsTotal: number;
  /** Leechers in the swarm, from the same scrape. */
  leechersTotal: number;
  /** Trackers that answered the last scrape. */
  swarmSources: number;
  /** Unix ms of the last scrape attempt (0 = never). */
  swarmCheckedAt: number;
  /** One sentence explaining what this swarm is doing right now. */
  statusDetail: string;
  /** Seconds running without a single new verified byte (0 = moving). */
  stalledSeconds: number;
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
  /** True while this entry's payload is being erased from disk. */
  deleting?: boolean;
  /**
   * Number of payload files.
   *
   * The manifest itself (`files`) is only sent for the torrent the details drawer is showing —
   * a 20 000-file pack would otherwise travel through IPC on every poll. Everything else asks
   * `TauriBridge.getTorrentFiles` for it explicitly.
   */
  fileCount?: number;
  /** Absolute path of the payload for single-file torrents (`undefined` for multi-file ones). */
  primaryPath?: string;
  /** A tracker scrape for this torrent is running right now. */
  swarmRefreshing?: boolean;
}

/** Full payload manifest of one torrent, fetched on demand (see `get_torrent_files`). */
export interface TorrentFilesPayload {
  files: TorrentFileItem[];
  /** Per-file downloaded bytes, aligned with `files`. */
  fileProgress: number[];
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
  /** Payload wipes currently running (or just finished, for a few seconds). */
  purges?: PurgeReport[];
}

/**
 * One payload wipe ("Purge Monolith & Files").
 *
 * The engine deletes the files on a background thread and reports how it went: the UI keeps
 * the row visible with a file counter until `done`, then toasts `filesRemoved` /
 * `filesFailed` once.
 */
export interface PurgeReport {
  infoHash: string;
  name: string;
  dir: string;
  filesTotal: number;
  filesDone: number;
  filesRemoved: number;
  filesFailed: number;
  done: boolean;
  error?: string | null;
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
