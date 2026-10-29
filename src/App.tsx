import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { Sidebar, TorrentFilter } from './components/Sidebar';
import { TorrentList } from './components/TorrentList';
import { TorrentDetailsDrawer, DetailTab } from './components/TorrentDetailsDrawer';
import { FooterStatusBar } from './components/FooterStatusBar';
import { ContextMenu } from './components/ContextMenu';
import { ConfirmModal } from './components/ConfirmModal';
import { AddTorrentModal } from './components/AddTorrentModal';
import { SettingsModal } from './components/SettingsModal';
import { SplashScreen } from './components/SplashScreen';
import { TauriBridge } from './api/tauriBridge';
import { TorrentItem, ClientSettings, SystemStats, TorrentMetadataPreview } from './types/torrent';
import { cyberAudio } from './utils/cyberAudio';

export const App: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true);
  const [torrents, setTorrents] = useState<TorrentItem[]>([]);
  const [selectedTorrent, setSelectedTorrent] = useState<TorrentItem | null>(null);
  const [filter, setFilter] = useState<TorrentFilter>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bgVideoEnabled, setBgVideoEnabled] = useState(true);

  const [settings, setSettings] = useState<ClientSettings>({
    defaultDownloadDir: '',
    alwaysAskDownloadDir: true,
    autoBackupEnabled: true,
    backupIntervalHours: 6,
    backupDir: '',
    moveCompletedTorrentEnabled: true,
    completedTorrentDir: '',
    maxDownloadSpeed: 0,
    maxUploadSpeed: 0,
    turtleModeEnabled: false,
    turtleDownloadSpeed: 512 * 1024,
    turtleUploadSpeed: 64 * 1024,
    seedAfterComplete: true,
    listenPort: 6881,
    enableSoundFx: true,
    theme: 'cyber-obsidian',
    resumeOnLaunch: true,
  });

  const [stats, setStats] = useState<SystemStats>({
    globalDownloadSpeed: 0,
    globalUploadSpeed: 0,
    totalActivePeers: 0,
    dhtNodes: 0,
    totalTorrents: 0,
    activeTorrents: 0,
    pausedTorrents: 0,
    completedTorrents: 0,
    totalDownloadedAllTime: 0,
    restoredTorrents: 0,
    resumedTorrents: 0,
    checkpointAt: 0,
  });

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [initialAddPayload, setInitialAddPayload] = useState<{
    type: 'magnet' | 'file';
    data: string;
    name?: string;
  } | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Tab the details drawer should show (context menu can jump straight to Files)
  const [drawerTab, setDrawerTab] = useState<DetailTab>('overview');

  // Lightweight themed toast (replaces browser alert() popups)
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'danger' } | null>(null);
  const showToast = useCallback((message: string, tone: 'info' | 'danger' = 'info') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    torrent: TorrentItem;
  } | null>(null);

  // Irreversible Action Confirm Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    targetName: string;
    targetPath?: string;
    isDestructive: boolean;
    confirmLabel: string;
    action: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    targetName: '',
    isDestructive: true,
    confirmLabel: 'CONFIRM',
    action: () => {},
  });

  // Sync state from Tauri backend / dev engine
  const restoreAnnouncedRef = useRef(false);
  // Which torrent the drawer shows. Kept in a ref so the poll never depends on the
  // selection: that dependency used to re-create the polling effect on every tick, which
  // turned the 1 s interval into an unbounded loop of IPC calls.
  const selectedIdRef = useRef<string | null>(null);
  // Is anything actually moving? Drives the adaptive poll interval.
  const busyRef = useRef(false);

  const refreshData = useCallback(async () => {
    try {
      const snapshot = await TauriBridge.getSnapshot();
      setTorrents(snapshot.torrents);
      setStats(snapshot.stats);

      busyRef.current = snapshot.torrents.some(
        (t) =>
          t.resolving === true ||
          t.status === 'Downloading' ||
          t.status === 'Checking' ||
          t.status === 'Queued',
      );

      // Announce a recovered session exactly once per launch.
      if (!restoreAnnouncedRef.current && snapshot.stats.restoredTorrents > 0) {
        restoreAnnouncedRef.current = true;
        const resumed = snapshot.stats.resumedTorrents;
        showToast(
          resumed > 0
            ? `Session recovered: ${snapshot.stats.restoredTorrents} swarm${snapshot.stats.restoredTorrents === 1 ? '' : 's'} restored · ${resumed} re-armed`
            : `Session recovered: ${snapshot.stats.restoredTorrents} swarm${snapshot.stats.restoredTorrents === 1 ? '' : 's'} restored in dormant state (auto-resume off)`,
        );
      }
    } catch (e) {
      console.warn('Error refreshing MakeMake state', e);
    }
  }, [showToast]);

  // Keep the open drawer pointing at the freshest copy of the selected torrent.
  useEffect(() => {
    const selectedId = selectedIdRef.current;
    if (!selectedId) {
      if (torrents.length > 0) {
        selectedIdRef.current = torrents[0].id;
        setSelectedTorrent(torrents[0]);
      }
      return;
    }

    const updated = torrents.find((t) => t.id === selectedId);
    if (updated) {
      setSelectedTorrent(updated);
    } else {
      selectedIdRef.current = null;
      setSelectedTorrent(null);
    }
  }, [torrents]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    TauriBridge.getSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setSoundEnabled(s.enableSoundFx);
        cyberAudio.enabled = s.enableSoundFx;
      })
      .catch(console.warn);

    // Adaptive poll: once a second while something is transferring or resolving, every
    // three seconds when the queue is idle, and barely at all while the window is hidden.
    const tick = async () => {
      if (cancelled) return;
      const hidden = document.visibilityState === 'hidden';
      if (!hidden) {
        await refreshData();
      }
      if (cancelled) return;
      timer = window.setTimeout(tick, hidden ? 5000 : busyRef.current ? 1000 : 3000);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refreshData]);

  // Handle Drag and Drop for .torrent files
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => e.preventDefault();
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.toLowerCase().endsWith('.torrent')) {
        return;
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
        };
        reader.onerror = () => reject(new Error(`Cannot read ${file.name}`));
        reader.readAsDataURL(file);
      }).catch((err: unknown) => {
        console.error('Failed to read dropped torrent file', err);
        return '';
      });

      if (!base64) return;

      setInitialAddPayload({
        type: 'file',
        data: base64,
        name: file.name,
      });
      setIsAddModalOpen(true);
      cyberAudio.playEngage();
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // Keyboard Shortcuts (Space to play/pause, I to toggle drawer)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === ' ' && selectedTorrent) {
        e.preventDefault();
        cyberAudio.playClick();
        if (selectedTorrent.status === 'Paused') {
          handleStart(selectedTorrent.id);
        } else {
          handlePause(selectedTorrent.id);
        }
      } else if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey) {
        setIsDrawerOpen((prev) => !prev);
        cyberAudio.playClick();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'v' || e.key === 'V') &&
        !isAddModalOpen &&
        !isSettingsOpen
      ) {
        // Paste a magnet link straight from the system clipboard.
        navigator.clipboard
          .readText()
          .then((text) => {
            const trimmed = text.trim();
            if (trimmed.startsWith('magnet:?')) {
              cyberAudio.playEngage();
              setInitialAddPayload({ type: 'magnet', data: trimmed });
              setIsAddModalOpen(true);
            }
          })
          .catch(() => {
            /* clipboard read not permitted — user can paste into the modal */
          });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTorrent, isAddModalOpen, isSettingsOpen]);

  // Operation Handlers
  const handleStart = async (id: string) => {
    cyberAudio.playClick();
    try {
      await TauriBridge.startTorrent(id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handlePause = async (id: string) => {
    cyberAudio.playClick();
    try {
      await TauriBridge.pauseTorrent(id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handleRecheck = async (id: string) => {
    cyberAudio.playClick();
    try {
      await TauriBridge.forceRecheck(id);
      showToast('Integrity verification started');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handleOpenFolder = async (path: string) => {
    cyberAudio.playClick();
    await TauriBridge.openFolder(path);
  };

  const handleBackupNow = async (id: string) => {
    cyberAudio.playClick();
    try {
      const res = await TauriBridge.backupTorrentNow(id);
      showToast(`Torrent archived to ${res.path}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handlePauseAll = async () => {
    cyberAudio.playHazard();
    try {
      await TauriBridge.pauseAll();
      showToast('All monoliths placed in dormant state');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handleResumeAll = async () => {
    cyberAudio.playEngage();
    try {
      await TauriBridge.resumeAll();
      showToast('All monoliths re-awakened');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handleSetPriority = async (id: string, priority: TorrentItem['priority']) => {
    cyberAudio.playClick();
    try {
      await TauriBridge.setPriority(id, priority);
      showToast(`Priority set to ${priority}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handleExportTorrent = async (torrent: TorrentItem) => {
    cyberAudio.playClick();
    try {
      const target = await TauriBridge.chooseSaveTorrentPath(`${torrent.name}.torrent`);
      if (!target) return;
      const res = await TauriBridge.exportTorrent(torrent.id, target);
      showToast(`.torrent metadata saved to ${res.path}`);
      refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
  };

  const handleCopy = async (text: string, label: string) => {
    cyberAudio.playClick();
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard`);
    } catch {
      showToast(`Cannot access the clipboard`, 'danger');
    }
  };

  const handleRevealPath = async (path: string) => {
    try {
      await TauriBridge.revealPath(path);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
  };

  const handleOpenPath = async (path: string) => {
    try {
      await TauriBridge.openPath(path);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
  };

  const handleEditFiles = (torrent: TorrentItem) => {
    cyberAudio.playClick();
    selectedIdRef.current = torrent.id;
    setSelectedTorrent(torrent);
    setDrawerTab('files');
    setIsDrawerOpen(true);
  };

  const handleApplyFileSelection = async (id: string, files: number[]) => {
    try {
      await TauriBridge.setFileSelection(id, files);
      showToast(`Payload selection updated (${files.length} file${files.length === 1 ? '' : 's'})`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handleToggleTurtle = async () => {
    cyberAudio.playClick();
    try {
      const updated = await TauriBridge.setTurtleMode(!settings.turtleModeEnabled);
      setSettings(updated);
      showToast(updated.turtleModeEnabled ? 'Turtle throttle engaged' : 'Full-speed throttle engaged');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
  };

  // Safe removal prompt (removes from list only)
  const handleRemovePrompt = (torrent: TorrentItem) => {
    cyberAudio.playHazard();
    setConfirmModal({
      isOpen: true,
      title: 'DEREGISTER SWARM MONOLITH',
      message:
        'Are you sure you want to remove this data monolith from the active client registry? Downloaded local payload files on disk will NOT be erased.',
      targetName: torrent.name,
      targetPath: torrent.downloadDir,
      isDestructive: false,
      confirmLabel: 'REMOVE FROM REGISTRY',
      action: async () => {
        cyberAudio.playClick();
        await TauriBridge.deleteTorrent(torrent.id, false);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        refreshData();
      },
    });
  };

  // High-voltage destructive prompt (erases torrent + disk payload)
  const handleDeleteFilesPrompt = (torrent: TorrentItem) => {
    cyberAudio.playHazard();
    setConfirmModal({
      isOpen: true,
      title: 'PURGE MONOLITH & DESTROY DISK FILES',
      message:
        'CRITICAL WARNING: This will permanently eradicate the torrent from the client AND delete all downloaded files from your physical disk. This action is irreversible!',
      targetName: torrent.name,
      targetPath: `${torrent.downloadDir}/${torrent.name}`,
      isDestructive: true,
      confirmLabel: 'PURGE & DELETE ALL FILES',
      action: async () => {
        cyberAudio.playHazard();
        await TauriBridge.deleteTorrent(torrent.id, true);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        refreshData();
      },
    });
  };

  const handleAddConfirm = async (preview: TorrentMetadataPreview, targetDir: string) => {
    cyberAudio.playEngage();
    setIsAddModalOpen(false);
    try {
      const item = await TauriBridge.addTorrent(preview, targetDir);
      selectedIdRef.current = item.id;
      setSelectedTorrent(item);
      setInitialAddPayload(null);
      showToast(
        item.resolving ? `Queued swarm: ${item.name} — resolving metadata…` : `Swarm engaged: ${item.name}`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
    refreshData();
  };

  const handleSaveSettings = async (newSettings: ClientSettings) => {
    cyberAudio.playClick();
    try {
      const updated = await TauriBridge.updateSettings(newSettings);
      setSettings(updated);
      setSoundEnabled(updated.enableSoundFx);
      cyberAudio.enabled = updated.enableSoundFx;
      showToast('Vault configuration committed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'danger');
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    cyberAudio.enabled = next;
    if (next) cyberAudio.playClick();
  };

  const counts = {
    all: torrents.length,
    active: torrents.filter(
      (t) =>
        t.resolving === true || t.status === 'Downloading' || t.status === 'Seeding',
    ).length,
    completed: torrents.filter((t) => t.status === 'Seeding' || t.progress >= 100).length,
    paused: torrents.filter((t) => t.status === 'Paused').length,
    backedUp: torrents.filter((t) => t.backedUp).length,
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-obsidian-950 font-mono text-slate-100 select-none">
      {/* Animated Splash Screen */}
      {showSplash && (
        <SplashScreen
          onDismiss={() => {
            cyberAudio.playEngage();
            setShowSplash(false);
          }}
        />
      )}

      {/* Subtle Ambient Cyber-Moai Looping Canvas Backdrop */}
      {bgVideoEnabled && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover opacity-15"
          >
            <source src="/splash-moai-longer.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950 via-obsidian-950/70 to-obsidian-950/90" />
          <div className="absolute inset-0 scanlines opacity-30" />
        </div>
      )}

      {/* Top Cyber HUD Header */}
      <Header
        stats={stats}
        onOpenAddModal={(initial) => {
          cyberAudio.playClick();
          setInitialAddPayload(initial || null);
          setIsAddModalOpen(true);
        }}
        onOpenSettings={() => {
          cyberAudio.playClick();
          setIsSettingsOpen(true);
        }}
        onShowSplash={() => setShowSplash(true)}
        onPauseAll={handlePauseAll}
        onResumeAll={handleResumeAll}
        torrentCount={torrents.length}
      />

      {/* Main Client Body: Sidebar + Torrent Deck + Details Drawer */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          currentFilter={filter}
          onSelectFilter={(f) => {
            cyberAudio.playClick();
            setFilter(f);
          }}
          counts={counts}
          selectedTorrentName={selectedTorrent?.name}
          activePeers={stats.totalActivePeers}
          torrents={torrents}
          stats={stats}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Torrent List Area */}
          <TorrentList
            torrents={torrents}
            filter={filter}
            viewMode={viewMode}
            selectedTorrent={selectedTorrent}
            onSelectTorrent={(t) => {
              selectedIdRef.current = t.id;
              setSelectedTorrent(t);
            }}
            onContextMenu={(e, t) => {
              e.preventDefault();
              cyberAudio.playClick();
              setContextMenu({ x: e.clientX, y: e.clientY, torrent: t });
            }}
            onStart={handleStart}
            onPause={handlePause}
            onOpenAddModal={() => {
              cyberAudio.playClick();
              setInitialAddPayload(null);
              setIsAddModalOpen(true);
            }}
          />

          {/* VueTorrent-Inspired Ahu Inspector Details Drawer */}
          {selectedTorrent && (
            <TorrentDetailsDrawer
              torrent={selectedTorrent}
              isOpen={isDrawerOpen}
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              onClose={() => setIsDrawerOpen(false)}
              onOpenFolder={handleOpenFolder}
              onRevealPath={handleRevealPath}
              onOpenPath={handleOpenPath}
              onApplyFileSelection={handleApplyFileSelection}
            />
          )}
        </div>
      </div>

      {/* Bottom Status Bar & Quick Toggles */}
      <FooterStatusBar
        stats={stats}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        bgVideoEnabled={bgVideoEnabled}
        onToggleBgVideo={() => {
          cyberAudio.playClick();
          setBgVideoEnabled((prev) => !prev);
        }}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => {
          cyberAudio.playClick();
          setIsDrawerOpen((prev) => !prev);
        }}
        viewMode={viewMode}
        onChangeViewMode={(mode) => {
          cyberAudio.playClick();
          setViewMode(mode);
        }}
        backupIntervalHours={settings.backupIntervalHours}
        settings={settings}
        onToggleTurtle={handleToggleTurtle}
      />

      {/* Floating Right-Click Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          torrent={contextMenu.torrent}
          onClose={() => setContextMenu(null)}
          onStart={handleStart}
          onPause={handlePause}
          onRecheck={handleRecheck}
          onOpenFolder={handleOpenFolder}
          onRevealPath={handleRevealPath}
          onOpenPath={handleOpenPath}
          onCopy={handleCopy}
          onSetPriority={handleSetPriority}
          onBackupNow={handleBackupNow}
          onExportTorrent={handleExportTorrent}
          onEditFiles={handleEditFiles}
          onRemovePrompt={handleRemovePrompt}
          onDeleteFilesPrompt={handleDeleteFilesPrompt}
        />
      )}

      {/* High-Voltage Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        targetName={confirmModal.targetName}
        targetPath={confirmModal.targetPath}
        isDestructive={confirmModal.isDestructive}
        confirmLabel={confirmModal.confirmLabel}
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Torrent Ingestion & Metadata Preview Modal */}
      <AddTorrentModal
        isOpen={isAddModalOpen}
        defaultDownloadDir={settings.defaultDownloadDir}
        alwaysAskDownloadDir={settings.alwaysAskDownloadDir}
        diskFreeBytes={stats.diskFreeBytes}
        initialMagnetOrFile={initialAddPayload}
        onClose={() => setIsAddModalOpen(false)}
        onAddConfirm={handleAddConfirm}
      />

      {/* Settings & Temporal Auto-Backup Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      {/* Themed Toast Notifications */}
      {toast && (
        <div
          className={`fixed bottom-12 right-5 z-[60] max-w-md px-4 py-2.5 rounded-lg border font-mono text-[11px] shadow-2xl backdrop-blur-md animate-fadeIn ${
            toast.tone === 'danger'
              ? 'bg-red-950/90 border-cyber-red/60 text-red-200'
              : 'bg-obsidian-900/95 border-cyber-cyan/50 text-cyber-cyan'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};
