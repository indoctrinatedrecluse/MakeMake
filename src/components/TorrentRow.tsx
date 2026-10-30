import React from 'react';
import {
  Play,
  Pause,
  ShieldCheck,
  ShieldAlert,
  ArrowDown,
  ArrowUp,
  HardDrive,
  Users,
  Sprout,
  TriangleAlert,
  Loader2,
} from 'lucide-react';
import { TorrentItem } from '../types/torrent';
import { CyberProgressBar } from './gizmos/CyberProgressBar';
import { WorkBand, deriveHiddenWork } from './gizmos/WorkBand';
import { WorkGlyph } from './gizmos/WorkGlyph';
import { cyberAudio } from '../utils/cyberAudio';

interface TorrentRowProps {
  torrent: TorrentItem;
  isSelected: boolean;
  viewMode?: 'cards' | 'table';
  onSelect: (torrent: TorrentItem) => void;
  onContextMenu: (e: React.MouseEvent, torrent: TorrentItem) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
}

/**
 * Everything a row actually renders, flattened into one comparable string.
 *
 * The window polls once a second and every poll produces brand-new objects, so a plain
 * `React.memo` would never hit. Comparing this key instead keeps a quiet row from re-rendering
 * (and re-laying out its progress bar and badge) twenty times a minute.
 */
export const torrentRenderKey = (t: TorrentItem): string =>
  [
    t.name,
    t.status,
    t.statusDetail,
    t.downloadedBytes,
    t.totalBytes,
    t.uploadedBytes,
    t.downloadSpeed,
    t.uploadSpeed,
    t.peersConnected,
    t.peersTotal,
    t.peersConnecting,
    t.seedsTotal,
    t.leechersTotal,
    t.swarmSources,
    t.swarmRefreshing ? 1 : 0,
    t.stalledSeconds,
    t.etaSeconds ?? -1,
    t.piecesCompleted,
    t.pieceCount,
    t.resolving ? 1 : 0,
    t.deleting ? 1 : 0,
    t.backedUp ? 1 : 0,
    t.backupPath ?? '',
    t.error ?? '',
    t.downloadDir,
    t.progress.toFixed(2),
  ].join('\u0001');

