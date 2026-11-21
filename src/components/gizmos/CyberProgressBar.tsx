import React from 'react';

interface CyberProgressBarProps {
  progress: number; // 0 to 100
  height?: number; // px, default 8
  showSegments?: boolean;
  segmentsCount?: number;
  glowColor?: 'cyan' | 'green' | 'red' | 'gold';
  /** Coarse buckets from real haves, or a byte-progress estimate while initializing. */
  piecesBitfield?: number[];
  pieceMapExact?: boolean;
  className?: string;
}

export const CyberProgressBar: React.FC<CyberProgressBarProps> = ({
  progress,
  height = 8,
  showSegments = true,
  segmentsCount = 20,
  glowColor = 'cyan',
  piecesBitfield,
  pieceMapExact = false,
  className = '',
}) => {
  const clampedProgress = Math.max(0, Math.min(100, progress));

  const getGradient = () => {
    switch (glowColor) {
      case 'green':
        return 'from-cyber-teal via-cyber-green to-cyber-green';
      case 'red':
        return 'from-cyber-red via-cyber-vermilion to-cyber-red';
      case 'gold':
        return 'from-cyber-amber via-cyber-gold to-cyber-gold';
      default:
        return 'from-cyber-cyan via-cyber-cyan to-cyber-teal';
    }
  };

  const getGlow = () => {
    switch (glowColor) {
      case 'green':
        return 'rgb(var(--cyber-green) / 0.6)';
      case 'red':
        return 'rgb(var(--cyber-red) / 0.6)';
      case 'gold':
        return 'rgb(var(--cyber-gold) / 0.6)';
      default:
        return 'rgb(var(--cyber-cyan) / 0.6)';
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
            className="absolute inset-0 w-full h-full opacity-60 pointer-events-none anim-laser-scan"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.7) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
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

      {piecesBitfield && piecesBitfield.length > 0 && (
        <div
          className="flex w-full h-1 gap-[1px] bg-black/50 rounded overflow-hidden"
          role="img"
          aria-label={pieceMapExact ? 'Coarse map of verified piece ranges' : 'Estimated byte progress map'}
          title={pieceMapExact ? 'Coarse map sampled from verified pieces' : 'Estimated from verified byte progress while piece data is unavailable'}
        >
          {piecesBitfield.slice(0, 64).map((state, index) => (
            <div
              key={index}
              className={`flex-1 h-full transition-colors ${
                state === 1
                  ? 'bg-cyber-cyan shadow-glow-cyan'
                  : state === 2
                    ? 'bg-cyber-vermilion'
                    : 'bg-slate-900'
              }`}
            />
          ))}
        </div>
      )}

    </div>
  );
};
