import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  Info,
  Activity,
  Users,
  FileCode,
  Grid,
  Radio,
  Copy,
  FolderOpen,
  Check,
  ShieldCheck,
  ShieldAlert,
  CheckSquare,
  Square,
  Save,
  ExternalLink,
} from 'lucide-react';
import { TorrentItem, TorrentFileItem, TorrentFilesPayload, PeerDetail, TorrentDiskUsage } from '../types/torrent';
import { CyberProgressBar } from './gizmos/CyberProgressBar';
import { WorkBand, deriveHiddenWork } from './gizmos/WorkBand';
import { SpeedOscilloscope } from './gizmos/SpeedOscilloscope';
import { AhuBlockMatrix } from './gizmos/AhuBlockMatrix';
import { cyberAudio } from '../utils/cyberAudio';
import { TauriBridge } from '../api/tauriBridge';

export type DetailTab = 'overview' | 'graph' | 'peers' | 'files' | 'pieces' | 'trackers';

// How many file rows are rendered at once (the rest is behind "show more").
const FILES_PAGE = 200;

interface TorrentDetailsDrawerProps {
  torrent: TorrentItem;
  isOpen: boolean;
  activeTab?: DetailTab;
  onTabChange?: (tab: DetailTab) => void;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  onRevealPath?: (path: string) => void;
  onOpenPath?: (path: string) => void;
  onApplyFileSelection?: (id: string, files: number[]) => void;
}