const TorrentRowBase: React.FC<TorrentRowProps> = ({
  torrent,
  isSelected,
  viewMode = 'cards',
  onSelect,
  onContextMenu,
  onStart,
  onPause,
}) => {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec === 0) return '0 B/s';
    if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatEta = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return '∞';
    if (seconds === 0) return 'Done';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const getStatusColor = () => {
    switch (torrent.status) {
      case 'Downloading':
        return 'text-cyber-cyan bg-cyber-cyan/15 border-cyber-cyan/40';
      case 'Seeding':
        return 'text-cyber-green bg-cyber-green/15 border-cyber-green/40';
      case 'Paused':
        return 'text-slate-400 bg-slate-800 border-slate-700';
      case 'Checking':
        return 'text-cyber-gold bg-cyber-gold/15 border-cyber-gold/40 animate-pulse';
      case 'Resolving':
        return 'text-cyber-gold bg-cyber-gold/15 border-cyber-gold/40 animate-pulse';
      case 'Deleting':
        return 'text-cyber-red bg-cyber-red/15 border-cyber-red/40 animate-pulse';
      case 'Error':
        return 'text-cyber-red bg-cyber-red/15 border-cyber-red/40';
      default:
        return 'text-slate-400 bg-slate-800 border-slate-700';
    }
  };

  const isPaused = torrent.status === 'Paused';
  // A queued magnet has no librqbit handle yet: the button retries metadata resolution.
  const isResolving = torrent.resolving === true;
  const isDeleting = torrent.status === 'Deleting';
  const canStart = isPaused || isResolving;

  // Swarm sizes come from a tracker scrape: `swarmSources === 0` means no tracker answered,
  // which must read as "unknown" rather than "no seeds in the world".
  const swarmKnown = (torrent.swarmSources ?? 0) > 0;
  const seedsLabel = swarmKnown ? `${torrent.seedsTotal}` : '?';
  const leechLabel = swarmKnown ? `${torrent.leechersTotal}` : '?';
  const stalled = (torrent.stalledSeconds ?? 0) >= 45 && torrent.status === 'Downloading';
  // Hidden work: verification, purge, magnet resolution, queueing. `null` when the row is
  // simply transferring (or idle), because then the numbers themselves are the feedback.
  const work = deriveHiddenWork(torrent);

  // Compact High-Density Table View Mode
  if (viewMode === 'table') {
    return (
      <tr
        onClick={() => {
          onSelect(torrent);
          cyberAudio.playClick();
        }}
        onContextMenu={(e) => onContextMenu(e, torrent)}
        className={`text-[11px] font-mono cursor-pointer transition-colors ${
          isSelected
            ? 'bg-cyber-cyan/15 text-white border-y border-cyber-cyan/50'
            : 'hover:bg-slate-800/40 text-slate-300'
        }`}
      >
        <td className="px-3 py-2 flex items-center space-x-2">
          <span>🗿</span>
          <span className="font-bold truncate max-w-[280px]">{torrent.name}</span>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center space-x-1.5">
            {work && <WorkGlyph kind={work.kind} size={11} title={work.label} />}
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${getStatusColor()}`}>
              {torrent.status}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 w-44">
          <div className="flex items-center space-x-2">
            <div className="flex-1">
              <CyberProgressBar
                progress={torrent.progress}
                height={6}
                showSegments={false}
                glowColor={torrent.progress >= 100 ? 'green' : 'cyan'}
              />
            </div>
            <span className="text-[10px] text-cyber-cyan font-bold">{torrent.progress.toFixed(0)}%</span>
          </div>
        </td>
        <td className="px-3 py-2 text-slate-400">{formatBytes(torrent.totalBytes)}</td>
        <td className="px-3 py-2 text-cyber-cyan font-bold">{formatSpeed(torrent.downloadSpeed)}</td>
        <td className="px-3 py-2 text-cyber-red font-bold">{formatSpeed(torrent.uploadSpeed)}</td>
        <td className="px-3 py-2 text-slate-400">{formatEta(torrent.etaSeconds)}</td>
        <td className="px-3 py-2 text-slate-400">
          {torrent.swarmRefreshing && (
            <WorkGlyph
              kind="scrape"
              size={10}
              className="inline-block mr-1 align-[-1px]"
              title="Scraping the trackers for fresh seed/leech numbers"
            />
          )}
          <span className="text-cyber-green font-bold">{seedsLabel}</span>
          <span className="text-slate-600"> / </span>
          <span className="text-cyber-gold">{leechLabel}</span>
        </td>
        <td className="px-3 py-2 text-slate-400">
          {torrent.peersConnected}/{torrent.peersTotal}
        </td>
      </tr>
    );
  }

  // Cyber Monolith Card View Mode (Default)
  return (
    <div
      onClick={() => {
        onSelect(torrent);
        cyberAudio.playClick();
      }}
      onContextMenu={(e) => onContextMenu(e, torrent)}
      className={`relative p-3.5 rounded-lg border transition-all duration-200 cursor-pointer select-none ${
        isSelected
          ? 'bg-obsidian-900 border-cyber-cyan shadow-glow-cyan/25'
          : 'bg-obsidian-950/80 hover:bg-obsidian-900/60 border-slate-800/80 hover:border-slate-700'
      }`}
    >
      {/* Upper Bar: Title, Status, Quick Controls */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center space-x-2.5 truncate max-w-2xl">
          <span className="text-base">🗿</span>
          <span className="text-sm font-mono font-bold text-slate-100 truncate hover:text-cyber-cyan transition-colors">
            {torrent.name}
          </span>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Status Badge */}
          <span
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase border ${getStatusColor()}`}
          >
            {torrent.status}
          </span>

          {/* Temporal Backup Indicator */}
          {torrent.backedUp ? (
            <span
              title={`Auto-backed up to: ${torrent.backupPath || 'Vault'}`}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-cyber-gold/15 text-cyber-gold border border-cyber-gold/40 text-[10px] font-mono font-bold"
            >
              <ShieldCheck className="w-3 h-3" />
              <span>BACKED UP</span>
            </span>
          ) : (
            <span
              title="Auto-backup pending interval"
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-mono"
            >
              <ShieldAlert className="w-3 h-3" />
              <span>BACKUP QUEUED</span>
            </span>
          )}

          {/* Quick Play/Pause Action */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isDeleting) return;
              cyberAudio.playClick();
              if (canStart) {
                onStart(torrent.id);
              } else {
                onPause(torrent.id);
              }
            }}
            disabled={isDeleting}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              isDeleting
                ? 'Payload is being erased from disk'
                : isResolving
                  ? 'Retry metadata resolution'
                  : isPaused
                    ? 'Awaken Monolith (Start)'
                    : 'Dormant State (Pause)'
            }
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 text-cyber-red animate-spin" />
            ) : canStart ? (
              <Play className="w-3.5 h-3.5 text-cyber-cyan" />
            ) : (
              <Pause className="w-3.5 h-3.5 text-cyber-red" />
            )}
          </button>
        </div>
      </div>

      {/* Middle Bar: Hypermodern Cyber Progress Bar & Heatmap */}
      <div className="space-y-1.5 my-2.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-cyber-cyan text-cyber-glow-cyan">
              {torrent.progress.toFixed(1)}%
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400">
              {formatBytes(torrent.downloadedBytes)} / {formatBytes(torrent.totalBytes)}
            </span>
          </div>

          <div className="flex items-center space-x-3 text-[11px] text-slate-400">
            <span>ETA: <strong className="text-slate-200">{formatEta(torrent.etaSeconds)}</strong></span>
          </div>
        </div>

        {/* Cyber Plasma Progress Bar with Heatmap */}
        <CyberProgressBar
          progress={torrent.progress}
          height={8}
          glowColor={torrent.progress >= 100 ? 'green' : 'cyan'}
          piecesBitfield={torrent.piecesBitfield}
        />
      </div>

      {/* Hidden work: hashing, erasing, resolving, queueing. Only mounted while it runs, so a
          row that is quietly transferring never carries extra animation. */}
      {work && (
        <WorkBand
          kind={work.kind}
          label={work.label}
          detail={work.detail}
          progress={work.progress}
          counter={work.counter}
          tone={work.tone}
          className="mb-2"
        />
      )}

      {/* Swarm Telemetry: speeds, seeds/leech (tracker scrape) and peers (librqbit) */}
      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
        <div className="flex items-center space-x-3 flex-wrap gap-y-1">
          <div className="flex items-center space-x-1">
            <ArrowDown className="w-3 h-3 text-cyber-cyan" />
            <span className="text-cyber-cyan font-bold font-mono">
              {formatSpeed(torrent.downloadSpeed)}
            </span>
          </div>

          <div className="flex items-center space-x-1">
            <ArrowUp className="w-3 h-3 text-cyber-red" />
            <span className="text-cyber-red font-bold font-mono">
              {formatSpeed(torrent.uploadSpeed)}
            </span>
          </div>

          {/* Seeds / leechers in the swarm (trackers), not just the ones we talk to. */}
          <div
            className="flex items-center space-x-1"
            title={
              swarmKnown
                ? `Tracker scrape: ${torrent.seedsTotal} seed(s), ${torrent.leechersTotal} leecher(s) in the swarm (${torrent.swarmSources} tracker(s) answered)`
                : 'No tracker answered the last scrape — swarm size unknown (DHT-only or trackers down)'
            }
          >
            {torrent.swarmRefreshing ? (
              <WorkGlyph kind="scrape" size={11} title="Scraping the trackers right now" />
            ) : (
              <Sprout className="w-3 h-3 text-cyber-green" />
            )}
            <span className="text-slate-400">
              SEEDS:{' '}
              <strong className={swarmKnown ? 'text-cyber-green' : 'text-slate-500'}>
                {seedsLabel}
              </strong>
            </span>
          </div>

          <div className="flex items-center space-x-1" title="Leechers reported by the trackers">
            <span className="text-slate-500">LEECH:</span>
            <strong className={swarmKnown ? 'text-cyber-gold' : 'text-slate-500'}>
              {leechLabel}
            </strong>
          </div>

          <div
            className="flex items-center space-x-1 text-slate-400"
            title={`Peers this client is connected to / known: ${torrent.peersConnected} live, ${torrent.peersConnecting} connecting, ${torrent.peersQueued} queued, ${torrent.peersDead} dead`}
          >
            <Users className="w-3 h-3 text-cyber-gold" />
            <span>
              PEERS: <strong className="text-slate-200">{torrent.peersConnected}</strong>/
              {torrent.peersTotal}
            </span>
          </div>

          {stalled && (
            <span
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-cyber-red/15 border border-cyber-red/40 text-cyber-red text-[10px] anim-ember"
              title="No new verified byte arrived for a while — see the line below for why"
            >
              <TriangleAlert className="w-3 h-3" />
              <span>IDLE {torrent.stalledSeconds}s</span>
            </span>
          )}
        </div>

        <div className="hidden md:flex items-center space-x-1 text-slate-500 truncate max-w-xs text-[10px]">
          <HardDrive className="w-3 h-3" />
          <span className="truncate">{torrent.downloadDir}</span>
        </div>
      </div>

      {/* What is actually happening right now (the engine's own words). */}
      {torrent.statusDetail && (
        <div
          className={`mt-1 text-[10px] font-mono truncate ${
            torrent.status === 'Error'
              ? 'text-cyber-red'
              : stalled
                ? 'text-cyber-gold'
                : 'text-slate-500'
          }`}
          title={torrent.statusDetail}
        >
          {torrent.statusDetail}
        </div>
      )}
    </div>
  );
};

/**
 * A row only re-renders when the numbers it shows actually changed.
 *
 * Every poll hands the list a fresh `TorrentItem`, so the comparison is done on the rendered
 * values ([`torrentRenderKey`]) rather than on object identity. Callbacks are deliberately
 * ignored: they are re-created by the app shell on every render, and none of them closes over
 * row state.
 */
export const TorrentRow = React.memo(
  TorrentRowBase,
  (prev, next) =>
    prev.isSelected === next.isSelected &&
    prev.viewMode === next.viewMode &&
    torrentRenderKey(prev.torrent) === torrentRenderKey(next.torrent),
);
