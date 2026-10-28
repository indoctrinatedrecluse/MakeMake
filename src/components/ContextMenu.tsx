import React, { useEffect, useRef, useState } from 'react';
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
  ChevronRight,
  Save,
  ListChecks,
  ExternalLink,
  Check,
} from 'lucide-react';
import { TorrentItem } from '../types/torrent';

export type TorrentPriority = TorrentItem['priority'];

interface ContextMenuProps {
  x: number;
  y: number;
  torrent: TorrentItem;
  onClose: () => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onRecheck: (id: string) => void;
  onOpenFolder: (path: string) => void;
  onRevealPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onCopy: (text: string, label: string) => void;
  onSetPriority: (id: string, priority: TorrentPriority) => void;
  onBackupNow: (id: string) => void;
  onExportTorrent: (torrent: TorrentItem) => void;
  onEditFiles: (torrent: TorrentItem) => void;
  onRemovePrompt: (torrent: TorrentItem) => void;
  onDeleteFilesPrompt: (torrent: TorrentItem) => void;
}

const itemClass =
  'w-full px-3 py-1.5 text-left hover:bg-cyber-cyan/20 hover:text-cyber-cyan flex items-center space-x-2.5 transition-colors';

const priorities: TorrentPriority[] = ['High', 'Normal', 'Low'];

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  torrent,
  onClose,
  onStart,
  onPause,
  onRecheck,
  onOpenFolder,
  onRevealPath,
  onOpenPath,
  onCopy,
  onSetPriority,
  onBackupNow,
  onExportTorrent,
  onEditFiles,
  onRemovePrompt,
  onDeleteFilesPrompt,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [submenu, setSubmenu] = useState<'priority' | null>(null);

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

  const menuWidth = 264;
  const menuHeight = 470;
  const adjustedX = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const adjustedY = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));

  const magnet = torrent.magnetUri || `magnet:?xt=urn:btih:${torrent.infoHash}`;
  const isPaused = torrent.status === 'Paused';
  const singleFile = torrent.files.length === 1 ? torrent.files[0] : null;
  const dataPath = singleFile
    ? `${torrent.downloadDir}/${singleFile.path || singleFile.name}`
    : `${torrent.downloadDir}/${torrent.name}`;

  return (
    <div
      ref={menuRef}
      style={{ left: adjustedX, top: adjustedY, width: menuWidth }}
      className="fixed z-50 py-1.5 rounded-lg bg-obsidian-900/97 border border-cyber-cyan/40 shadow-2xl backdrop-blur-md text-[11px] font-mono text-slate-200 select-none animate-fadeIn"
    >
      {/* Torrent Title Header */}
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between gap-2">
        <span className="truncate text-cyber-cyan font-bold" title={torrent.name}>
          {torrent.name}
        </span>
        <span className="text-cyber-gold font-bold flex-shrink-0">
          [{torrent.progress.toFixed(0)}%]
        </span>
      </div>
      <div className="px-3 py-1 text-[10px] text-slate-500 flex items-center justify-between border-b border-slate-800/70">
        <span className="truncate">{torrent.status}</span>
        <span>{torrent.priority} priority</span>
      </div>

      {/* Transfer Controls */}
      {isPaused ? (
        <button
          className={itemClass}
          onClick={() => {
            onStart(torrent.id);
            onClose();
          }}
        >
          <Play className="w-3.5 h-3.5 text-cyber-cyan" />
          <span>Awaken Monolith (Resume)</span>
        </button>
      ) : (
        <button
          className={`${itemClass} hover:bg-cyber-red/20 hover:text-cyber-red`}
          onClick={() => {
            onPause(torrent.id);
            onClose();
          }}
        >
          <Pause className="w-3.5 h-3.5 text-cyber-red" />
          <span>Dormant State (Pause)</span>
        </button>
      )}

      <button
        className={itemClass}
        onClick={() => {
          onRecheck(torrent.id);
          onClose();
        }}
      >
        <RotateCcw className="w-3.5 h-3.5 text-cyber-gold" />
        <span>Verify Obsidian Integrity</span>
      </button>

      <div className="my-1 border-t border-slate-800" />

      {/* Storage */}
      <button
        className={itemClass}
        onClick={() => {
          onOpenFolder(torrent.downloadDir);
          onClose();
        }}
      >
        <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
        <span>Open Sacred Chamber (Folder)</span>
      </button>

      <button
        className={itemClass}
        onClick={() => {
          onRevealPath(dataPath);
          onClose();
        }}
      >
        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
        <span>Reveal Payload in Explorer</span>
      </button>

      {singleFile && (
        <button
          className={itemClass}
          onClick={() => {
            onOpenPath(dataPath);
            onClose();
          }}
        >
          <ExternalLink className="w-3.5 h-3.5 text-cyber-cyan" />
          <span>Open Downloaded File</span>
        </button>
      )}

      <button
        className={itemClass}
        onClick={() => {
          onEditFiles(torrent);
          onClose();
        }}
      >
        <ListChecks className="w-3.5 h-3.5 text-cyber-cyan" />
        <span>Select Payload Files…</span>
      </button>

      <div className="my-1 border-t border-slate-800" />

      {/* Copy cluster */}
      <button
        className={itemClass}
        onClick={() => {
          onCopy(torrent.infoHash, 'Info hash');
          onClose();
        }}
      >
        <Hash className="w-3.5 h-3.5 text-slate-400" />
        <span>Copy Info Hash</span>
      </button>

      <button
        className={itemClass}
        onClick={() => {
          onCopy(magnet, 'Magnet link');
          onClose();
        }}
      >
        <Copy className="w-3.5 h-3.5 text-slate-400" />
        <span>Copy Magnet Link</span>
      </button>

      <button
        className={itemClass}
        onClick={() => {
          onCopy(torrent.downloadDir, 'Download path');
          onClose();
        }}
      >
        <Copy className="w-3.5 h-3.5 text-slate-400" />
        <span>Copy Download Path</span>
      </button>

      <div className="my-1 border-t border-slate-800" />

      {/* Priority submenu */}
      <div className="relative">
        <button
          className={`${itemClass} justify-between`}
          onMouseEnter={() => setSubmenu('priority')}
          onClick={() => setSubmenu(submenu === 'priority' ? null : 'priority')}
        >
          <span className="flex items-center space-x-2.5">
            <Gauge className="w-3.5 h-3.5 text-cyber-gold" />
            <span>Swarm Priority</span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
        </button>

        {submenu === 'priority' && (
          <div
            className="absolute left-[calc(100%+2px)] top-0 w-40 py-1 rounded-lg bg-obsidian-900/98 border border-cyber-gold/40 shadow-2xl backdrop-blur-md"
            onMouseLeave={() => setSubmenu(null)}
          >
            {priorities.map((priority) => (
              <button
                key={priority}
                className={`${itemClass} justify-between`}
                onClick={() => {
                  onSetPriority(torrent.id, priority);
                  onClose();
                }}
              >
                <span>{priority}</span>
                {torrent.priority === priority && (
                  <Check className="w-3.5 h-3.5 text-cyber-cyan" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Metadata archive */}
      <button
        className={`${itemClass} hover:bg-cyber-gold/20 hover:text-cyber-gold`}
        onClick={() => {
          onBackupNow(torrent.id);
          onClose();
        }}
      >
        <Archive className="w-3.5 h-3.5 text-cyber-gold" />
        <span>Backup .torrent Now</span>
      </button>

      <button
        className={itemClass}
        onClick={() => {
          onExportTorrent(torrent);
          onClose();
        }}
      >
        <Save className="w-3.5 h-3.5 text-slate-400" />
        <span>Save .torrent As…</span>
      </button>

      <div className="my-1 border-t border-slate-800" />

      {/* Destructive actions (each behind a confirmation modal) */}
      <button
        className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white flex items-center space-x-2.5 transition-colors"
        onClick={() => {
          onRemovePrompt(torrent);
          onClose();
        }}
      >
        <Trash2 className="w-3.5 h-3.5 text-slate-400" />
        <span>Remove from Swarm List…</span>
      </button>

      <button
        className="w-full px-3 py-1.5 text-left hover:bg-cyber-red/20 text-cyber-red flex items-center space-x-2.5 transition-colors font-bold"
        onClick={() => {
          onDeleteFilesPrompt(torrent);
          onClose();
        }}
      >
        <FileX className="w-3.5 h-3.5 text-cyber-red animate-pulse" />
        <span>Purge Monolith &amp; Files…</span>
      </button>
    </div>
  );
};

