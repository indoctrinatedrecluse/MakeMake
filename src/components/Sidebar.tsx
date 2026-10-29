import React from 'react';
import {
  Layers,
  ArrowDownCircle,
  CheckCircle2,
  PauseCircle,
  Archive,
  Compass,
} from 'lucide-react';
import { SwarmAstrolabe } from './gizmos/SwarmAstrolabe';
import { RongorongoConsole } from './gizmos/RongorongoConsole';
import { SystemStats, TorrentItem } from '../types/torrent';

export type TorrentFilter = 'all' | 'active' | 'completed' | 'paused' | 'backedUp';

interface SidebarProps {
  currentFilter: TorrentFilter;
  onSelectFilter: (filter: TorrentFilter) => void;
  counts: {
    all: number;
    active: number;
    completed: number;
    paused: number;
    backedUp: number;
  };
  selectedTorrentName?: string;
  activePeers?: number;
  torrents?: TorrentItem[];
  stats?: SystemStats;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentFilter,
  onSelectFilter,
  counts,
  selectedTorrentName,
  activePeers = 0,
  torrents = [],
  stats,
}) => {
  const navItems = [
    { id: 'all' as TorrentFilter, label: 'All Monoliths', icon: Layers, count: counts.all, color: 'text-cyber-cyan' },
    { id: 'active' as TorrentFilter, label: 'Active Swarms', icon: ArrowDownCircle, count: counts.active, color: 'text-cyber-cyan' },
    { id: 'completed' as TorrentFilter, label: 'Completed (Seeding)', icon: CheckCircle2, count: counts.completed, color: 'text-cyber-green' },
    { id: 'paused' as TorrentFilter, label: 'Dormant (Paused)', icon: PauseCircle, count: counts.paused, color: 'text-slate-400' },
    { id: 'backedUp' as TorrentFilter, label: 'Archived Backups', icon: Archive, count: counts.backedUp, color: 'text-cyber-gold' },
  ];

  return (
    <aside className="w-80 border-r border-slate-800/80 bg-obsidian-950 flex flex-col justify-between p-3 select-none overflow-y-auto">
      {/* Top Filter Navigation */}
      <div className="space-y-4">
        <div>
          <div className="px-2 py-1 text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
            <span>SWARM REGISTRY</span>
            <span className="text-cyber-cyan">RAPA NUI</span>
          </div>

          <div className="mt-1 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentFilter === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectFilter(item.id)}
                  className={`w-full px-3 py-2 rounded-lg flex items-center justify-between text-xs font-mono transition-all ${
                    isActive
                      ? 'bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/40 shadow-glow-cyan/20 font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-obsidian-900/60'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-cyber-cyan' : item.color}`} />
                    <span>{item.label}</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      isActive ? 'bg-cyber-cyan text-black' : 'bg-obsidian-900 text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Swarm Astrolabe Radar Gizmo (real per-swarm telemetry) */}
        <div>
          <SwarmAstrolabe
            activeTorrentName={selectedTorrentName}
            activePeers={activePeers}
            torrents={torrents}
            stats={stats}
          />
        </div>
      </div>

      {/* Bottom Rongorongo Event Console */}
      <div className="mt-4 pt-3 border-t border-slate-800/80">
        <RongorongoConsole
          torrents={torrents}
          stats={
            stats ?? {
              globalDownloadSpeed: 0,
              globalUploadSpeed: 0,
              totalActivePeers: activePeers,
              dhtNodes: 0,
              totalTorrents: torrents.length,
              activeTorrents: 0,
              pausedTorrents: 0,
              completedTorrents: 0,
              totalDownloadedAllTime: 0,
              restoredTorrents: 0,
              resumedTorrents: 0,
              checkpointAt: 0,
            }
          }
        />
        <div className="mt-2 px-1 text-[9px] font-mono text-slate-500 flex items-center justify-between">
          <span>MOTU NUI / 27°07′S</span>
          <span className="flex items-center gap-1 text-cyber-cyan">
            <Compass className="w-3 h-3" />
            <span>PEERS: {activePeers}</span>
          </span>
        </div>
      </div>
    </aside>
  );
};
