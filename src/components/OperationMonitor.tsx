import React, { useEffect, useState } from 'react';
import { WorkGlyph, WorkKind } from './gizmos/WorkGlyph';

/** One IPC command the window is waiting on. */
export interface PendingOp {
  id: string;
  /** What the user asked for, in their words ("Resuming Cyberpunk 2077"). */
  label: string;
  kind: WorkKind;
  /** `Date.now()` when the command was sent. */
  startedAt: number;
}

interface OperationMonitorProps {
  ops: PendingOp[];
}

/**
 * Floating transmitter readout for commands that are already on their way.
 *
 * MakeMake's commands now answer immediately, but "immediately" is still an IPC round trip
 * plus whatever the engine has to do first (a magnet resolution, a 20 000-file payload
 * sweep). Without this, the only feedback was the click sound — which is exactly what made
 * slow adds and slow purges feel like a frozen window. Every in-flight command is listed with
 * a live elapsed counter, and after eight seconds the panel says plainly that the engine is
 * still answering instead of leaving the user guessing.
 */
export const OperationMonitor: React.FC<OperationMonitorProps> = ({ ops }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (ops.length === 0) return;
    // Only ticks while something is in flight; idle windows do no timer work at all.
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [ops.length]);

  if (ops.length === 0) return null;

  return (
    <div
      className="fixed bottom-24 right-5 z-[55] flex flex-col items-end space-y-1.5 pointer-events-none select-none"
      role="status"
      aria-live="polite"
    >
      {ops.map((op) => {
        const elapsed = Math.max(0, Math.floor((now - op.startedAt) / 1000));
        const slow = elapsed >= 8;
        return (
          <div
            key={op.id}
            className={`cyber-panel flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-mono ${
              slow ? 'border-cyber-gold/60' : 'border-cyber-cyan/40'
            }`}
          >
            <WorkGlyph kind={op.kind} size={12} />
            <span className="text-slate-200 max-w-[16rem] truncate" title={op.label}>
              {op.label}
            </span>
            <span className={slow ? 'text-cyber-gold' : 'text-slate-500'}>{elapsed}s</span>
            {slow && (
              <span className="text-cyber-gold/90 uppercase tracking-wide">
                still working
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
