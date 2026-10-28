import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar, TorrentFilter } from './components/Sidebar';
import { TorrentList } from './components/TorrentList';
import { TorrentDetailsDrawer } from './components/TorrentDetailsDrawer';
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
    defaultDownloadDir: 'C:/MakeMake/Downloads',
    autoBackupEnabled: true,
    backupIntervalHours: 6,
    backupDir: 'C:/MakeMake/TorrentBackups',
    moveCompletedTorrentEnabled: true,
    completedTorrentDir: 'C:/MakeMake/CompletedTorrents',
    maxDownloadSpeed: 0,
    maxUploadSpeed: 0,
    listenPort: 6881,
    enableSoundFx: true,
    theme: 'cyber-obsidian',
  });

  const [stats, setStats] = useState<SystemStats>({
    globalDownloadSpeed: 0,
    globalUploadSpeed: 0,
    totalActivePeers: 0,
    dhtNodes: 8492,
    totalTorrents: 0,
    activeTorrents: 0,
    totalDownloadedAllTime: 0,
  });

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [initialAddPayload, setInitialAddPayload] = useState<{
    type: 'magnet' | 'file';
    data: string;
    name?: string;
  } | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
  const refreshData = useCallback(async () => {
    try {
      const [torrentList, sysStats] = await Promise.all([
        TauriBridge.getTorrents(),
        TauriBridge.getSystemStats(),
      ]);
      setTorrents(torrentList);
      setStats(sysStats);

      // Keep selectedTorrent updated with latest piece/speed changes
      if (selectedTorrent) {
        const updated = torrentList.find((t) => t.id === selectedTorrent.id);
        if (updated) setSelectedTorrent(updated);
      } else if (torrentList.length > 0) {
        setSelectedTorrent(torrentList[0]);
      }
    } catch (e) {
      console.warn('Error refreshing MakeMake state', e);
    }
  }, [selectedTorrent]);

  useEffect(() => {
    TauriBridge.getSettings()
      .then((s) => {
        setSettings(s);
        setSoundEnabled(s.enableSoundFx);
        cyberAudio.enabled = s.enableSoundFx;
      })
      .catch(console.warn);

    refreshData();
    const interval = setInterval(refreshData, 1000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // Handle Drag and Drop for .torrent files
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => e.preventDefault();
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.torrent')) {
          setInitialAddPayload({
            type: 'file',
            data: 'dummyBase64',
            name: file.name,
          });
          setIsAddModalOpen(true);
          cyberAudio.playEngage();
        }
      }
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTorrent]);

  // Operation Handlers
  const handleStart = async (id: string) => {
    cyberAudio.playClick();
    await TauriBridge.startTorrent(id);
    refreshData();
  };

  const handlePause = async (id: string) => {
    cyberAudio.playClick();
    await TauriBridge.pauseTorrent(id);
    refreshData();
  };

  const handleRecheck = async (id: string) => {
    cyberAudio.playClick();
    await TauriBridge.forceRecheck(id);
    refreshData();
  };

  const handleOpenFolder = async (path: string) => {
    cyberAudio.playClick();
    await TauriBridge.openFolder(path);
  };

  const handleBackupNow = async (id: string) => {
    cyberAudio.playClick();
    const res = await TauriBridge.backupTorrentNow(id);
    alert(`Torrent successfully archived to:\n${res.path}`);
    refreshData();
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
    await TauriBridge.addTorrent(preview, targetDir);
    setIsAddModalOpen(false);
    refreshData();
  };

  const handleSaveSettings = async (newSettings: ClientSettings) => {
    cyberAudio.playClick();
    const updated = await TauriBridge.updateSettings(newSettings);
    setSettings(updated);
    setSoundEnabled(updated.enableSoundFx);
    cyberAudio.enabled = updated.enableSoundFx;
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    cyberAudio.enabled = next;
    if (next) cyberAudio.playClick();
  };

  const counts = {
    all: torrents.length,
    active: torrents.filter((t) => t.status === 'Downloading' || t.status === 'Seeding').length,
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
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Torrent List Area */}
          <TorrentList
            torrents={torrents}
            filter={filter}
            viewMode={viewMode}
            selectedTorrent={selectedTorrent}
            onSelectTorrent={(t) => {
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
              onClose={() => setIsDrawerOpen(false)}
              onOpenFolder={handleOpenFolder}
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
          onBackupNow={handleBackupNow}
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
    </div>
  );
};