export const TorrentDetailsDrawer: React.FC<TorrentDetailsDrawerProps> = ({
  torrent,
  isOpen,
  activeTab: activeTabProp,
  onTabChange,
  onClose,
  onOpenFolder,
  onRevealPath,
  onOpenPath,
  onApplyFileSelection,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [peers, setPeers] = useState<PeerDetail[]>([]);
  const [peersError, setPeersError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [selectionDirty, setSelectionDirty] = useState(false);

  // Keep the tab in sync with the tab requested by the context menu / app shell.
  useEffect(() => {
    if (activeTabProp) setActiveTab(activeTabProp);
  }, [activeTabProp]);

  // File lists can hold tens of thousands of entries; only ever render a window of them and
  // fold the rest behind "show more". Building the signature below from the whole list (as
  // this used to) allocated a string the size of the file count on every single render.
  //
  // The engine only ships the manifest of the torrent in the snapshot's `selected` slot, so a
  // row that is opened between two polls asks for it once (`get_torrent_files`) instead of
  // rendering an empty Files tab. The payload is tagged with its own info hash: a manifest that
  // arrives after the user switched rows must never be shown for the new row.
  const [manifest, setManifest] = useState<{ id: string; payload: TorrentFilesPayload } | null>(
    null,
  );
  const manifestKeyRef = useRef('');

  useEffect(() => {
    const key = `${torrent.id}:${torrent.fileCount ?? 0}`;
    if ((torrent.files?.length ?? 0) > 0) {
      manifestKeyRef.current = key;
      return;
    }
    if ((torrent.fileCount ?? 0) === 0 || manifestKeyRef.current === key) return;

    manifestKeyRef.current = key;
    let cancelled = false;
    TauriBridge.getTorrentFiles(torrent.id)
      .then((payload) => {
        if (!cancelled) setManifest({ id: torrent.id, payload });
      })
      .catch(() => {
        // The next poll carries it if the engine can serve it; allow another attempt.
        manifestKeyRef.current = '';
      });
    return () => {
      cancelled = true;
    };
  }, [torrent.id, torrent.fileCount, torrent.files]);

  const fetched = manifest && manifest.id === torrent.id ? manifest.payload : null;
  const files = useMemo(
    () =>
      (torrent.files?.length ?? 0) > 0 ? torrent.files : fetched?.files ?? ([] as TorrentFileItem[]),
    [torrent.files, fetched],
  );
  const fileProgress = (torrent.files?.length ?? 0) > 0 ? torrent.fileProgress : fetched?.fileProgress;
  const fileCount = torrent.fileCount ?? files.length;
  const hiddenWork = deriveHiddenWork(torrent);

  const [visibleFiles, setVisibleFiles] = useState(FILES_PAGE);
  const shownFiles = useMemo(() => files.slice(0, visibleFiles), [files, visibleFiles]);

  useEffect(() => {
    setVisibleFiles(FILES_PAGE);
  }, [torrent.id]);

  const selectionSignature = useMemo(() => {
    if (files.length === 0) return '0';
    let selected = 0;
    files.forEach((f) => {
      if (f.selected) selected += 1;
    });
    return `${files.length}:${selected}`;
  }, [files]);

  useEffect(() => {
    setSelection(new Set(files.filter((f) => f.selected).map((f) => f.index)));
    setSelectionDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrent.id, selectionSignature]);

  // Logical vs. actually allocated payload bytes. Payload files are sparse, so this is the
  // honest "what this torrent really costs on disk" figure; refreshing every few seconds is
  // enough because it only moves as pieces are written.
  const [diskUsage, setDiskUsage] = useState<TorrentDiskUsage | null>(null);
  useEffect(() => {
    if (!isOpen || activeTab !== 'overview' || torrent.resolving) {
      setDiskUsage(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const usage = await TauriBridge.getTorrentDiskUsage(torrent.id);
        if (!cancelled) setDiskUsage(usage);
      } catch {
        if (!cancelled) setDiskUsage(null);
      }
    };

    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOpen, activeTab, torrent.id, torrent.resolving]);

  // Sparse files normally occupy far less than their logical length; flag the difference
  // instead of silently reporting the wrong number.
  const isSparse = useMemo(() => {
    if (!diskUsage || diskUsage.logicalBytes === 0) return false;
    return diskUsage.allocatedBytes < diskUsage.logicalBytes * 0.98;
  }, [diskUsage]);

  // Real peer rows from librqbit's live peer registry (only while the tab is visible).
  useEffect(() => {
    if (!isOpen || activeTab !== 'peers') return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await TauriBridge.getTorrentPeers(torrent.id);
        if (!cancelled) {
          setPeers(rows);
          setPeersError(null);
        }
      } catch (err) {
        if (!cancelled) setPeersError(err instanceof Error ? err.message : String(err));
      }
    };

    void load();
    const timer = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOpen, activeTab, torrent.id]);

  if (!isOpen) return null;

  const handleCopyHash = () => {
    navigator.clipboard.writeText(torrent.infoHash);
    setCopiedHash(true);
    cyberAudio.playClick();
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec === 0) return '0 B/s';
    if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  // Real announce URLs reported by the torrent metadata (empty = DHT-only swarm).
  const trackers = torrent.trackers ?? [];

  return (
    <div
      className={`border-t border-cyber-cyan/30 bg-obsidian-950/95 backdrop-blur-xl transition-all duration-300 flex flex-col z-30 select-none ${
        isExpanded ? 'h-[75vh]' : 'h-80'
      }`}
    >
      {/* Drawer Control Tab Bar */}
      <div className="h-11 px-4 border-b border-slate-800 bg-obsidian-900/60 flex items-center justify-between text-xs font-mono">
        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1">
          {[
            { id: 'overview' as DetailTab, label: 'Overview', icon: Info },
            { id: 'graph' as DetailTab, label: 'Speed Graph', icon: Activity },
            { id: 'peers' as DetailTab, label: `Wayfinding Peers (${torrent.peersConnected})`, icon: Users },
            { id: 'files' as DetailTab, label: `Files (${fileCount})`, icon: FileCode },
            { id: 'pieces' as DetailTab, label: 'Piece Matrix', icon: Grid },
            { id: 'trackers' as DetailTab, label: `Oracles / Trackers (${trackers.length})`, icon: Radio },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  onTabChange?.(tab.id);
                  cyberAudio.playTabSwitch();
                }}
                className={`px-3 py-1.5 rounded-t-md flex items-center space-x-2 transition-all ${
                  isActive
                    ? 'bg-obsidian-950 text-cyber-cyan border-t-2 border-cyber-cyan font-bold shadow-glow-cyan/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-obsidian-900'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyber-cyan' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Drawer Controls: Maximize/Minimize & Close */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={isExpanded ? 'Restore Height' : 'Expand Drawer'}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Drawer Content Body */}
      <div className="flex-1 overflow-y-auto p-4 text-xs font-mono text-slate-300">
        {/* Hidden work (hashing / purging / resolving / queueing) is shown on every tab, so
            opening the inspector mid-verify never looks like a dead panel. */}
        {hiddenWork && (
          <WorkBand
            kind={hiddenWork.kind}
            label={hiddenWork.label}
            detail={hiddenWork.detail}
            progress={hiddenWork.progress}
            counter={hiddenWork.counter}
            tone={hiddenWork.tone}
            className="mb-3"
          />
        )}
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Column 1: Monolith Core Spec */}
            <div className="p-3.5 rounded-lg bg-obsidian-900/80 border border-slate-800 space-y-3">
              <div className="text-cyber-cyan font-bold border-b border-slate-800 pb-1.5 flex items-center justify-between">
                <span>SACRED DATA MONOLITH</span>
                <span className="text-[10px] text-cyber-gold uppercase">RAPA NUI SPEC</span>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="text-[10px] text-slate-500">NAME:</div>
                  <div className="text-slate-100 font-bold truncate">{torrent.name}</div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500">INFO HASH:</div>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <span className="text-[11px] text-cyber-cyan truncate">{torrent.infoHash}</span>
                    <button
                      onClick={handleCopyHash}
                      className="text-slate-400 hover:text-white"
                      title="Copy Info Hash"
                    >
                      {copiedHash ? <Check className="w-3.5 h-3.5 text-cyber-green" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500">SACRED STORAGE CHAMBER:</div>
                  <div className="flex items-center space-x-1.5 text-slate-200 truncate mt-0.5">
                    <span className="truncate">{torrent.downloadDir}</span>
                    <button
                      onClick={() => onOpenFolder(torrent.downloadDir)}
                      className="text-cyber-cyan hover:underline flex-shrink-0"
                      title="Open Download Folder"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                  <div>
                    <span className="text-slate-500">PIECES:</span>{' '}
                    <strong className="text-slate-200">{torrent.piecesCompleted} / {torrent.pieceCount}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">PIECE SIZE:</span>{' '}
                    <strong className="text-slate-200">{formatBytes(torrent.totalBytes / (torrent.pieceCount || 1))}</strong>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500">ON DISK:</span>{' '}
                    <strong className={isSparse ? 'text-cyber-gold' : 'text-slate-200'}>
                      {diskUsage ? formatBytes(diskUsage.allocatedBytes) : '—'}
                    </strong>
                    {isSparse && diskUsage && (
                      <span
                        className="text-[10px] text-slate-500 ml-1"
                        title="Payload files are sparse: the filesystem only reserved clusters for the data that has actually been written, so this stays far below the declared torrent size until the download completes."
                      >
                        sparse · of {formatBytes(diskUsage.logicalBytes)} logical
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: Progress & Temporal Backup Engine */}
            <div className="p-3.5 rounded-lg bg-obsidian-900/80 border border-slate-800 space-y-3">
              <div className="text-cyber-cyan font-bold border-b border-slate-800 pb-1.5 flex items-center justify-between">
                <span>SWARM STATUS & ARCHIVAL</span>
                <span className="text-[10px] text-cyber-green uppercase">{torrent.status}</span>
              </div>

              <div className="space-y-2.5">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">VERIFICATION PROGRESS:</span>
                    <span className="text-cyber-cyan font-bold">{torrent.progress.toFixed(1)}%</span>
                  </div>
                  <CyberProgressBar
                    progress={torrent.progress}
                    height={10}
                    glowColor={torrent.progress >= 100 ? 'green' : 'cyan'}
                    piecesBitfield={torrent.piecesBitfield}
                  />
                </div>

                {/* The engine's own explanation of the current phase (why it is or is not
                    moving, how many peers it sees, what the trackers report). */}
                {torrent.statusDetail && (
                  <div
                    className={`p-2 rounded border text-[10px] font-mono leading-relaxed ${
                      torrent.status === 'Error'
                        ? 'border-cyber-red/40 bg-cyber-red/10 text-cyber-red'
                        : torrent.stalledSeconds >= 45 && torrent.status === 'Downloading'
                          ? 'border-cyber-gold/40 bg-cyber-gold/10 text-cyber-gold'
                          : 'border-slate-800 bg-obsidian-950/80 text-slate-400'
                    }`}
                  >
                    {torrent.statusDetail}
                  </div>
                )}

                <div className="p-2.5 rounded bg-obsidian-950 border border-slate-800/80 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">TEMPORAL BACKUP:</span>
                    {torrent.backedUp ? (
                      <span className="text-cyber-gold font-bold flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        VAULT SYNCHRONIZED
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        PENDING INTERVAL
                      </span>
                    )}
                  </div>
                  {torrent.backupPath && (
                    <div className="text-[10px] text-slate-500 truncate">
                      {torrent.backupPath}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500">INGESTED:</span>{' '}
                    <strong className="text-slate-200">{formatBytes(torrent.downloadedBytes)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">SEEDED:</span>{' '}
                    <strong className="text-slate-200">{formatBytes(torrent.uploadedBytes)}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 3: Live Swarm Dynamics */}
            <div className="p-3.5 rounded-lg bg-obsidian-900/80 border border-slate-800 space-y-3">
              <div className="text-cyber-cyan font-bold border-b border-slate-800 pb-1.5">
                SWARM DYNAMICS (TANGATA MANU)
              </div>

              <div className="space-y-2 text-[11px]">
                {torrent.error && (
                  <div className="rounded border border-cyber-red/50 bg-red-950/40 px-2 py-1.5 text-[10px] text-red-300 flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span className="break-all">{torrent.error}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">CURRENT DL RATE:</span>
                  <span className="text-cyber-cyan font-bold">{formatSpeed(torrent.downloadSpeed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">CURRENT UL RATE:</span>
                  <span className="text-cyber-red font-bold">{formatSpeed(torrent.uploadSpeed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">SWARM RATIO:</span>
                  <span className="text-cyber-gold font-bold">
                    {torrent.downloadedBytes > 0
                      ? (torrent.uploadedBytes / torrent.downloadedBytes).toFixed(2)
                      : '0.00'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">CONNECTED PEERS:</span>
                  <span className="text-slate-200 font-bold">{torrent.peersConnected} of {torrent.peersTotal}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">SWARM SEEDS:</span>
                  <span className="text-cyber-green font-bold">
                    {torrent.swarmSources > 0 ? torrent.seedsTotal : 'unknown'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">SWARM LEECHERS:</span>
                  <span className="text-cyber-gold font-bold">
                    {torrent.swarmSources > 0 ? torrent.leechersTotal : 'unknown'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PRIORITY:</span>
                  <span className="text-cyber-gold font-bold uppercase">{torrent.priority}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SPEED GRAPH */}
        {activeTab === 'graph' && (
          <div className="space-y-4">
            <SpeedOscilloscope
              currentDownloadSpeed={torrent.downloadSpeed}
              currentUploadSpeed={torrent.uploadSpeed}
              maxHistorySeconds={60}
            />
          </div>
        )}

        {/* TAB 3: WAYFINDING PEERS (real librqbit counters) */}
        {activeTab === 'peers' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
              {[
                { label: 'LIVE PEERS', value: torrent.peersConnected, tone: 'text-cyber-cyan' },
                { label: 'PEERS SEEN', value: torrent.peersTotal, tone: 'text-slate-200' },
                {
                  label: 'SEEDS (SWARM)',
                  value: torrent.swarmSources > 0 ? torrent.seedsTotal : '?',
                  tone: 'text-cyber-green',
                },
                {
                  label: 'LEECHERS (SWARM)',
                  value: torrent.swarmSources > 0 ? torrent.leechersTotal : '?',
                  tone: 'text-cyber-gold',
                },
                { label: 'DOWN RATE', value: formatSpeed(torrent.downloadSpeed), tone: 'text-cyber-cyan' },
                { label: 'UP RATE', value: formatSpeed(torrent.uploadSpeed), tone: 'text-cyber-red' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded border border-slate-800 bg-obsidian-950/80 px-3 py-2"
                >
                  <div className="text-[9px] font-bold text-slate-500">{stat.label}</div>
                  <div className={`text-lg font-bold ${stat.tone}`}>{stat.value}</div>
                </div>
              ))}
            </div>
            <div className="rounded border border-slate-800 overflow-hidden">
              <table className="w-full text-left divide-y divide-slate-800 text-[11px]">
                <thead className="bg-obsidian-900 text-slate-400 font-bold">
                  <tr>
                    <th className="px-3 py-2">PEER ADDRESS</th>
                    <th className="px-3 py-2">STATE</th>
                    <th className="px-3 py-2">CLIENT</th>
                    <th className="px-3 py-2">TRANSPORT</th>
                    <th className="px-3 py-2">DOWN</th>
                    <th className="px-3 py-2">UP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-obsidian-950/80">
                  {peers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-[11px] font-mono text-slate-400">
                        {peersError
                          ? `Peer telemetry unavailable: ${peersError}`
                          : torrent.peersConnected > 0
                          ? 'Peer registry is warming up — rows appear as soon as the connections finish the handshake.'
                          : 'NO PEERS CONNECTED — the engine has not established a peer connection for this torrent yet.'}
                      </td>
                    </tr>
                  ) : (
                    peers.map((peer) => (
                      <tr key={peer.address} className="hover:bg-slate-800/40">
                        <td className="px-3 py-1.5 font-mono text-cyber-cyan">{peer.address}</td>
                        <td className="px-3 py-1.5 text-slate-300">{peer.state}</td>
                        <td className="px-3 py-1.5 text-slate-400 truncate max-w-[180px]">
                          {peer.client || 'unknown'}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 uppercase">
                          {peer.connection || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-cyber-cyan">
                          {formatBytes(peer.downloadedBytes)}
                        </td>
                        <td className="px-3 py-1.5 text-cyber-red">
                          {formatBytes(peer.uploadedBytes)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: FILES (with real per-file progress and payload selection) */}
        {activeTab === 'files' && (
          <div className="space-y-2">
            {/* The manifest of a torrent that was selected between two polls arrives within a
                few hundred milliseconds; say so instead of showing an empty table. */}
            {fileCount > 0 && files.length === 0 && (
              <WorkBand
                kind="transmit"
                label="Syncing file manifest"
                detail={`Reading the payload list of ${fileCount} file(s) from the engine`}
                tone="cyan"
              />
            )}
            <div className="flex items-center justify-between text-[11px] font-mono">
              <div className="flex items-center gap-2 text-slate-400">
                <button
                  onClick={() => {
                    setSelection(new Set(files.map((f) => f.index)));
                    setSelectionDirty(true);
                  }}
                  className="text-cyber-cyan hover:underline"
                >
                  Select all
                </button>
                <span className="text-slate-600">•</span>
                <button
                  onClick={() => {
                    setSelection(new Set());
                    setSelectionDirty(true);
                  }}
                  className="text-slate-400 hover:underline"
                >
                  None
                </button>
                <span className="text-slate-600">•</span>
                <span>
                  {selection.size}/{fileCount} selected
                </span>
              </div>

              <button
                onClick={() => {
                  if (!onApplyFileSelection || selection.size === 0) return;
                  onApplyFileSelection(torrent.id, Array.from(selection).sort((a, b) => a - b));
                  setSelectionDirty(false);
                  cyberAudio.playEngage();
                }}
                disabled={!selectionDirty || selection.size === 0 || !onApplyFileSelection}
                className="cyber-button px-3 py-1 bg-cyber-cyan text-black font-bold disabled:opacity-40 flex items-center gap-1.5"
                title="Apply the new payload selection to the live torrent"
              >
                <Save className="w-3.5 h-3.5" />
                APPLY SELECTION
              </button>
            </div>

            <div className="rounded border border-slate-800 overflow-hidden">
              <table className="w-full text-left divide-y divide-slate-800 text-[11px]">
                <thead className="bg-obsidian-900 text-slate-400 font-bold">
                  <tr>
                    <th className="px-2 py-2 w-8">DL</th>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">FILE PATH</th>
                    <th className="px-3 py-2">TOTAL SIZE</th>
                    <th className="px-3 py-2">PROGRESS</th>
                    <th className="px-3 py-2">PRIORITY</th>
                    <th className="px-3 py-2">ACTIONS</th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-slate-800/60 bg-obsidian-950/80">
                {shownFiles.map((file: TorrentFileItem) => {
                  const downloadedForFile = fileProgress?.[file.index];
                  // Deliberately not called `fileProgress`: that is the per-file byte array.
                  const filePercent =
                    downloadedForFile !== undefined && file.length > 0
                      ? Math.min(100, (downloadedForFile / file.length) * 100)
                      : torrent.progress;
                    const isChecked = selection.has(file.index);
                    const filePath = `${torrent.downloadDir}/${file.path || file.name}`;
                    return (
                  <tr key={file.index} className="hover:bg-slate-800/40">
                    <td className="px-2 py-2">
                      <button
                        onClick={() => {
                          const next = new Set(selection);
                          if (next.has(file.index)) next.delete(file.index);
                          else next.add(file.index);
                          setSelection(next);
                          setSelectionDirty(true);
                          cyberAudio.playClick();
                        }}
                        title="Include or exclude this file from the download"
                      >
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-cyber-cyan" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{file.index + 1}</td>
                    <td className="px-3 py-2 font-mono text-slate-200">{file.path || file.name}</td>
                    <td className="px-3 py-2 text-slate-400">{formatBytes(file.length)}</td>
                    <td className="px-3 py-2 w-48">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-cyber-cyan"
                            style={{ width: `${filePercent}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-cyber-cyan">{filePercent.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-cyber-cyan border border-slate-700 text-[10px] font-bold">
                        {torrent.priority.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onOpenPath?.(filePath)}
                          className="text-slate-400 hover:text-cyber-cyan"
                          title="Open this file with the default app"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onRevealPath?.(filePath)}
                          className="text-slate-400 hover:text-cyber-gold"
                          title="Reveal this file in Explorer"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {files.length > shownFiles.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2 text-center">
                      <button
                        onClick={() => setVisibleFiles((current) => current + FILES_PAGE)}
                        className="text-[11px] font-mono text-cyber-cyan hover:underline"
                      >
                        Show {Math.min(FILES_PAGE, files.length - shownFiles.length)} more of{' '}
                        {files.length.toLocaleString()} files
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* TAB 5: PIECES */}
        {activeTab === 'pieces' && (
          <div>
            <AhuBlockMatrix
              piecesBitfield={torrent.piecesBitfield}
              pieceCount={torrent.pieceCount}
              totalSize={torrent.totalBytes}
              torrentName={torrent.name}
            />
          </div>
        )}

        {/* TAB 6: TRACKERS */}
        {activeTab === 'trackers' && (
          <div className="rounded border border-slate-800 overflow-hidden">
            <table className="w-full text-left divide-y divide-slate-800 text-[11px]">
              <thead className="bg-obsidian-900 text-slate-400 font-bold">
                <tr>
                  <th className="px-3 py-2">ORACLE ANNOUNCE URL</th>
                  <th className="px-3 py-2">TRANSPORT</th>
                  <th className="px-3 py-2">ENGINE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-obsidian-950/80">
                {trackers.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 font-mono text-slate-400">
                      This torrent declares no HTTP/UDP trackers — the swarm is discovered through
                      DHT only.
                    </td>
                  </tr>
                ) : (
                  trackers.map((url) => (
                    <tr key={url} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-mono font-bold text-cyber-cyan break-all">
                        {url}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {url.startsWith('udp:')
                          ? 'UDP tracker'
                          : url.startsWith('wss:')
                          ? 'WebSocket tracker'
                          : 'HTTP tracker'}
                      </td>
                      <td className="px-3 py-2 font-bold text-cyber-green">Managed by librqbit</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
