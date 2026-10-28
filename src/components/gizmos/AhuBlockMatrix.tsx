import React from 'react';

interface AhuBlockMatrixProps {
  piecesBitfield: number[];
  pieceCount: number;
  totalSize: number;
  torrentName: string;
}

export const AhuBlockMatrix: React.FC<AhuBlockMatrixProps> = ({
  piecesBitfield = [],
  pieceCount = 64,
  totalSize = 0,
  torrentName = '',
}) => {
  const bitfield = Array.isArray(piecesBitfield) ? piecesBitfield : [];
  const pieceSize = pieceCount > 0 ? Math.round(totalSize / pieceCount) : 0;
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const completedCount = bitfield.filter((b) => b === 1).length;
  const percent = pieceCount > 0 ? Math.round((completedCount / pieceCount) * 100) : 0;

  return (
    <div className="flex flex-col p-3 bg-obsidian-900 border border-cyber-cyan/30 rounded-lg shadow-glow-cyan/20">
      <div className="flex items-center justify-between text-xs font-mono mb-2">
        <div className="flex items-center space-x-2 text-cyber-cyan font-bold">
          <span className="text-cyber-vermilion">🗿</span>
          <span>AHU OBSIDIAN BITMAP MATRIX</span>
        </div>
        <div className="text-[11px] text-slate-400">
          VERIFIED: <span className="text-cyber-cyan font-bold">{completedCount}</span> / {pieceCount} (
          <span className="text-cyber-gold font-bold">{percent}%</span>)
        </div>
      </div>

      {/* Matrix Grid */}
      <div className="grid grid-cols-16 gap-1 p-2 bg-obsidian-950/80 rounded border border-slate-800/80 max-h-[140px] overflow-y-auto">
        {Array.from({ length: pieceCount }, (_, i) => {
          const isDone = bitfield[i] === 1;
          const isCurrentTarget = !isDone && i === completedCount;
          return (
            <div
              key={i}
              title={`Piece #${i} - ${isDone ? 'SHA-VERIFIED' : isCurrentTarget ? 'DOWNLOADING' : 'MISSING'} (${formatBytes(pieceSize)})`}
              className={`h-3 rounded-[1px] transition-all duration-200 cursor-pointer ${
                isDone
                  ? 'bg-cyber-cyan shadow-[0_0_6px_rgba(0,240,255,0.6)]'
                  : isCurrentTarget
                  ? 'bg-cyber-vermilion animate-pulse shadow-[0_0_8px_rgba(255,68,56,0.8)]'
                  : 'bg-basalt-dark hover:bg-slate-700 border border-slate-800'
              }`}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-2">
        <span className="truncate max-w-[160px] text-slate-400">{torrentName}</span>
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-cyber-cyan" />
            <span>Verified</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-cyber-vermilion animate-pulse" />
            <span>Active Hopu</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-[1px] bg-basalt-dark border border-slate-700" />
            <span>Pending</span>
          </span>
        </div>
      </div>
    </div>
  );
};
