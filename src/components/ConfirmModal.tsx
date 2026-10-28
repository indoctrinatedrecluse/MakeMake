import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  targetName: string;
  targetPath?: string;
  isDestructive?: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  targetName,
  targetPath,
  isDestructive = true,
  confirmLabel,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      {/* Outer Panel with Cyber Cut Corners and Hazard Striping */}
      <div
        className={`relative w-full max-w-lg p-6 rounded-lg ${
          isDestructive ? 'cyber-panel-red border-cyber-red/50' : 'cyber-panel border-cyber-cyan/50'
        } shadow-2xl text-slate-100 overflow-hidden`}
      >
        {/* Top Hazard Warning Ribbon */}
        {isDestructive && (
          <div className="absolute top-0 left-0 right-0 h-2 hazard-stripes" />
        )}

        {/* Close Button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-start space-x-3 mb-4">
          <div
            className={`p-2.5 rounded-lg ${
              isDestructive
                ? 'bg-cyber-red/20 text-cyber-red border border-cyber-red/40 shadow-glow-red'
                : 'bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/40 shadow-glow-cyan'
            }`}
          >
            <AlertTriangle className="w-6 h-6 animate-pulse" />
          </div>

          <div>
            <h3 className="text-lg font-bold font-cyber tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-300">
              {title}
            </h3>
            <div className="text-[11px] font-mono text-cyber-red tracking-wider uppercase">
              {isDestructive ? '⚡ CAUTION: IRREVERSIBLE OPERATION' : 'CONFIRMATION REQUIRED'}
            </div>
          </div>
        </div>

        {/* Message Body */}
        <div className="text-sm font-mono text-slate-300 leading-relaxed mb-4">
          {message}
        </div>

        {/* Target Entity Card */}
        <div className="p-3 mb-5 rounded bg-obsidian-950/90 border border-slate-800 text-xs font-mono">
          <div className="text-slate-400 text-[10px] uppercase">TARGET DATA MONOLITH:</div>
          <div className="font-bold text-cyber-cyan truncate mt-0.5">{targetName}</div>
          {targetPath && (
            <div className="mt-1 text-[11px] text-slate-400 truncate">
              PATH: <span className="text-cyber-vermilion">{targetPath}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded text-xs font-mono font-bold text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all border border-slate-700"
          >
            ABORT / CANCEL
          </button>

          <button
            onClick={onConfirm}
            className={`cyber-button px-5 py-2 text-xs font-mono font-bold uppercase tracking-wider flex items-center space-x-2 transition-all ${
              isDestructive
                ? 'bg-gradient-to-r from-cyber-red to-cyber-vermilion text-white shadow-glow-red hover:scale-105'
                : 'bg-gradient-to-r from-cyber-cyan to-cyber-teal text-black shadow-glow-cyan hover:scale-105'
            }`}
          >
            {isDestructive && <Trash2 className="w-4 h-4" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
