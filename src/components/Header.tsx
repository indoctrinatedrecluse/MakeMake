import React from 'react';
import { MakeMakeIcon } from './gizmos/MakeMakeIcon';
import { CalderaDials } from './gizmos/CalderaDials';
import {
  Plus,
  Link,
  Settings as SettingsIcon,
  Sparkles,
  Radio,
  Share2,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { SystemStats } from '../types/torrent';

interface HeaderProps {
  stats: SystemStats;
  onOpenAddModal: (initial?: { type: 'magnet' | 'file'; data: string; name?: string }) => void;
  onOpenSettings: () => void;
  onShowSplash: () => void;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  torrentCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  stats,
  onOpenAddModal,
  onOpenSettings,
  onShowSplash,
  onPauseAll,
  onResumeAll,
  torrentCount = 0,
}) => {
  return (
    <header className="h-16 px-5 border-b border-cyber-cyan/20 bg-obsidian-950/90 backdrop-blur-md flex items-center justify-between select-none z-30">
      {/* Brand & Theme Identity */}
      <div className="flex items-center space-x-3.5">
        <div
          onClick={onShowSplash}
          className="cursor-pointer group flex items-center space-x-2.5 transition-transform hover:scale-105"
          title="Click to view Animated Moai Splash Portal"
        >
          <MakeMakeIcon size={34} color="cyan" glow />
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-base font-black font-cyber tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyber-cyan via-white to-cyber-red drop-shadow-[0_0_10px_rgba(0,240,255,0.6)]">
                MAKEMAKE
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyber-red/20 text-cyber-red border border-cyber-red/40 font-bold">
                v0.1
              </span>
            </div>
            <div className="text-[9px] font-mono text-slate-400 tracking-wider">
              RAPA NUI SWARM ENGINE // AHU-ONLINE
            </div>
          </div>
        </div>

        <div className="h-7 w-[1px] bg-slate-800 hidden md:block" />

        {/* Live Swarm Telemetry Badges */}
        <div className="hidden lg:flex items-center space-x-3 text-xs font-mono">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-obsidian-900 border border-slate-800">
            <Radio className="w-3.5 h-3.5 text-cyber-cyan animate-pulse" />
            <span className="text-slate-400 text-[10px]">DHT NODES:</span>
            <span className="text-cyber-cyan font-bold">{stats.dhtNodes.toLocaleString()}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-obsidian-900 border border-slate-800">
            <Share2 className="w-3.5 h-3.5 text-cyber-gold" />
            <span className="text-slate-400 text-[10px]">ACTIVE PEERS:</span>
            <span className="text-cyber-gold font-bold">{stats.totalActivePeers}</span>
          </div>
        </div>
      </div>

      {/* Center Fluid Bandwidth Caldera Dials */}
      <div className="hidden md:flex items-center">
        <CalderaDials
          downloadSpeed={stats.globalDownloadSpeed}
          uploadSpeed={stats.globalUploadSpeed}
        />
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-2.5">
        {/* Global transfer controls */}
        <div className="hidden sm:flex items-center bg-obsidian-900 rounded border border-slate-800 p-0.5">
          <button
            onClick={onPauseAll}
            disabled={torrentCount === 0}
            className="p-1.5 rounded text-slate-400 hover:text-cyber-red hover:bg-slate-800 disabled:opacity-30 transition-colors"
            title="Pause all torrents"
          >
            <PauseCircle className="w-4 h-4" />
          </button>
          <button
            onClick={onResumeAll}
            disabled={torrentCount === 0}
            className="p-1.5 rounded text-slate-400 hover:text-cyber-green hover:bg-slate-800 disabled:opacity-30 transition-colors"
            title="Resume all torrents"
          >
            <PlayCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Add Magnet Link Quick Trigger */}
        <button
          onClick={() => onOpenAddModal()}
          className="px-3 py-1.5 rounded bg-obsidian-900 border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/20 text-xs font-mono flex items-center space-x-1.5 transition-all shadow-glow-cyan/20"
          title="Add a magnet link"
        >
          <Link className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Magnet</span>
        </button>

        {/* Add .torrent File Button */}
        <button
          onClick={() => onOpenAddModal()}
          className="cyber-button px-4 py-1.5 bg-gradient-to-r from-cyber-cyan to-cyber-teal text-black font-bold font-mono text-xs uppercase tracking-wider flex items-center space-x-1.5 shadow-glow-cyan"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Ingest Swarm</span>
        </button>

        <div className="h-6 w-[1px] bg-slate-800" />

        {/* Replay Splash / Lore */}
        <button
          onClick={onShowSplash}
          className="p-2 rounded bg-obsidian-900 border border-slate-800 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/50 transition-colors"
          title="Replay Moai Splash Scene"
        >
          <Sparkles className="w-4 h-4 text-cyber-gold" />
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded bg-obsidian-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors"
          title="MakeMake Vault & Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
