import React from 'react';
import { Download, Rocket, X } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';

interface UpdateModalProps {
  update: Update | null;
  isChecking: boolean;
  isInstalling: boolean;
  downloadedBytes: number;
  contentLength: number | null;
  onClose: () => void;
  onInstall: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  update,
  isChecking,
  isInstalling,
  downloadedBytes,
  contentLength,
  onClose,
  onInstall,
}) => {
  if (!update && !isChecking) return null;

  const progress = contentLength && contentLength > 0
    ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
    : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="cyber-panel w-full max-w-lg rounded-lg border border-cyber-cyan/40 p-6 text-slate-100 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded border border-cyber-cyan/40 bg-cyber-cyan/10 p-2 text-cyber-cyan">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 id="update-title" className="font-cyber text-sm font-bold tracking-wider text-cyber-cyan">
                {isChecking ? 'SCANNING RELEASE CHANNEL' : `PROTOCOL ${update?.version} AVAILABLE`}
              </h2>
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {isChecking ? 'Checking the signed MakeMake release feed…' : `Current protocol: ${update?.currentVersion}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isInstalling || isChecking}
            aria-label="Close update dialog"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {update && (
          <>
            <div className="mt-5 max-h-52 overflow-y-auto rounded border border-slate-800 bg-obsidian-950/70 p-3 font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
              {update.body?.trim() || 'A new MakeMake build is ready. Review and install it when convenient.'}
            </div>

            {isInstalling && (
              <div className="mt-4 space-y-2" aria-live="polite">
                <div className="flex justify-between font-mono text-[10px] text-slate-400">
                  <span>DOWNLOADING SIGNED UPDATE</span>
                  <span>{progress === null ? `${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB` : `${progress}%`}</span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-slate-800">
                  <div
                    className="h-full bg-cyber-cyan transition-[width] duration-200"
                    style={{ width: `${progress ?? (downloadedBytes > 0 ? 8 : 2)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isInstalling}
                className="rounded border border-slate-700 px-4 py-2 font-mono text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                Later
              </button>
              <button
                type="button"
                onClick={onInstall}
                disabled={isInstalling}
                className="flex items-center gap-2 rounded bg-gradient-to-r from-cyber-cyan to-cyber-teal px-4 py-2 font-mono text-[11px] font-bold text-black disabled:cursor-wait disabled:opacity-60"
              >
                <Rocket className="h-4 w-4" />
                {isInstalling ? 'INSTALLING…' : 'INSTALL & RESTART'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
