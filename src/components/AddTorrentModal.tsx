import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  FolderOpen,
  FileCode,
  CheckSquare,
  Square,
  Loader2,
  X,
  FileCheck,
  AlertTriangle,
  Magnet,
  UploadCloud,
  HardDrive,
  Film,
} from 'lucide-react';
import { TorrentMetadataPreview, TorrentFileItem } from '../types/torrent';
import { TauriBridge } from '../api/tauriBridge';

interface AddTorrentModalProps {
  isOpen: boolean;
  defaultDownloadDir: string;
  alwaysAskDownloadDir?: boolean;
  initialMagnetOrFile?: { type: 'magnet' | 'file'; data: string; name?: string } | null;
  onClose: () => void;
  onAddConfirm: (preview: TorrentMetadataPreview, targetDir: string) => void;
}

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export const AddTorrentModal: React.FC<AddTorrentModalProps> = ({
  isOpen,
  defaultDownloadDir,
  alwaysAskDownloadDir = true,
  initialMagnetOrFile,
  onClose,
  onAddConfirm,
}) => {
  const [inputMagnet, setInputMagnet] = useState('');
  const [downloadDir, setDownloadDir] = useState(defaultDownloadDir);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [preview, setPreview] = useState<TorrentMetadataPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [dirError, setDirError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * Ask where the payload should land. MakeMake prompts for the location on every
   * add unless the user disabled "ask every time" *and* a default is configured.
   * `.torrent` files prompt as soon as they parse; magnets prompt after the swarm
   * returns the metadata.
   */
  const askForDestination = async () => {
    const fallback = defaultDownloadDir.trim();
    const mustAsk = alwaysAskDownloadDir || !fallback;

    if (!mustAsk) {
      setDownloadDir(fallback);
      setDirError(null);
      return;
    }

    const picked = await TauriBridge.selectDirectory(
      'Where should MakeMake store this payload?',
      fallback || undefined,
    );

    if (picked) {
      setDownloadDir(picked);
      setDirError(null);
      return;
    }

    if (fallback) {
      setDownloadDir(fallback);
      setDirError(
        'Folder picker cancelled — falling back to the configured default download location.',
      );
    } else {
      setDownloadDir('');
      setDirError(
        'No destination selected. Choose a folder — there is no default download location configured.',
      );
    }
  };

  const resolveMagnet = async (uri: string) => {
    if (!uri.startsWith('magnet:?')) {
      setPreviewError('A magnet link must start with "magnet:?"');
      return;
    }
    setPreviewError(null);
    setIsLoadingMetadata(true);
    try {
      // Resolves the torrent metadata from the swarm (DHT + trackers).
      const res = await TauriBridge.parseMagnetLink(uri);
      setPreview(res);
      await askForDestination();
    } catch (err) {
      console.error('Failed to parse magnet link', err);
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  const loadTorrentFile = async (name: string, base64Content: string) => {
    setPreviewError(null);
    setIsLoadingMetadata(true);
    try {
      const res = await TauriBridge.parseTorrentFile(name, base64Content);
      setPreview(res);
      await askForDestination();
    } catch (err) {
      console.error('Failed to parse torrent file', err);
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      void loadTorrentFile(file.name, base64);
    };
    reader.onerror = () => setPreviewError(`Cannot read ${file.name}`);
    reader.readAsDataURL(file);
  };

  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) readFile(file);
  };

  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setPreviewError(null);
      setDirError(null);
      setInputMagnet('');
      setIsLoadingMetadata(false);
      setDownloadDir(defaultDownloadDir);
      return;
    }

    setDownloadDir(defaultDownloadDir);
    if (initialMagnetOrFile?.type === 'magnet') {
      setInputMagnet(initialMagnetOrFile.data);
      void resolveMagnet(initialMagnetOrFile.data);
    } else if (initialMagnetOrFile?.type === 'file') {
      void loadTorrentFile(initialMagnetOrFile.name || 'archive.torrent', initialMagnetOrFile.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialMagnetOrFile]);

  const handleBrowseDir = async () => {
    const selected = await TauriBridge.selectDirectory(
      'Choose Download Destination',
      downloadDir || defaultDownloadDir || undefined,
    );
    if (selected) {
      setDownloadDir(selected);
      setDirError(null);
    }
  };

  const handleToggleFile = (index: number) => {
    if (!preview) return;
    setPreview({
      ...preview,
      files: preview.files.map((f) => (f.index === index ? { ...f, selected: !f.selected } : f)),
    });
  };

  const handleSelectAll = (select: boolean) => {
    if (!preview) return;
    setPreview({ ...preview, files: preview.files.map((f) => ({ ...f, selected: select })) });
  };

  if (!isOpen) return null;

  const selectedFiles = preview ? preview.files.filter((f) => f.selected) : [];
  const selectedSize = selectedFiles.reduce((acc, f) => acc + f.length, 0);
  const hasFileList = !!preview && preview.files.length > 0;
  const canSubmit =
    !!preview && !!downloadDir.trim() && (!hasFileList || selectedFiles.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl cyber-panel border border-cyber-cyan/40 rounded-lg text-slate-100 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Top Header with ambient short-form Moai canvas */}
        <div className="relative px-6 pt-5 pb-4 border-b border-slate-800 overflow-hidden">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
          >
            <source src="/splash-moai.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-r from-obsidian-950 via-obsidian-950/80 to-transparent" />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded bg-cyber-cyan/20 border border-cyber-cyan/40 text-cyber-cyan shadow-glow-cyan">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold font-cyber tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyber-cyan to-white">
                  INGEST SACRED SWARM PAYLOAD
                </h2>
                <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                  <Film className="w-3 h-3 text-cyber-gold" />
                  .TORRENT &amp; MAGNET METADATA INSPECTOR
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
              title="Abort"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>


        {/* Input Area (if not yet loaded) */}
        {!preview && !isLoadingMetadata && (
          <div className="px-6 py-6 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-xs font-mono text-cyber-cyan mb-1.5 flex items-center gap-1.5">
                <Magnet className="w-3.5 h-3.5" />
                PASTE MAGNET URI:
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={inputMagnet}
                  onChange={(e) => setInputMagnet(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void resolveMagnet(inputMagnet);
                  }}
                  placeholder="magnet:?xt=urn:btih:..."
                  className="flex-1 px-3 py-2 rounded bg-obsidian-950 border border-slate-700 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyber-cyan"
                />
                <button
                  onClick={() => void resolveMagnet(inputMagnet)}
                  disabled={!inputMagnet.startsWith('magnet:?')}
                  className="cyber-button px-4 py-2 bg-cyber-cyan text-black font-bold font-mono text-xs uppercase disabled:opacity-40"
                >
                  Resolve
                </button>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">
                MakeMake fetches the metadata from the swarm, then asks where to store the files.
              </div>
            </div>

            <div className="flex items-center space-x-3 text-[10px] font-mono text-slate-500">
              <div className="flex-1 h-px bg-slate-800" />
              <span>OR</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>

            {/* Drag & drop / file picker */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (!file) return;
                if (!file.name.toLowerCase().endsWith('.torrent')) {
                  setPreviewError(
                    'Only .torrent files are accepted here. Magnet links go in the field above.',
                  );
                  return;
                }
                readFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-8 flex flex-col items-center justify-center space-y-2 transition-colors ${
                isDragging
                  ? 'border-cyber-cyan bg-cyber-cyan/10'
                  : 'border-slate-700 hover:border-cyber-cyan/60 hover:bg-obsidian-900/60'
              }`}
            >
              <UploadCloud className="w-8 h-8 text-cyber-gold" />
              <div className="text-xs font-mono font-bold text-slate-200">
                DROP A .TORRENT FILE HERE
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                or click to browse your obsidian vault
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".torrent,application/x-bittorrent"
                onChange={handleFilePicked}
                className="hidden"
              />
            </div>

            {previewError && (
              <div className="flex items-start space-x-2 rounded border border-red-500/50 bg-red-950/40 px-3 py-2 text-[11px] font-mono text-red-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400" />
                <span className="break-all">{previewError}</span>
              </div>
            )}
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
                Interrogating the Rapa Nui peer routing table — up to 20 seconds. If the swarm is
                slow the torrent is still queued and resolves in the background.
              </div>
            </div>
          </div>
        )}


        {/* Resolved Metadata Preview & File Inspector */}
        {preview && !isLoadingMetadata && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
                  PIECES:{' '}
                  <span className="text-slate-300 font-bold">{preview.pieceCount || '—'}</span>
                </div>
                <div>
                  PIECE SIZE:{' '}
                  <span className="text-slate-300 font-bold">
                    {preview.pieceLength ? formatBytes(preview.pieceLength) : '—'}
                  </span>
                </div>
                <div className="truncate">
                  HASH:{' '}
                  <span className="text-slate-300 font-bold">{preview.infoHash.slice(0, 10)}...</span>
                </div>
              </div>

              {preview.files.length === 0 && (
                <div className="text-[10px] font-mono text-cyber-gold border-t border-slate-800/80 pt-2">
                  Metadata not available yet — MakeMake will fetch the file list from the swarm and
                  begin the download automatically.
                </div>
              )}
            </div>

            {/* Destination Selector */}
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-cyber-gold" />
                DESTINATION CHAMBER (DOWNLOAD DIRECTORY):
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={downloadDir}
                  onChange={(e) => {
                    setDownloadDir(e.target.value);
                    setDirError(null);
                  }}
                  placeholder="Choose a folder..."
                  className="flex-1 px-3 py-1.5 rounded bg-obsidian-950 border border-slate-700 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyber-cyan"
                />
                <button
                  onClick={() => void handleBrowseDir()}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-mono flex items-center space-x-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-cyber-cyan" />
                  <span>Browse...</span>
                </button>
              </div>
              {dirError ? (
                <div className="mt-1.5 flex items-start gap-1.5 text-[10px] font-mono text-cyber-gold">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{dirError}</span>
                </div>
              ) : (
                <div className="mt-1 text-[10px] font-mono text-slate-500">
                  {alwaysAskDownloadDir || !defaultDownloadDir
                    ? 'You will be asked for a location for every new torrent.'
                    : 'Using the vault default from Settings — change it there or type a path above.'}
                </div>
              )}
            </div>


            {/* File List Tree & Checkbox Selector */}
            {preview.files.length > 0 && (
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
                        <FileCode className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span
                          className={`truncate ${file.selected ? 'text-slate-200' : 'text-slate-500'}`}
                        >
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
            )}

            {previewError && (
              <div className="flex items-start space-x-2 rounded border border-red-500/50 bg-red-950/40 px-3 py-2 text-[11px] font-mono text-red-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400" />
                <span className="break-all">{previewError}</span>
              </div>
            )}
          </div>
        )}



        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs font-mono text-slate-400">
            {preview && hasFileList ? (
              <span>
                SELECTED PAYLOAD:{' '}
                <span className="text-cyber-cyan font-bold">{formatBytes(selectedSize)}</span>
              </span>
            ) : preview ? (
              <span className="text-slate-500">Awaiting metadata from the swarm…</span>
            ) : null}
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
                  onAddConfirm(preview, downloadDir.trim());
                  onClose();
                }}
                disabled={!canSubmit}
                title={!downloadDir.trim() ? 'Choose a destination folder first' : undefined}
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
