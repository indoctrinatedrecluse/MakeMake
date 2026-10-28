import React, { useState } from 'react';
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
} from 'lucide-react';
import { TorrentItem, TorrentFileItem } from '../types/torrent';
import { CyberProgressBar } from './gizmos/CyberProgressBar';
import { SpeedOscilloscope } from './gizmos/SpeedOscilloscope';
import { AhuBlockMatrix } from './gizmos/AhuBlockMatrix';
import { cyberAudio } from '../utils/cyberAudio';

export type DetailTab = 'overview' | 'graph' | 'peers' | 'files' | 'pieces' | 'trackers';

interface TorrentDetailsDrawerProps {
  torrent: TorrentItem;
  isOpen: boolean;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}

export const TorrentDetailsDrawer: React.FC<TorrentDetailsDrawerProps> = ({
  torrent,
  isOpen,
  onClose,
  onOpenFolder,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

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

  // Mock Peers Data for Wayfinding Tab
  const mockPeers = [
    { ip: '185.190.141.22', port: 51413, client: 'MakeMake/0.1.0 (Rapa Nui)', country: 'CL', dl: 4200000, ul: 350000, progress: 94.2, hopu: 'DIVING (DL)' },
    { ip: '89.207.132.88', port: 6881, client: 'qBittorrent/5.0.2', country: 'NZ', dl: 3800000, ul: 210000, progress: 100.0, hopu: 'EGG SECURED (SEED)' },
    { ip: '142.250.180.46', port: 59384, client: 'Transmission/4.0.5', country: 'US', dl: 2100000, ul: 120000, progress: 78.5, hopu: 'DIVING (DL)' },
    { ip: '198.51.100.14', port: 6889, client: 'libtorrent/2.0.10', country: 'DE', dl: 1850000, ul: 95000, progress: 62.0, hopu: 'DIVING (DL)' },
    { ip: '203.0.113.82', port: 49152, client: 'MakeMake/0.1.0 (Rapa Nui)', country: 'PF', dl: 1450000, ul: 84000, progress: 85.3, hopu: 'SNATCHING' },
    { ip: '192.0.2.201', port: 52100, client: 'Deluge/2.1.1', country: 'JP', dl: 0, ul: 0, progress: 41.2, hopu: 'CHOKED' },
  ];

  // Mock Trackers Data for Oracles Tab
  const mockTrackers = [
    { url: 'udp://tracker.opentrackr.org:1337/announce', status: 'Working [200 OK]', seeds: 64, peers: 128, downloaded: 4892, nextAnnounce: '18m 42s' },
    { url: 'udp://open.demonii.com:1337/announce', status: 'Working [200 OK]', seeds: 42, peers: 86, downloaded: 3120, nextAnnounce: '22m 10s' },
    { url: 'https://tracker.makemake.sw:6969/announce', status: 'Sacred Oracle [Synced]', seeds: 38, peers: 54, downloaded: 1240, nextAnnounce: '11m 05s' },
    { url: 'udp://explodie.org:6969/announce', status: 'Working [200 OK]', seeds: 29, peers: 60, downloaded: 2014, nextAnnounce: '27m 50s' },
  ];

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
            { id: 'files' as DetailTab, label: `Files (${torrent.files.length})`, icon: FileCode },
            { id: 'pieces' as DetailTab, label: 'Piece Matrix', icon: Grid },
            { id: 'trackers' as DetailTab, label: 'Oracles / Trackers (4)', icon: Radio },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
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
                  <span className="text-slate-400">CONNECTED SEEDS:</span>
                  <span className="text-slate-200 font-bold">{torrent.seedsConnected} of {torrent.seedsTotal}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">CONNECTED PEERS:</span>
                  <span className="text-slate-200 font-bold">{torrent.peersConnected} of {torrent.peersTotal}</span>
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

        {/* TAB 3: WAYFINDING PEERS */}
        {activeTab === 'peers' && (
          <div className="rounded border border-slate-800 overflow-hidden">
            <table className="w-full text-left divide-y divide-slate-800 text-[11px]">
              <thead className="bg-obsidian-900 text-slate-400 font-bold">
                <tr>
                  <th className="px-3 py-2">NODE IP / PORT</th>
                  <th className="px-3 py-2">REGION</th>
                  <th className="px-3 py-2">CLIENT ENGINE</th>
                  <th className="px-3 py-2">HOPU STATUS</th>
                  <th className="px-3 py-2">DL SPEED</th>
                  <th className="px-3 py-2">UL SPEED</th>
                  <th className="px-3 py-2">PROGRESS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-obsidian-950/80">
                {mockPeers.map((peer, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-mono text-cyber-cyan font-bold">{peer.ip}:{peer.port}</td>
                    <td className="px-3 py-2 text-cyber-gold font-bold">{peer.country}</td>
                    <td className="px-3 py-2 text-slate-300">{peer.client}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        peer.hopu.includes('SEED')
                          ? 'bg-cyber-green/20 text-cyber-green'
                          : peer.hopu.includes('DIVING')
                          ? 'bg-cyber-cyan/20 text-cyber-cyan'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {peer.hopu}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-cyber-cyan">{formatSpeed(peer.dl)}</td>
                    <td className="px-3 py-2 text-cyber-red">{formatSpeed(peer.ul)}</td>
                    <td className="px-3 py-2 w-32">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div className="h-full bg-cyber-cyan" style={{ width: `${peer.progress}%` }} />
                        </div>
                        <span className="text-[10px]">{peer.progress}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: FILES */}
        {activeTab === 'files' && (
          <div className="rounded border border-slate-800 overflow-hidden">
            <table className="w-full text-left divide-y divide-slate-800 text-[11px]">
              <thead className="bg-obsidian-900 text-slate-400 font-bold">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">FILE PATH</th>
                  <th className="px-3 py-2">TOTAL SIZE</th>
                  <th className="px-3 py-2">PROGRESS</th>
                  <th className="px-3 py-2">PRIORITY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-obsidian-950/80">
                {torrent.files.map((file: TorrentFileItem) => (
                  <tr key={file.index} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-500">{file.index + 1}</td>
                    <td className="px-3 py-2 font-mono text-slate-200">{file.path || file.name}</td>
                    <td className="px-3 py-2 text-slate-400">{formatBytes(file.length)}</td>
                    <td className="px-3 py-2 w-48">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-cyber-cyan"
                            style={{ width: `${torrent.progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-cyber-cyan">{torrent.progress.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-cyber-cyan border border-slate-700 text-[10px] font-bold">
                        NORMAL
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  <th className="px-3 py-2">STATUS</th>
                  <th className="px-3 py-2">SEEDS</th>
                  <th className="px-3 py-2">PEERS</th>
                  <th className="px-3 py-2">DOWNLOADS</th>
                  <th className="px-3 py-2">NEXT COMMUNION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-obsidian-950/80">
                {mockTrackers.map((tracker, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-mono text-cyber-cyan font-bold">{tracker.url}</td>
                    <td className="px-3 py-2 text-cyber-green font-bold">{tracker.status}</td>
                    <td className="px-3 py-2 text-slate-200">{tracker.seeds}</td>
                    <td className="px-3 py-2 text-slate-200">{tracker.peers}</td>
                    <td className="px-3 py-2 text-slate-400">{tracker.downloaded}</td>
                    <td className="px-3 py-2 text-cyber-gold">{tracker.nextAnnounce}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
