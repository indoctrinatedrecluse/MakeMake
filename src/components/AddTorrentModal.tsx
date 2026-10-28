import React, { useState, useEffect } from 'react';
import {
  Download,
  FolderOpen,
  FileCode,
  CheckSquare,
  Square,
  Loader2,
  X,
  FileCheck,
} from 'lucide-react';
import { TorrentMetadataPreview, TorrentFileItem } from '../types/torrent';
import { TauriBridge } from '../api/tauriBridge';

interface AddTorrentModalProps {
  isOpen: boolean;
  defaultDownloadDir: string;
  initialMagnetOrFile?: { type: 'magnet' | 'file'; data: string; name?: string } | null;
  onClose: () => void;
  onAddConfirm: (preview: TorrentMetadataPreview, targetDir: string) => void;
}

export const AddTorrentModal: React.FC<AddTorrentModalProps> = ({
  isOpen,
  defaultDownloadDir,
  initialMagnetOrFile,
  onClose,
  onAddConfirm,
}) => {
  const [inputMagnet, setInputMagnet] = useState('');
  const [downloadDir, setDownloadDir] = useState(defaultDownloadDir);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [preview, setPreview] = useState<TorrentMetadataPreview | null>(null);

  useEffect(() => {
    setDownloadDir(defaultDownloadDir);
  }, [defaultDownloadDir]);

  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setInputMagnet('');
      setIsLoadingMetadata(false);
      return;
    }

    if (initialMagnetOrFile) {
      if (initialMagnetOrFile.type === 'magnet') {
        setInputMagnet(initialMagnetOrFile.data);
        handleResolveMagnet(initialMagnetOrFile.data);
      } else if (initialMagnetOrFile.type === 'file') {
        handleLoadTorrentFile(initialMagnetOrFile.name || 'archive.torrent', initialMagnetOrFile.data);
      }
    }
  }, [isOpen, initialMagnetOrFile]);

  const handleResolveMagnet = async (uri: string) => {
    if (!uri.startsWith('magnet:?')) return;
    setIsLoadingMetadata(true);
    try {
      // Simulate/perform DHT metadata fetch
      await new Promise((r) => setTimeout(r, 900));
      const res = await TauriBridge.parseMagnetLink(uri);
      setPreview(res);
    } catch (err) {
      console.error('Failed to parse magnet link', err);
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  const handleLoadTorrentFile = async (name: string, base64Content: string) => {
    setIsLoadingMetadata(true);
    try {
      const res = await TauriBridge.parseTorrentFile(name, base64Content);
      setPreview(res);
    } catch (err) {
      console.error('Failed to parse torrent file', err);
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  const handleBrowseDir = async () => {
    const selected = await TauriBridge.selectDirectory('Choose Download Chamber');
    if (selected) {
      setDownloadDir(selected);
    }
  };

  const handleToggleFile = (index: number) => {
    if (!preview) return;
    const updatedFiles = preview.files.map((f) =>
      f.index === index ? { ...f, selected: !f.selected } : f
    );
    setPreview({ ...preview, files: updatedFiles });
  };

  const handleSelectAll = (select: boolean) => {
    if (!preview) return;
    const updatedFiles = preview.files.map((f) => ({ ...f, selected: select }));
    setPreview({ ...preview, files: updatedFiles });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  if (!isOpen) return null;

  const selectedFiles = preview ? preview.files.filter((f) => f.selected) : [];
  const selectedSize = selectedFiles.reduce((acc, f) => acc + f.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl cyber-panel border border-cyber-cyan/40 p-6 rounded-lg text-slate-100 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded bg-cyber-cyan/20 border border-cyber-cyan/40 text-cyber-cyan shadow-glow-cyan">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-cyber tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyber-cyan to-white">
                INGEST SACRED SWARM PAYLOAD
              </h2>
              <div className="text-[11px] font-mono text-slate-400">
                .TORRENT & MAGNET METADATA INSPECTOR
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

        {/* Input Area (if not yet loaded) */}
        {!preview && !isLoadingMetadata && (
          <div className="py-6 space-y-4">
            <div>
              <label className="block text-xs font-mono text-cyber-cyan mb-1.5">
                PASTE MAGNET URI:
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={inputMagnet}
                  onChange={(e) => setInputMagnet(e.target.value)}
                  placeholder="magnet:?xt=urn:btih:..."
                  className="flex-1 px-3 py-2 rounded bg-obsidian-950 border border-slate-700 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyber-cyan"
                />
                <button
                  onClick={() => handleResolveMagnet(inputMagnet)}
                  disabled={!inputMagnet.startsWith('magnet:?')}
                  className="cyber-button px-4 py-2 bg-cyber-cyan text-black font-bold text-xs font-mono disabled:opacity-40"
                >
                  RESOLVE
                </button>
              </div>
            </div>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-800" />
              <span className="flex-shrink mx-4 text-xs font-mono text-slate-400">OR OPEN FILE</span>
              <div className="flex-grow border-t border-slate-800" />
            </div>

            <div
              onClick={() => {
                const dummyName = 'Tangata-Manu-Rano-Kau-Photogrammetry.torrent';
                handleLoadTorrentFile(dummyName, 'dummyBase64');
              }}
              className="border-2 border-dashed border-slate-700 hover:border-cyber-cyan rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-obsidian-950/50 group"
            >
              <FileCode className="w-10 h-10 text-slate-400 group-hover:text-cyber-cyan transition-colors mb-2" />
              <div className="text-xs font-mono text-slate-300 font-bold">
                CLICK TO CHOOSE A .TORRENT FILE
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-1">
                Supports all standard BitTorrent v1 and v2 files
              </div>
            </div>
          </div>
        )}

        {/* Loading Metadata Sequence */}
        {isLoadingMetadata && (
          <div className="py-16 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-10 h-10 text-cyber-cyan animate-spin" />
            <div className="text-center">
              <div className="text-sm font-bold font-mono text-cyber-cyan animate-pulse">
                RESOLVING SWARM METADATA FROM DHT...
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-1">
                Interrogating Rapa Nui peer routing table
              </div>
            </div>
          </div>
        )}

        {/* Resolved Metadata Preview & File Inspector */}
        {preview && (
          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            {/* Torrent Info Banner */}
            <div className="p-3 bg-obsidian-950/90 rounded border border-slate-800 flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-cyber-cyan truncate max-w-[420px]">
                  {preview.name}
                </span>
                <span className="text-xs font-mono text-cyber-gold font-bold">
                  TOTAL: {formatBytes(preview.totalSize)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
                <div>
                  PIECES: <span className="text-slate-300 font-bold">{preview.pieceCount}</span>
                </div>
                <div>
                  PIECE SIZE: <span className="text-slate-300 font-bold">{formatBytes(preview.pieceLength)}</span>
                </div>
                <div className="truncate">
                  HASH: <span className="text-slate-300 font-bold">{preview.infoHash.slice(0, 10)}...</span>
                </div>
              </div>
            </div>

            {/* Destination Selector (Default path filled) */}
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1">
                DESTINATION CHAMBER (DOWNLOAD DIRECTORY):
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={downloadDir}
                  onChange={(e) => setDownloadDir(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded bg-obsidian-950 border border-slate-700 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyber-cyan"
                />
                <button
                  onClick={handleBrowseDir}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-mono flex items-center space-x-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-cyber-cyan" />
                  <span>Browse...</span>
                </button>
              </div>
            </div>

            {/* File List Tree & Checkbox Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-bold flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4 text-cyber-cyan" />
                  PAYLOAD FILES ({selectedFiles.length}/{preview.files.length} SELECTED)
                </span>
                <div className="flex items-center space-x-2 text-[11px]">
                  <button
                    onClick={() => handleSelectAll(true)}
                    className="text-cyber-cyan hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">•</span>
                  <button
                    onClick={() => handleSelectAll(false)}
                    className="text-slate-400 hover:underline"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto rounded bg-obsidian-950/80 border border-slate-800 divide-y divide-slate-800/60">
                {preview.files.map((file: TorrentFileItem) => (
                  <div
                    key={file.index}
                    onClick={() => handleToggleFile(file.index)}
                    className="px-3 py-2 flex items-center justify-between hover:bg-slate-800/40 cursor-pointer text-xs font-mono transition-colors"
                  >
                    <div className="flex items-center space-x-2.5 truncate max-w-[420px]">
                      {file.selected ? (
                        <CheckSquare className="w-4 h-4 text-cyber-cyan flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      )}
                      <span className={`truncate ${file.selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        {file.path || file.name}
                      </span>
                    </div>

                    <span className="text-[11px] text-slate-400 font-mono flex-shrink-0 ml-2">
                      {formatBytes(file.length)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs font-mono text-slate-400">
            {preview && (
              <span>
                SELECTED PAYLOAD: <span className="text-cyber-cyan font-bold">{formatBytes(selectedSize)}</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded text-xs font-mono font-bold text-slate-400 hover:text-white transition-colors"
            >
              ABORT
            </button>

            {preview && (
              <button
                onClick={() => {
                  onAddConfirm(preview, downloadDir);
                  onClose();
                }}
                disabled={selectedFiles.length === 0}
                className="cyber-button px-6 py-2 bg-gradient-to-r from-cyber-cyan to-cyber-teal text-black font-bold font-mono text-xs uppercase tracking-wider disabled:opacity-40 shadow-glow-cyan"
              >
                ENGAGE SWARM
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
