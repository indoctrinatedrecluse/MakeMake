import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FolderOpen,
  Copy,
  Archive,
  Trash2,
  FileX,
  Gauge,
  Hash,
} from 'lucide-react';
import { TorrentItem } from '../types/torrent';

interface ContextMenuProps {
  x: number;
  y: number;
  torrent: TorrentItem;
  onClose: () => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onRecheck: (id: string) => void;
  onOpenFolder: (path: string) => void;
  onBackupNow: (id: string) => void;
  onRemovePrompt: (torrent: TorrentItem) => void;
  onDeleteFilesPrompt: (torrent: TorrentItem) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  torrent,
  onClose,
  onStart,
  onPause,
  onRecheck,
  onOpenFolder,
  onBackupNow,
  onRemovePrompt,
  onDeleteFilesPrompt,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust positioning to stay within viewport bounds
  const adjustedX = Math.min(x, window.innerWidth - 250);
  const adjustedY = Math.min(y, window.innerHeight - 380);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    onClose();
  };

  const isPaused = torrent.status === 'Paused';

  return (
    <div
      ref={menuRef}
      style={{ left: adjustedX, top: adjustedY }}
      className="fixed z-50 w-60 py-1.5 rounded-lg bg-obsidian-900/95 border border-cyber-cyan/40 shadow-2xl backdrop-blur-md text-xs font-mono text-slate-200 select-none animate-fadeIn"
    >
      {/* Torrent Title Header */}
      <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] text-slate-400 truncate flex items-center justify-between">
        <span className="truncate max-w-[170px] text-cyber-cyan font-bold">{torrent.name}</span>
        <span className="text-cyber-gold font-bold">[{torrent.progress.toFixed(0)}%]</span>
      </div>

      {/* Start / Pause */}
      {isPaused ? (
        <button
          onClick={() => {
            onStart(torrent.id);
            onClose();
          }}
          className="w-full px-3 py-2 text-left hover:bg-cyber-cyan/20 hover:text-cyber-cyan flex items-center space-x-2.5 transition-colors"
        >
          <Play className="w-3.5 h-3.5 text-cyber-cyan" />
          <span>Awaken Monolith (Resume)</span>
        </button>
      ) : (
        <button
          onClick={() => {
            onPause(torrent.id);
            onClose();
          }}
          className="w-full px-3 py-2 text-left hover:bg-cyber-red/20 hover:text-cyber-red flex items-center space-x-2.5 transition-colors"
        >
          <Pause className="w-3.5 h-3.5 text-cyber-red" />
          <span>Dormant State (Pause)</span>
        </button>
      )}

      {/* Force Recheck */}
      <button
        onClick={() => {
          onRecheck(torrent.id);
          onClose();
        }}
        className="w-full px-3 py-2 text-left hover:bg-cyber-cyan/20 hover:text-cyber-cyan flex items-center space-x-2.5 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5 text-cyber-gold" />
        <span>Verify Obsidian Integrity</span>
      </button>

      {/* Open Download Folder */}
      <button
        onClick={() => {
          onOpenFolder(torrent.downloadDir);
          onClose();
        }}
        className="w-full px-3 py-2 text-left hover:bg-cyber-cyan/20 hover:text-cyber-cyan flex items-center space-x-2.5 transition-colors"
      >
        <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
        <span>Open Sacred Chamber (Folder)</span>
      </button>

      <div className="my-1 border-t border-slate-800" />

      {/* Copy Magnet Link */}
      <button
        onClick={() => copyToClipboard(torrent.magnetUri || `magnet:?xt=urn:btih:${torrent.infoHash}`)}
        className="w-full px-3 py-2 text-left hover:bg-cyber-cyan/20 hover:text-cyber-cyan flex items-center space-x-2.5 transition-colors"
      >
        <Copy className="w-3.5 h-3.5 text-slate-400" />
        <span>Copy Magnet Link</span>
      </button>

      {/* Copy Info Hash */}
      <button
        onClick={() => copyToClipboard(torrent.infoHash)}
        className="w-full px-3 py-2 text-left hover:bg-cyber-cyan/20 hover:text-cyber-cyan flex items-center space-x-2.5 transition-colors"
      >
        <Hash className="w-3.5 h-3.5 text-slate-400" />
        <span>Copy Info Hash</span>
      </button>

      {/* Backup .torrent Now */}
      <button
        onClick={() => {
          onBackupNow(torrent.id);
          onClose();
        }}
        className="w-full px-3 py-2 text-left hover:bg-cyber-gold/20 hover:text-cyber-gold flex items-center space-x-2.5 transition-colors"
      >
        <Archive className="w-3.5 h-3.5 text-cyber-gold" />
        <span>Backup .torrent Now</span>
      </button>

      {/* Bandwidth Priority */}
      <div className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center space-x-1.5">
          <Gauge className="w-3.5 h-3.5" />
          <span>Priority</span>
        </span>
        <span className="text-cyber-cyan font-bold">{torrent.priority}</span>
      </div>

      <div className="my-1 border-t border-slate-800" />

      {/* Remove from list (Confirmed via modal) */}
      <button
        onClick={() => {
          onRemovePrompt(torrent);
          onClose();
        }}
        className="w-full px-3 py-2 text-left hover:bg-slate-800 text-slate-300 hover:text-white flex items-center space-x-2.5 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5 text-slate-400" />
        <span>Remove from Swarm List...</span>
      </button>

      {/* Delete torrent AND local files (Confirmed via high-voltage modal) */}
      <button
        onClick={() => {
          onDeleteFilesPrompt(torrent);
          onClose();
        }}
        className="w-full px-3 py-2 text-left hover:bg-cyber-red/20 text-cyber-red flex items-center space-x-2.5 transition-colors font-bold"
      >
        <FileX className="w-3.5 h-3.5 text-cyber-red animate-pulse" />
        <span>Purge Monolith & Files...</span>
      </button>
    </div>
  );
};
