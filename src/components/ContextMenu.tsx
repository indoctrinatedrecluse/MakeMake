import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  ChevronDown,
  Save,
  ListChecks,
  ExternalLink,
  Check,
  Link2,
  ClipboardList,
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

const MENU_WIDTH = 264;
const VIEWPORT_MARGIN = 8;

const itemClass =
  'w-full px-3 py-1.5 text-left hover:bg-cyber-cyan/20 hover:text-cyber-cyan focus:bg-cyber-cyan/20 focus:text-cyber-cyan focus:outline-none flex items-center space-x-2.5 transition-colors';

const priorities: TorrentPriority[] = ['High', 'Normal', 'Low'];

/** Small caps heading that groups related actions. */
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-3 pt-2 pb-1 text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">
    {children}
  </div>
);

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
  const [submenu, setSubmenu] = useState<'priority' | 'copy' | null>(null);
  /** Measured placement: the menu is tall and the viewport can be short. */
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  // Close on: outside click, Escape, scroll (the anchor row would move away), resize or when
  // the window loses focus.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleDismiss = () => onClose();
    // Scrolling the page (or the torrent list) moves the anchor row away from the menu, so the
    // menu closes — but scrolling the menu's own list must not close it.
    const handleScroll = (e: Event) => {
      const target = e.target;
      if (menuRef.current && target instanceof Node && menuRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('blur', handleDismiss);
    // `capture` so a scroll inside the torrent list is observed as well.
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('blur', handleDismiss);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Measure the real box instead of assuming a height: a hard-coded value used to push the
  // last entries (the destructive ones) past the bottom of the window.
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN),
    );
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN),
    );
    setPlacement({
      left,
      top,
    });
    // Keyboard users land inside the menu: Escape and the arrows work from here.
    node.focus({ preventScroll: true });
  }, [x, y]);

  /** Move focus through the menu's own buttons (submenus included). */
  const focusItem = useCallback((delta: number) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : items.length - 1
        : (current + delta + items.length) % items.length;
    items[next]?.focus();
  }, []);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(-1);
    }
  };

  const magnet = torrent.magnetUri || `magnet:?xt=urn:btih:${torrent.infoHash}`;
  const isPaused = torrent.status === 'Paused';
  const singleFile = torrent.files.length === 1 ? torrent.files[0] : null;
  // `downloadDir` already *is* the per-torrent folder, so a multi-file payload lives directly
  // inside it (the old `${dir}/${name}` doubled the name).
  const dataPath = singleFile
    ? `${torrent.downloadDir}/${singleFile.path || singleFile.name}`
    : torrent.downloadDir;
  const trackers = torrent.trackers ?? [];

  /** Shared shape for a row that opens a submenu. */
  const submenuRowClass = `${itemClass} justify-between`;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${torrent.name}`}
      tabIndex={-1}
      onKeyDown={handleMenuKeyDown}
      style={{
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        width: MENU_WIDTH,
        // Hidden for the single frame it takes to measure the real height.
        opacity: placement ? 1 : 0,
      }}
      className="fixed z-50 py-1.5 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg bg-obsidian-900/97 border border-cyber-cyan/40 shadow-2xl backdrop-blur-md text-[11px] font-mono text-slate-200 select-none animate-fadeIn focus:outline-none"
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

      <SectionLabel>Transfer</SectionLabel>

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
        title="Re-hash the files on disk; pieces that already match are kept"
      >
        <RotateCcw className="w-3.5 h-3.5 text-cyber-gold" />
        <span>Verify Obsidian Integrity</span>
      </button>

      {/* Priority submenu — expanded inline: a floating panel would be clipped by the
          menu's own scroll box, and an inline list works for mouse *and* keyboard. */}
      <button
        className={submenuRowClass}
        aria-haspopup="menu"
        aria-expanded={submenu === 'priority'}
        onClick={() => setSubmenu(submenu === 'priority' ? null : 'priority')}
      >
        <span className="flex items-center space-x-2.5">
          <Gauge className="w-3.5 h-3.5 text-cyber-teal" />
          <span>Swarm Priority</span>
        </span>
        {submenu === 'priority' ? (
          <ChevronDown className="w-3 h-3 text-slate-500" />
        ) : (
          <ChevronRight className="w-3 h-3 text-slate-500" />
        )}
      </button>

      {submenu === 'priority' && (
        <div role="menu" className="py-0.5 bg-obsidian-950/60 border-y border-slate-800/70">
          {priorities.map((priority) => (
            <button
              key={priority}
              className={`${itemClass} pl-8`}
              onClick={() => {
                onSetPriority(torrent.id, priority);
                onClose();
              }}
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center">
                {torrent.priority === priority ? (
                  <Check className="w-3.5 h-3.5 text-cyber-cyan" />
                ) : null}
              </span>
              <span>{priority}</span>
            </button>
          ))}
        </div>
      )}

      <SectionLabel>Storage</SectionLabel>

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

      <SectionLabel>Payload</SectionLabel>

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

      <button
        className={itemClass}
        onClick={() => {
          onBackupNow(torrent.id);
          onClose();
        }}
      >
        <Archive className="w-3.5 h-3.5 text-cyber-gold" />
        <span>Backup .torrent Now</span>
      </button>

      {/* Copy cluster: one row that expands into the four clipboard actions */}
      <button
        className={submenuRowClass}
        aria-haspopup="menu"
        aria-expanded={submenu === 'copy'}
        onClick={() => setSubmenu(submenu === 'copy' ? null : 'copy')}
      >
        <span className="flex items-center space-x-2.5">
          <Copy className="w-3.5 h-3.5 text-slate-400" />
          <span>Copy to Clipboard</span>
        </span>
        {submenu === 'copy' ? (
          <ChevronDown className="w-3 h-3 text-slate-500" />
        ) : (
          <ChevronRight className="w-3 h-3 text-slate-500" />
        )}
      </button>

      {submenu === 'copy' && (
        <div role="menu" className="py-0.5 bg-obsidian-950/60 border-y border-slate-800/70">
          <button
            className={`${itemClass} pl-8`}
            onClick={() => {
              onCopy(torrent.infoHash, 'Info hash');
              onClose();
            }}
          >
            <Hash className="w-3.5 h-3.5 text-slate-400" />
            <span>Info Hash</span>
          </button>

          <button
            className={`${itemClass} pl-8`}
            onClick={() => {
              onCopy(magnet, 'Magnet link');
              onClose();
            }}
          >
            <Link2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Magnet Link</span>
          </button>

          <button
            className={`${itemClass} pl-8`}
            onClick={() => {
              onCopy(dataPath, 'Download path');
              onClose();
            }}
            >
              <ClipboardList className="w-3.5 h-3.5 text-slate-400" />
              <span>Download Path</span>
            </button>

          {trackers.length > 0 && (
            <button
              className={`${itemClass} pl-8`}
              onClick={() => {
                onCopy(trackers.join('\n'), 'Tracker list');
                onClose();
              }}
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              <span>Tracker URLs ({trackers.length})</span>
            </button>
          )}
        </div>
      )}

      <SectionLabel>Registry</SectionLabel>

      <button
        className={`${itemClass} hover:bg-cyber-red/15 hover:text-cyber-red`}
        onClick={() => {
          onRemovePrompt(torrent);
          onClose();
        }}
      >
        <FileX className="w-3.5 h-3.5 text-cyber-vermilion" />
        <span>Remove from Swarm (Keep Files)</span>
      </button>

      <button
        className={`${itemClass} hover:bg-cyber-red/25 hover:text-cyber-red`}
        onClick={() => {
          onDeleteFilesPrompt(torrent);
          onClose();
        }}
      >
        <Trash2 className="w-3.5 h-3.5 text-cyber-red" />
        <span>Purge Monolith &amp; Files</span>
      </button>
    </div>
  );
};

