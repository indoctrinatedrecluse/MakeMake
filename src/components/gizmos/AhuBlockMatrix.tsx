import React, { useEffect, useMemo, useRef } from 'react';

interface AhuBlockMatrixProps {
  piecesBitfield: number[];
  pieceCount: number;
  totalSize: number;
  torrentName: string;
}

/**
 * Coarse piece map, drawn on a canvas.
 *
 * librqbit does not expose its real piece bitfield, and a torrent such as a 133 GiB repack
 * has ~34 000 pieces. Rendering one <div> per piece meant tens of thousands of DOM nodes
 * re-laid out on every poll, which is what made the details drawer lock up on large
 * torrents. A canvas redraw is a single paint and the cell budget is capped, so the cost
 * never grows with the torrent size.
 */
const MAX_CELLS = 1024;
const COLUMNS = 32;
const CELL = 6;
const GAP = 2;

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const AhuBlockMatrix: React.FC<AhuBlockMatrixProps> = ({
  piecesBitfield = [],
  pieceCount = 0,
  totalSize = 0,
  torrentName = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const buckets = useMemo(
    () => (Array.isArray(piecesBitfield) ? piecesBitfield : []),
    [piecesBitfield],
  );

  const completedBuckets = useMemo(
    () => buckets.reduce((acc, bit) => acc + (bit === 1 ? 1 : 0), 0),
    [buckets],
  );

  const percent =
    buckets.length > 0 ? Math.round((completedBuckets / buckets.length) * 100) : 0;
  const pieceSize = pieceCount > 0 ? Math.round(totalSize / pieceCount) : 0;

  // Redraw only when the numbers change, never once per render.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cells = Math.min(Math.max(buckets.length, 1), MAX_CELLS);
    const rows = Math.ceil(cells / COLUMNS);
    const width = COLUMNS * (CELL + GAP);
    const height = rows * (CELL + GAP);
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const filled = Math.round((completedBuckets / Math.max(buckets.length, 1)) * cells);

    for (let index = 0; index < cells; index += 1) {
      ctx.fillStyle =
        index < filled
          ? 'rgba(0, 240, 255, 0.9)'
          : index === filled
            ? 'rgba(255, 68, 56, 0.9)'
            : 'rgba(30, 41, 59, 0.9)';
      ctx.fillRect((index % COLUMNS) * (CELL + GAP), Math.floor(index / COLUMNS) * (CELL + GAP), CELL, CELL);
    }
  }, [buckets.length, completedBuckets]);

  return (
    <div className="flex flex-col p-3 bg-obsidian-900 border border-cyber-cyan/30 rounded-lg shadow-glow-cyan/20">
      <div className="flex items-center justify-between text-xs font-mono mb-2">
        <div className="flex items-center space-x-2 text-cyber-cyan font-bold">
          <span className="text-cyber-vermilion">🗿</span>
          <span>AHU OBSIDIAN BITMAP MATRIX</span>
        </div>
        <div className="text-[11px] text-slate-400">
          VERIFIED: <span className="text-cyber-cyan font-bold">{percent}%</span> of{' '}
          {pieceCount.toLocaleString()} pieces
        </div>
      </div>

      <div className="p-2 bg-obsidian-950/80 rounded border border-slate-800/80 overflow-auto max-h-[260px]">
        <canvas ref={canvasRef} aria-label="Coarse piece map" />
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-2">
        <span className="truncate max-w-[200px] text-slate-400">{torrentName}</span>
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-cyber-cyan" />
            <span>Verified</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-cyber-vermilion" />
            <span>In flight</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-basalt-dark border border-slate-700" />
            <span>Pending</span>
          </span>
        </div>
      </div>

      <div className="mt-1 text-[9px] font-mono text-slate-500">
        Coarse map · {buckets.length || 0} buckets · {formatBytes(pieceSize)} per piece
      </div>
    </div>
  );
};
