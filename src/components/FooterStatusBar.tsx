import React from 'react';
import {
  Radio,
  HardDrive,
  ShieldCheck,
  Volume2,
  VolumeX,
  Sliders,
  PanelBottomOpen,
  PanelBottomClose,
  LayoutGrid,
  List,
  Film,
  Turtle,
  Lock,
  Layers,
} from 'lucide-react';
import { ClientSettings, SystemStats } from '../types/torrent';

interface FooterStatusBarProps {
  stats: SystemStats;
  soundEnabled: boolean;
  onToggleSound: () => void;
  bgVideoEnabled: boolean;
  onToggleBgVideo: () => void;
  isDrawerOpen: boolean;
  onToggleDrawer: () => void;
  viewMode: 'cards' | 'table';
  onChangeViewMode: (mode: 'cards' | 'table') => void;
  backupIntervalHours: number;
  settings: ClientSettings;
  onToggleTurtle: () => void;
}

export const FooterStatusBar: React.FC<FooterStatusBarProps> = ({
  stats,
  soundEnabled,
  onToggleSound,
  bgVideoEnabled,
  onToggleBgVideo,
  isDrawerOpen,
  onToggleDrawer,
  viewMode,
  onChangeViewMode,
  backupIntervalHours,
  settings,
  onToggleTurtle,
}) => {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const backupLabel = !settings.autoBackupEnabled
    ? 'DISABLED'
    : backupIntervalHours === 0
    ? 'LIVE · 10M REFRESH'
    : `LIVE · ${backupIntervalHours}H REFRESH`;

  // Durable checkpoint timestamp coming from the Rust engine (session seal).
  const checkpointLabel = React.useMemo(() => {
    if (!stats.checkpointAt) return 'PENDING';
    const stamp = new Date(stats.checkpointAt);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;
  }, [stats.checkpointAt]);

  const formatLimit = (bytesPerSec: number) =>
    bytesPerSec > 0 ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s` : '∞';

  const [limitDown, limitUp] = settings.turtleModeEnabled
    ? [settings.turtleDownloadSpeed, settings.turtleUploadSpeed]
    : [settings.maxDownloadSpeed, settings.maxUploadSpeed];

  return (
    <footer className="h-8 px-4 border-t border-slate-800 bg-obsidian-950 flex items-center justify-between text-[11px] font-mono text-slate-400 select-none z-30">
      {/* Left Telemetry Cluster */}
      <div className="flex items-center space-x-4">
        {/* DHT Status */}
        <div className="flex items-center space-x-1.5 text-cyber-cyan">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>DHT: <strong>{stats.dhtNodes.toLocaleString()}</strong> NODES</span>
        </div>

        <div className="h-3.5 w-[1px] bg-slate-800" />

        {/* Temporal Backup Engine Pulse */}
        <div className="flex items-center space-x-1.5 text-cyber-gold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>VAULT ARCHIVE: <strong>{backupLabel}</strong></span>
        </div>

        <div className="h-3.5 w-[1px] bg-slate-800 hidden sm:block" />

        {/* Crash-safe session checkpoint */}
        <div
          className="hidden md:flex items-center space-x-1.5 text-cyber-green"
          title="Every swarm is paused and its resume data flushed on exit. This is the timestamp of the last durable checkpoint."
        >
          <Lock className="w-3.5 h-3.5" />
          <span>
            STATE SEALED: <strong>{checkpointLabel}</strong>
          </span>
        </div>

        <div className="h-3.5 w-[1px] bg-slate-800 hidden lg:block" />

        {/* Swarm census */}
        <div className="hidden lg:flex items-center space-x-1.5 text-slate-400">
          <Layers className="w-3.5 h-3.5" />
          <span>
            SWARMS: <strong className="text-cyber-cyan">{stats.activeTorrents}</strong> LIVE /{' '}
            <strong className="text-slate-200">{stats.pausedTorrents}</strong> DORMANT /{' '}
            <strong className="text-cyber-green">{stats.completedTorrents}</strong> VERIFIED
          </span>
        </div>

        <div className="h-3.5 w-[1px] bg-slate-800 hidden lg:block" />

        {/* All-time data */}
        <div className="hidden sm:flex items-center space-x-1.5 text-slate-400">
          <HardDrive className="w-3.5 h-3.5" />
          <span>SESSION INGESTED: <strong className="text-slate-200">{formatBytes(stats.totalDownloadedAllTime)}</strong></span>
        </div>
      </div>

      {/* Right Controls Cluster */}
      <div className="flex items-center space-x-3">
        {/* View Mode Toggle */}
        <div className="flex items-center bg-obsidian-900 rounded border border-slate-800 p-0.5">
          <button
            onClick={() => onChangeViewMode('cards')}
            className={`p-1 rounded ${viewMode === 'cards' ? 'bg-cyber-cyan text-black' : 'text-slate-400 hover:text-white'}`}
            title="Cyber Monolith Card View"
          >
            <LayoutGrid className="w-3 h-3" />
          </button>
          <button
            onClick={() => onChangeViewMode('table')}
            className={`p-1 rounded ${viewMode === 'table' ? 'bg-cyber-cyan text-black' : 'text-slate-400 hover:text-white'}`}
            title="Compact High-Density Table View"
          >
            <List className="w-3 h-3" />
          </button>
        </div>

        {/* Audio Mute/Unmute Haptics */}
        <button
          onClick={onToggleSound}
          className="p-1 rounded text-slate-400 hover:text-cyber-cyan hover:bg-obsidian-900 transition-colors"
          title={soundEnabled ? 'Mute Cyber Audio Haptics' : 'Enable Cyber Audio Haptics'}
        >
          {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-cyber-cyan" /> : <VolumeX className="w-3.5 h-3.5 text-slate-500" />}
        </button>

        {/* Ambient Canvas Video Background Toggle */}
        <button
          onClick={onToggleBgVideo}
          className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
            bgVideoEnabled
              ? 'text-cyber-cyan bg-obsidian-900 border border-cyber-cyan/40 shadow-glow-cyan'
              : 'text-slate-500 bg-obsidian-900/50 border border-slate-800'
          }`}
          title={bgVideoEnabled ? 'Disable Ambient Moai Canvas Video' : 'Enable Ambient Moai Canvas Video'}
        >
          <Film className="w-3 h-3" />
          <span className="hidden md:inline font-cyber text-[9px]">{bgVideoEnabled ? 'VIDEO: ON' : 'VIDEO: OFF'}</span>
        </button>

        {/* Global Limits Indicator + Turtle Throttle Toggle */}
        <button
          onClick={onToggleTurtle}
          className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
            settings.turtleModeEnabled
              ? 'text-cyber-amber border-cyber-amber/50 bg-cyber-amber/10'
              : 'text-slate-500 border-slate-800 bg-obsidian-900/50 hover:text-cyber-cyan'
          }`}
          title={
            settings.turtleModeEnabled
              ? 'Turtle throttle active — click for full speed'
              : 'Engage turtle throttle (alternate bandwidth limits)'
          }
        >
          <Turtle className="w-3 h-3" />
          <span className="flex items-center space-x-1">
            <Sliders className="w-3 h-3" />
            <span>
              {formatLimit(limitDown)} / {formatLimit(limitUp)}
            </span>
          </span>
        </button>

        <div className="h-3.5 w-[1px] bg-slate-800" />

        {/* Details Drawer Toggle */}
        <button
          onClick={onToggleDrawer}
          className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
            isDrawerOpen
              ? 'bg-cyber-cyan text-black shadow-glow-cyan'
              : 'bg-obsidian-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          {isDrawerOpen ? <PanelBottomClose className="w-3 h-3" /> : <PanelBottomOpen className="w-3 h-3" />}
          <span>AHU INSPECTOR</span>
        </button>
      </div>
    </footer>
  );
};
