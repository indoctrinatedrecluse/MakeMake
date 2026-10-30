import React from 'react';
import { WorkGlyph, WorkKind } from './WorkGlyph';
import { TorrentItem } from '../../types/torrent';

type BandTone = 'cyan' | 'gold' | 'red' | 'green' | 'slate';

interface WorkBandProps {
  kind: WorkKind;
  /** Short, uppercase statement of what is happening (never a bare percentage). */
  label: string;
  /** Optional second half: the engine's own words for this state. */
  detail?: string | null;
  /**
   * Completion of the hidden work in percent, when it is genuinely knowable
   * (verified bytes while hashing, files erased while purging). `null` renders the
   * indeterminate crawl — the honest choice when there is no denominator.
   */
  progress?: number | null;
  /** Numeric readout, e.g. `4 512 / 20 000 files`. */
  counter?: string | null;
  tone?: BandTone;
  className?: string;
}

const TONE: Record<BandTone, { text: string; border: string; track: string; fill: string }> = {
  cyan: {
    text: 'text-cyber-cyan',
    border: 'border-cyber-cyan/35',
    track: 'bg-cyber-cyan/15',
    fill: 'from-blue-600 via-cyber-cyan to-cyber-teal',
  },
  gold: {
    text: 'text-cyber-gold',
    border: 'border-cyber-gold/35',
    track: 'bg-cyber-gold/15',
    fill: 'from-cyber-amber via-cyber-gold to-yellow-300',
  },
  red: {
    text: 'text-cyber-red',
    border: 'border-cyber-red/35',
    track: 'bg-cyber-red/15',
    fill: 'from-cyber-red via-cyber-vermilion to-rose-400',
  },
  green: {
    text: 'text-cyber-green',
    border: 'border-cyber-green/35',
    track: 'bg-cyber-green/15',
    fill: 'from-cyber-teal via-cyber-green to-emerald-400',
  },
  slate: {
    text: 'text-slate-400',
    border: 'border-slate-700',
    track: 'bg-slate-700/40',
    fill: 'from-slate-600 via-slate-400 to-slate-300',
  },
};

/**
 * The "this is not frozen" band.
 *
 * Rendered only while the engine is doing something that produces no visible progress in the
 * row itself: verifying a payload, erasing files, resolving a magnet, waiting for an init
 * slot. It always carries a moving element — a crawling indeterminate bar or a filling one —
 * plus, where the engine actually knows it, a real counter.
 */
export const WorkBand: React.FC<WorkBandProps> = ({
  kind,
  label,
  detail,
  progress = null,
  counter = null,
  tone = 'cyan',
  className = '',
}) => {
  const palette = TONE[tone];
  const determinate = progress !== null && progress >= 0;
  const width = determinate ? Math.max(1.5, Math.min(100, progress as number)) : 100;

  return (
    <div
      className={`flex flex-col space-y-1 rounded border ${palette.border} bg-obsidian-950/60 px-2 py-1 ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <WorkGlyph kind={kind} size={12} />
        <span className={`text-[10px] font-mono font-bold tracking-wider uppercase ${palette.text}`}>
          {label}
        </span>
        {detail && (
          <span className="text-[10px] font-mono text-slate-500 truncate min-w-0 flex-1" title={detail}>
            {detail}
          </span>
        )}
        {counter && (
          <span className={`ml-auto text-[10px] font-mono ${palette.text} flex-shrink-0`}>
            {counter}
          </span>
        )}
      </div>

      <div className={`relative h-[3px] w-full overflow-hidden rounded-sm ${palette.track}`}>
        {determinate ? (
          <div
            className={`h-full rounded-sm bg-gradient-to-r ${palette.fill} transition-all duration-500`}
            style={{ width: `${width}%` }}
          />
        ) : (
          /* No denominator: crawl, never pretend to be at 0 %. */
          <div className={`h-full w-full ${palette.text} anim-strands opacity-70`} />
        )}
      </div>
    </div>
  );
};

/** Big file counts read better with thin grouping (`4 512`) than with a comma stream. */
export const fmtCount = (value: number) =>
  Math.round(value).toLocaleString('en-US').replace(/,/g, ' ');

/** What a [`WorkBand`] should say for one torrent, or `null` when nothing is hidden. */
export interface HiddenWork {
  kind: WorkKind;
  label: string;
  detail: string;
  tone: BandTone;
  progress: number | null;
  counter: string | null;
}

/**
 * Work that produces no visible byte progress — the answer to "is this thing hung?".
 *
 * Each state carries its own glyph, its own colour and, wherever the engine really knows it, a
 * real counter: verified pieces while hashing, erased files while purging. States without a
 * denominator get a crawling indefinite bar rather than a fake percentage.
 */
export const deriveHiddenWork = (torrent: TorrentItem): HiddenWork | null => {
  // A failed magnet is still a queue entry (`resolving: true`) but nothing is running: the row
  // already carries the error badge and message, so no "working" band belongs on it.
  if (torrent.status === 'Error') return null;

  switch (torrent.status) {
    case 'Deleting':
      return {
        kind: 'purge',
        label: 'Erasing payload',
        detail: 'Files are being removed from disk — the row vanishes when the last one is gone',
        tone: 'red',
        progress:
          torrent.pieceCount > 0 ? (torrent.piecesCompleted / torrent.pieceCount) * 100 : null,
        counter:
          torrent.pieceCount > 0
            ? `${fmtCount(torrent.piecesCompleted)} / ${fmtCount(torrent.pieceCount)} files`
            : null,
      };
    case 'Checking':
      return {
        kind: 'verify',
        label: 'Verifying payload',
        detail: 'Hashing what is already on disk — the swarm is not sending anything yet',
        tone: 'gold',
        progress: torrent.totalBytes > 0 ? torrent.progress : null,
        counter:
          torrent.pieceCount > 0
            ? `${fmtCount(torrent.piecesCompleted)} / ${fmtCount(torrent.pieceCount)} pieces`
            : null,
      };
    case 'Queued':
      return {
        kind: 'queue',
        label: 'Waiting for an engine slot',
        detail:
          'librqbit verifies a limited number of payloads at once; this one starts when a slot frees',
        tone: 'slate',
        progress: null,
        counter: null,
      };
    default:
      break;
  }

  if (torrent.resolving) {
    return {
      kind: 'resolve',
      label: 'Resolving metadata',
      detail: 'Asking DHT and trackers for this magnet’s .torrent — the download starts by itself',
      tone: 'gold',
      progress: null,
      counter: null,
    };
  }

  return null;
};
