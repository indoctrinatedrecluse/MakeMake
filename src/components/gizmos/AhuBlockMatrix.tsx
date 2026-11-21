import React, { useEffect, useMemo, useRef } from 'react';
import { formatBytes } from '../../utils/format';

interface AhuBlockMatrixProps {
  piecesBitfield: number[];
  pieceCount: number;
  piecesCompleted: number;
  pieceMapExact?: boolean;
  totalSize: number;
  torrentName: string;
}

/**
 * Compact piece-range map, drawn on a canvas.
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

export const AhuBlockMatrix: React.FC<AhuBlockMatrixProps> = ({
  piecesBitfield = [],
  pieceCount = 0,
  piecesCompleted = 0,
  pieceMapExact = false,
  totalSize = 0,
  torrentName = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const buckets = useMemo(
    () => (Array.isArray(piecesBitfield) ? piecesBitfield : []),
    [piecesBitfield],
  );

  const progressedBuckets = useMemo(
    () => buckets.reduce((acc, bit) => acc + (bit === 1 ? 1 : 0), 0),
    [buckets],
  );

  const percent = pieceCount > 0
    ? Math.round((piecesCompleted / pieceCount) * 100)
    : buckets.length > 0 ? Math.round((progressedBuckets / buckets.length) * 100) : 0;
  const bucketSize = buckets.length > 0 ? Math.round(totalSize / buckets.length) : 0;

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

    const style = getComputedStyle(canvas);
    const cyan = style.getPropertyValue('--cyber-cyan').trim() || '0 240 255';
    const vermilion = style.getPropertyValue('--cyber-vermilion').trim() || '255 68 56';
    const bucketStates = Array.from({ length: cells }, (_, index) => {
      const sourceIndex = Math.min(buckets.length - 1, Math.floor(index * buckets.length / cells));
      return buckets[sourceIndex] ?? 0;
    });

    for (let index = 0; index < cells; index += 1) {
      const state = bucketStates[index];
      ctx.fillStyle =
        state === 1
          ? `rgb(${cyan} / 0.9)`
          : state === 2
            ? `rgb(${vermilion} / 0.9)`
            : 'rgba(30, 41, 59, 0.9)';
      ctx.fillRect((index % COLUMNS) * (CELL + GAP), Math.floor(index / COLUMNS) * (CELL + GAP), CELL, CELL);
    }
  }, [buckets, buckets.length, progressedBuckets]);

  return (
    <div className="flex flex-col p-3 bg-obsidian-900 border border-cyber-cyan/30 rounded-lg shadow-glow-cyan/20">
      <div className="flex items-center justify-between text-xs font-mono mb-2">
        <div className="flex items-center space-x-2 text-cyber-cyan font-bold">
          <span className="text-cyber-vermilion">🗿</span>
          <span>AHU OBSIDIAN BITMAP MATRIX</span>
        </div>
        <div className="text-[11px] text-slate-400">
          {pieceMapExact ? 'VERIFIED PIECES' : 'EST. BYTE PROGRESS'}:{' '}
          <span className="text-cyber-cyan font-bold">{percent}%</span> of {pieceCount.toLocaleString()}
        </div>
      </div>

      <div className="p-2 bg-obsidian-950/80 rounded border border-slate-800/80 overflow-auto max-h-[260px]">
        <canvas
          ref={canvasRef}
          aria-label={`${pieceMapExact ? 'Verified piece map' : 'Estimated byte progress map'}: ${percent} percent`}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-2">
        <span className="truncate max-w-[200px] text-slate-400">{torrentName}</span>
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-cyber-cyan" />
            <span>{pieceMapExact ? 'All pieces verified' : 'Completed estimate'}</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-cyber-vermilion" />
            <span>{pieceMapExact ? 'Mixed bucket' : 'Partial estimate'}</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-basalt-dark border border-slate-700" />
            <span>Pending</span>
          </span>
        </div>
      </div>

      <div className="mt-1 text-[9px] font-mono text-slate-500">
        {pieceMapExact ? 'Exact verified pieces grouped into' : 'Estimated byte progress in'}{' '}
        {buckets.length || 0} buckets; about {formatBytes(bucketSize, 1)} each
      </div>
    </div>
  );
};
