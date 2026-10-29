import React, { useEffect, useState } from 'react';
import {
  Settings,
  FolderOpen,
  Archive,
  ArrowRight,
  ShieldCheck,
  Save,
  X,
  Volume2,
  VolumeX,
  Sliders,
} from 'lucide-react';
import { ClientSettings } from '../types/torrent';
import { TauriBridge } from '../api/tauriBridge';

interface SettingsModalProps {
  isOpen: boolean;
  settings: ClientSettings;
  onClose: () => void;
  onSave: (newSettings: ClientSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSave,
}) => {
  const [formData, setFormData] = useState<ClientSettings>({ ...settings });

  // Re-sync whenever the modal is reopened (settings may have changed elsewhere).
  useEffect(() => {
    if (isOpen) setFormData({ ...settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBrowse = async (field: 'defaultDownloadDir' | 'backupDir' | 'completedTorrentDir') => {
    const selected = await TauriBridge.selectDirectory(
      'Select Folder',
      formData[field] || undefined,
    );
    if (selected) {
      setFormData((prev) => ({ ...prev, [field]: selected }));
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl cyber-panel border border-cyber-cyan/40 p-6 rounded-lg text-slate-100 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded bg-cyber-gold/20 border border-cyber-gold/40 text-cyber-gold shadow-glow-gold">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-cyber tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyber-gold via-white to-cyber-cyan">
                MAKEMAKE // SYSTEM VAULT & CONFIG
              </h2>
              <div className="text-[11px] font-mono text-slate-400">
                TEMPORAL AUTO-BACKUP & PROTOCOL SETTINGS
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto py-4 space-y-6">
          {/* Section 1: Default Download Chamber */}
          <div className="space-y-2">
            <label className="block text-xs font-mono font-bold text-cyber-cyan flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4" />
              SACRED STORAGE CHAMBER (DEFAULT DOWNLOAD LOCATION)
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={formData.defaultDownloadDir}
                onChange={(e) => setFormData({ ...formData, defaultDownloadDir: e.target.value })}
                placeholder="Leave empty to be asked every time"
                className="flex-1 px-3 py-2 rounded bg-obsidian-950 border border-slate-700 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyber-cyan"
              />
              <button
                type="button"
                onClick={() => handleBrowse('defaultDownloadDir')}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-mono flex items-center space-x-1.5"
              >
                <span>Browse...</span>
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, defaultDownloadDir: '' })}
                className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-300"
                title="Unset the default location so MakeMake asks every time"
              >
                Clear
              </button>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-obsidian-950/60 border border-slate-800">
              <div className="text-[11px] font-mono text-slate-300">
                PROMPT FOR A DESTINATION ON EVERY NEW TORRENT
              </div>
              <input
                type="checkbox"
                checked={formData.alwaysAskDownloadDir}
                onChange={(e) =>
                  setFormData({ ...formData, alwaysAskDownloadDir: e.target.checked })
                }
                className="w-4 h-4 rounded border-slate-700 text-cyber-cyan focus:ring-0"
              />
            </div>

            <div className="text-[10px] font-mono text-slate-500 leading-relaxed">
              With the prompt enabled you choose the folder for every .torrent file and every
              magnet link (magnet prompts appear as soon as the swarm returns the metadata). If no
              default is configured, MakeMake falls back to your system Downloads folder.
            </div>
          </div>

          {/* Section 2: Temporal Auto-Backup Engine */}
          <div className="p-4 rounded-lg bg-obsidian-950/80 border border-cyber-gold/30 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-cyber-gold">
                <Archive className="w-4 h-4" />
                <span>TEMPORAL AUTO-BACKUP (.TORRENT & MAGNET ARCHIVAL)</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.autoBackupEnabled}
                  onChange={(e) => setFormData({ ...formData, autoBackupEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyber-gold" />
              </label>
            </div>

            <p className="text-[11px] font-mono text-slate-400">
              Archives the raw .torrent of every download the moment its metadata is known — and,
              for magnet links, synthesizes a standard .torrent from the metadata fetched out of
              the swarm — into your vault. The interval below only controls how often that archived
              copy is refreshed while the download is still in progress.
            </p>

            {formData.autoBackupEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                <div>
                  <label className="block text-[11px] font-mono text-slate-300 mb-1">
                    ARCHIVE REFRESH INTERVAL:
                  </label>
                  <select
                    value={formData.backupIntervalHours}
                    onChange={(e) =>
                      setFormData({ ...formData, backupIntervalHours: parseInt(e.target.value) })
                    }
                    className="w-full px-3 py-1.5 rounded bg-obsidian-900 border border-slate-700 font-mono text-xs text-cyber-cyan focus:outline-none focus:border-cyber-cyan"
                  >
                    <option value={0}>⚡ Instant (every 10 minutes)</option>
                    <option value={1}>1 Hour</option>
                    <option value={6}>6 Hours (Recommended)</option>
                    <option value={12}>12 Hours</option>
                    <option value={24}>24 Hours (1 Day)</option>
                    <option value={72}>3 Days</option>
                    <option value={168}>7 Days (1 Week)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-slate-300 mb-1">
                    BACKUP VAULT TARGET:
                  </label>
                  <div className="flex space-x-1.5">
                    <input
                      type="text"
                      value={formData.backupDir}
                      onChange={(e) => setFormData({ ...formData, backupDir: e.target.value })}
                      className="flex-1 px-2.5 py-1.5 rounded bg-obsidian-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-cyber-gold"
                    />
                    <button
                      type="button"
                      onClick={() => handleBrowse('backupDir')}
                      className="px-2.5 py-1.5 rounded bg-slate-800 text-[11px] font-mono border border-slate-700 hover:bg-slate-700"
                    >
                      Browse
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Post-Completion Migration */}
          <div className="p-4 rounded-lg bg-obsidian-950/80 border border-cyber-cyan/30 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-cyber-cyan">
                <ArrowRight className="w-4 h-4" />
                <span>POST-COMPLETION .TORRENT RELOCATION</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.moveCompletedTorrentEnabled}
                  onChange={(e) =>
                    setFormData({ ...formData, moveCompletedTorrentEnabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyber-cyan" />
              </label>
            </div>

            <p className="text-[11px] font-mono text-slate-400">
              When a download reaches 100% verified status, the archived .torrent is physically
              moved (not copied) out of the staging vault into a dedicated &quot;Completed&quot;
              archive vault — so the two folders always tell you which swarms are still in flight.
            </p>

            {formData.moveCompletedTorrentEnabled && (
              <div className="space-y-1 pt-2 border-t border-slate-800/80">
                <label className="block text-[11px] font-mono text-slate-300">
                  COMPLETED TORRENTS VAULT FOLDER:
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={formData.completedTorrentDir}
                    onChange={(e) => setFormData({ ...formData, completedTorrentDir: e.target.value })}
                    className="flex-1 px-3 py-1.5 rounded bg-obsidian-900 border border-slate-700 font-mono text-xs text-slate-200 focus:outline-none focus:border-cyber-cyan"
                  />
                  <button
                    type="button"
                    onClick={() => handleBrowse('completedTorrentDir')}
                    className="px-3 py-1.5 rounded bg-slate-800 text-xs font-mono border border-slate-700 hover:bg-slate-700"
                  >
                    Browse...
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Bandwidth Throttles & Seeding */}
          <div className="p-4 rounded-lg bg-obsidian-950/80 border border-cyber-cyan/30 space-y-4">
            <div className="flex items-center space-x-2 text-xs font-mono font-bold text-cyber-cyan">
              <Sliders className="w-4 h-4" />
              <span>BANDWIDTH CALDERA (KB/s, 0 = UNLIMITED)</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-mono text-slate-300 mb-1">
                  MAX DOWNLOAD SPEED:
                </label>
                <input
                  type="number"
                  min={0}
                  value={Math.round(formData.maxDownloadSpeed / 1024)}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      maxDownloadSpeed: Math.max(0, parseInt(e.target.value) || 0) * 1024,
                    })
                  }
                  className="w-full px-3 py-1.5 rounded bg-obsidian-900 border border-slate-700 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-300 mb-1">
                  MAX UPLOAD SPEED:
                </label>
                <input
                  type="number"
                  min={0}
                  value={Math.round(formData.maxUploadSpeed / 1024)}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      maxUploadSpeed: Math.max(0, parseInt(e.target.value) || 0) * 1024,
                    })
                  }
                  className="w-full px-3 py-1.5 rounded bg-obsidian-900 border border-slate-700 font-mono text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
              <div>
                <label className="block text-[11px] font-mono text-slate-300 mb-1">
                  TURTLE DOWNLOAD SPEED:
                </label>
                <input
                  type="number"
                  min={0}
                  value={Math.round(formData.turtleDownloadSpeed / 1024)}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      turtleDownloadSpeed: Math.max(0, parseInt(e.target.value) || 0) * 1024,
                    })
                  }
                  className="w-full px-3 py-1.5 rounded bg-obsidian-900 border border-slate-700 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-300 mb-1">
                  TURTLE UPLOAD SPEED:
                </label>
                <input
                  type="number"
                  min={0}
                  value={Math.round(formData.turtleUploadSpeed / 1024)}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      turtleUploadSpeed: Math.max(0, parseInt(e.target.value) || 0) * 1024,
                    })
                  }
                  className="w-full px-3 py-1.5 rounded bg-obsidian-900 border border-slate-700 font-mono text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-obsidian-900/60 border border-slate-800">
              <div className="text-[11px] font-mono text-slate-300">
                KEEP SEEDING AFTER THE DOWNLOAD COMPLETES
              </div>
              <input
                type="checkbox"
                checked={formData.seedAfterComplete}
                onChange={(e) =>
                  setFormData({ ...formData, seedAfterComplete: e.target.checked })
                }
                className="w-4 h-4 rounded border-slate-700 text-cyber-green focus:ring-0"
              />
            </div>

            <div className="text-[10px] font-mono text-slate-500 leading-relaxed">
              Throttles are applied live to the librqbit session. The turtle profile can be toggled
              from the status bar without touching these caps.
            </div>
          </div>

          {/* Section 4b: Session Guard (crash-safe resume) */}
          <div className="p-4 rounded-lg bg-obsidian-950/80 border border-cyber-green/30 space-y-3">
            <div className="flex items-center space-x-2 text-xs font-mono font-bold text-cyber-green">
              <ShieldCheck className="w-4 h-4" />
              <span>SESSION GUARD (CRASH-SAFE RESUME)</span>
            </div>

            <p className="text-[11px] font-mono text-slate-400">
              On every exit — the window&apos;s close button, Alt+F4 or an OS shutdown request —
              MakeMake pauses each swarm (seeding or leeching, complete or not), drops every peer
              connection and flushes librqbit&apos;s resume database (piece map, `.torrent` bytes and
              pause flags) before the process ends. Nothing is ever left half-written, so damaged
              data cannot come from a normal close.
            </p>

            <div className="flex items-center justify-between p-2.5 rounded bg-obsidian-900/60 border border-slate-800">
              <div className="text-[11px] font-mono text-slate-300">
                AUTO-RESUME LAST ACTIVE SWARMS ON LAUNCH
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.resumeOnLaunch}
                  onChange={(e) =>
                    setFormData({ ...formData, resumeOnLaunch: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyber-green" />
              </label>
            </div>

            <div className="text-[10px] font-mono text-slate-500 leading-relaxed">
              A durability checkpoint is written every 15&nbsp;seconds, so even a hard crash (power
              loss, task manager kill) still remembers which swarms were live. Swarms that were
              paused when the app closed always stay paused.
            </div>
          </div>

          {/* Section 5: Network & Theme Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1">
                LISTEN PORT:
              </label>
              <input
                type="number"
                value={formData.listenPort}
                onChange={(e) => setFormData({ ...formData, listenPort: parseInt(e.target.value) || 6881 })}
                className="w-full px-3 py-1.5 rounded bg-obsidian-950 border border-slate-700 font-mono text-xs text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1">
                CYBERPUNK THEME PALETTE:
              </label>
              <select
                value={formData.theme}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    theme: e.target.value as 'cyber-obsidian' | 'neon-caldera' | 'solar-birdman',
                  })
                }
                className="w-full px-3 py-1.5 rounded bg-obsidian-950 border border-slate-700 font-mono text-xs text-cyber-cyan"
              >
                <option value="cyber-obsidian">🗿 Cyber-Obsidian (Classic)</option>
                <option value="neon-caldera">🌋 Neon-Caldera (Crimson Core)</option>
                <option value="solar-birdman">🦅 Solar-Birdman (Tangata Gold)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded bg-obsidian-950/60 border border-slate-800">
            <div className="flex items-center space-x-2 text-xs font-mono text-slate-300">
              {formData.enableSoundFx ? (
                <Volume2 className="w-4 h-4 text-cyber-cyan" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500" />
              )}
              <span>CYBERNETIC AUDIO HAPTICS & SOUND FX</span>
            </div>
            <input
              type="checkbox"
              checked={formData.enableSoundFx}
              onChange={(e) => setFormData({ ...formData, enableSoundFx: e.target.checked })}
              className="w-4 h-4 rounded border-slate-700 text-cyber-cyan focus:ring-0"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-cyber-green" />
            <span>CONFIG VERIFIED & ENCRYPTED</span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded text-xs font-mono font-bold text-slate-400 hover:text-white transition-colors"
            >
              DISCARD
            </button>

            <button
              onClick={handleFormSubmit}
              className="cyber-button px-6 py-2 bg-gradient-to-r from-cyber-gold to-cyber-cyan text-black font-bold font-mono text-xs uppercase tracking-wider shadow-glow-gold flex items-center space-x-1.5"
            >
              <Save className="w-4 h-4" />
              <span>COMMIT SETTINGS</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
