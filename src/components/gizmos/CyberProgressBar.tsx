import React from 'react';

interface CyberProgressBarProps {
  progress: number; // 0 to 100
  height?: number; // px, default 8
  showSegments?: boolean;
  segmentsCount?: number;
  glowColor?: 'cyan' | 'green' | 'red' | 'gold';
  piecesBitfield?: number[];
  className?: string;
}

export const CyberProgressBar: React.FC<CyberProgressBarProps> = ({
  progress,
  height = 8,
  showSegments = true,
  segmentsCount = 20,
  glowColor = 'cyan',
  piecesBitfield,
  className = '',
}) => {
  const clampedProgress = Math.max(0, Math.min(100, progress));

  const getGradient = () => {
    switch (glowColor) {
      case 'green':
        return 'from-cyber-teal via-cyber-green to-emerald-400';
      case 'red':
        return 'from-cyber-red via-cyber-vermilion to-rose-400';
      case 'gold':
        return 'from-cyber-amber via-cyber-gold to-yellow-300';
      default:
        return 'from-blue-600 via-cyber-cyan to-cyber-teal';
    }
  };

  const getGlow = () => {
    switch (glowColor) {
      case 'green':
        return 'rgba(16, 255, 160, 0.6)';
      case 'red':
        return 'rgba(255, 42, 109, 0.6)';
      case 'gold':
        return 'rgba(255, 208, 0, 0.6)';
      default:
        return 'rgba(0, 240, 255, 0.6)';
    }
  };

  return (
    <div className={`w-full flex flex-col space-y-1 ${className}`}>
      {/* Outer Obsidian Basalt Track */}
      <div
        className="relative w-full rounded-[2px] bg-obsidian-950 border border-slate-800/90 overflow-hidden shadow-obsidian-inner"
        style={{ height: `${height}px` }}
      >
        {/* Underlay Micro-Pattern */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, #334155, #334155 1px, transparent 1px, transparent 6px)',
          }}
        />

        {/* Active Plasma Fill */}
        <div
          className={`h-full bg-gradient-to-r ${getGradient()} transition-all duration-300 relative`}
          style={{
            width: `${clampedProgress}%`,
            boxShadow: `0 0 12px ${getGlow()}`,
          }}
        >
          {/* Animated Laser Pulse Shimmer passing left to right */}
          <div
            className="absolute inset-0 w-full h-full opacity-60 pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.7) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'laserScan 2.2s linear infinite',
            }}
          />
        </div>

        {/* Tip Plasma Emitter (Glowing Spark Head) */}
        {clampedProgress > 1 && clampedProgress < 99.5 && (
          <div
            className="absolute top-0 bottom-0 w-1 bg-white transform -translate-x-1/2 shadow-[0_0_8px_#ffffff] z-10 animate-pulse"
            style={{ left: `${clampedProgress}%` }}
          />
        )}

        {/* High-Tech Capacitor Segment Dividers */}
        {showSegments && (
          <div className="absolute inset-0 flex pointer-events-none">
            {Array.from({ length: segmentsCount - 1 }).map((_, idx) => (
              <div
                key={idx}
                className="h-full border-r border-black/80"
                style={{ width: `${100 / segmentsCount}%` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Optional Integrated Mini Piece Heatmap */}
      {piecesBitfield && piecesBitfield.length > 0 && (
        <div className="flex w-full h-1 gap-[1px] bg-black/50 rounded overflow-hidden">
          {piecesBitfield.slice(0, 64).map((bit, i) => (
            <div
              key={i}
              className={`flex-1 h-full transition-colors ${
                bit === 1
                  ? 'bg-cyber-cyan shadow-[0_0_3px_#00f0ff]'
                  : 'bg-slate-900'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
