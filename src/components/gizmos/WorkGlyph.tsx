import React from 'react';

/**
 * The kinds of "hidden work" MakeMake can be doing.
 *
 * Each one has a different shape because each one is a different *kind* of waiting, and the
 * user should be able to tell them apart at a glance:
 *
 * - `verify`  — librqbit is hashing the payload already on disk (no bytes move, the disk is busy)
 * - `purge`   — payload files are being erased, one by one, on a blocking thread
 * - `scrape`  — the trackers are being asked for fresh seed/leecher numbers
 * - `resolve` — a magnet is asking DHT/trackers for its metadata
 * - `queue`   — the torrent is waiting for one of librqbit's init slots
 * - `transmit`— an IPC command is in flight (start, pause, verify, remove…)
 * - `seal`    — the session is being flushed to disk (exit)
 */
export type WorkKind =
  | 'verify'
  | 'purge'
  | 'scrape'
  | 'resolve'
  | 'queue'
  | 'transmit'
  | 'seal';

const TONE_CLASS: Record<WorkKind, string> = {
  verify: 'text-cyber-gold',
  purge: 'text-cyber-red',
  scrape: 'text-cyber-green',
  resolve: 'text-cyber-gold',
  queue: 'text-slate-400',
  transmit: 'text-cyber-cyan',
  seal: 'text-cyber-cyan',
};

interface WorkGlyphProps {
  kind: WorkKind;
  /** Rendered size in pixels (the SVG scales as a whole). */
  size?: number;
  /** Overrides the per-kind colour. */
  tone?: string;
  className?: string;
  title?: string;
}

/**
 * A small animated rune that says "something is happening" in the language of the theme:
 * chiselled moai geometry, dash-marching strokes, radar sweeps and falling shards.
 *
 * All motion lives in `index.css` (`anim-*` classes) so `prefers-reduced-motion` can switch it
 * off without changing a single component.
 */
export const WorkGlyph: React.FC<WorkGlyphProps> = ({
  kind,
  size = 14,
  tone,
  className = '',
  title,
}) => {
  const color = tone ?? TONE_CLASS[kind];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${color} flex-shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}

      {/* Verification: a hexagon being chiselled, with a dash-marching inner ring. */}
      {kind === 'verify' && (
        <>
          <path d="M12 3.2 19 7.2v8L12 19.2 5 15.2v-8z" opacity={0.55} />
          <circle
            cx="12"
            cy="11.2"
            r="4"
            strokeDasharray="4 3"
            className="anim-rune-dash"
          />
        </>
      )}

      {/* Purge: a moai silhouette dissolving into falling shards. */}
      {kind === 'purge' && (
        <>
          <path d="M7 6.5h10M7.5 6.5v11l4.5 2 4.5-2v-11" opacity={0.6} />
          <path d="M10 10v5M14 10v5" opacity={0.5} />
          <path d="M8 20.6h1.6M12 20.2h1.4M15.6 20.7h1.2" className="anim-shard" />
        </>
      )}

      {/* Scrape: radar rings with a sweeping arm — the trackers are being asked. */}
      {kind === 'scrape' && (
        <>
          <circle cx="12" cy="12" r="8" opacity={0.35} />
          <circle cx="12" cy="12" r="4.5" opacity={0.45} />
          <g className="anim-radar">
            <path d="M12 12 12 4.6" />
            <circle cx="12" cy="5.6" r="1.1" fill="currentColor" stroke="none" />
          </g>
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      )}

      {/* Resolve: a magnet arc pulling three dots out of the swarm. */}
      {kind === 'resolve' && (
        <>
          <path d="M6.5 9.5v4a5.5 5.5 0 0 0 11 0v-4" />
          <path d="M6.5 9.5h2.6v3.4M17.5 9.5h-2.6v3.4" opacity={0.7} />
          <circle cx="12" cy="4.4" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="4.2" cy="13" r="0.8" fill="currentColor" stroke="none" opacity={0.7} />
          <circle cx="19.8" cy="13" r="0.8" fill="currentColor" stroke="none" opacity={0.7} />
        </>
      )}

      {/* Queue: three stepping stones lighting up in sequence. */}
      {kind === 'queue' && (
        <>
          <path d="M4 16h16" opacity={0.35} />
          <circle cx="6.5" cy="12" r="1.5" fill="currentColor" stroke="none" className="anim-queue-dot" />
          <circle
            cx="12"
            cy="12"
            r="1.5"
            fill="currentColor"
            stroke="none"
            className="anim-queue-dot"
            style={{ animationDelay: '0.25s' }}
          />
          <circle
            cx="17.5"
            cy="12"
            r="1.5"
            fill="currentColor"
            stroke="none"
            className="anim-queue-dot"
            style={{ animationDelay: '0.5s' }}
          />
        </>
      )}

      {/* Transmit: concentric ripples leaving the client. */}
      {kind === 'transmit' && (
        <>
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="6" opacity={0.55} className="anim-transmit-ring" />
          <circle
            cx="12"
            cy="12"
            r="6"
            opacity={0.35}
            className="anim-transmit-ring"
            style={{ animationDelay: '0.8s' }}
          />
        </>
      )}

      {/* Seal: a spiral winding into the keel (session flush on exit). */}
      {kind === 'seal' && (
        <g className="anim-rune-spin">
          <path d="M12 12a3 3 0 1 1-3-3 6 6 0 1 1 6 6 9 9 0 0 1-9-9" />
        </g>
      )}
    </svg>
  );
};
