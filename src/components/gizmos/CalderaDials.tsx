import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

interface CalderaDialsProps {
  downloadSpeed: number; // bytes/sec
  uploadSpeed: number; // bytes/sec
}

export const CalderaDials: React.FC<CalderaDialsProps> = ({ downloadSpeed, uploadSpeed }) => {
  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec < 1024) return { val: bytesPerSec.toString(), unit: 'B/s' };
    if (bytesPerSec < 1024 * 1024) return { val: (bytesPerSec / 1024).toFixed(1), unit: 'KB/s' };
    return { val: (bytesPerSec / (1024 * 1024)).toFixed(1), unit: 'MB/s' };
  };

  const dl = formatSpeed(downloadSpeed);
  const ul = formatSpeed(uploadSpeed);

  // Normalizing to 0-100% of a 50MB/s pipe
  const dlPercent = Math.min(100, (downloadSpeed / (50 * 1024 * 1024)) * 100);
  const ulPercent = Math.min(100, (uploadSpeed / (20 * 1024 * 1024)) * 100);

  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const dlOffset = circumference - (dlPercent / 100) * circumference * 0.75;
  const ulOffset = circumference - (ulPercent / 100) * circumference * 0.75;

  return (
    <div className="flex items-center space-x-3 p-2 bg-obsidian-900 border border-slate-800 rounded-lg">
      {/* Download Caldera Dial */}
      <div className="flex items-center space-x-2">
        <div className="relative w-14 h-14 flex items-center justify-center">
          <svg className="w-14 h-14 -rotate-90 transform" viewBox="0 0 80 80">
            {/* Background Track */}
            <circle
              cx="40"
              cy="40"
              r={radius}
              stroke="#131c29"
              strokeWidth="6"
              fill="none"
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            />
            {/* Active Glow Arc */}
            <circle
              cx="40"
              cy="40"
              r={radius}
              stroke="#00f0ff"
              strokeWidth="6"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={dlOffset}
              strokeLinecap="round"
              className="transition-all duration-500 shadow-glow-cyan"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <ArrowDown className="w-3 h-3 text-cyber-cyan animate-bounce" />
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-slate-400 font-mono">DL SWELL</span>
          <div className="flex items-baseline space-x-1">
            <span className="text-sm font-bold font-mono text-cyber-cyan text-cyber-glow-cyan">{dl.val}</span>
            <span className="text-[9px] text-slate-400 font-mono">{dl.unit}</span>
          </div>
        </div>
      </div>

      <div className="h-8 w-[1px] bg-slate-800" />

      {/* Upload Caldera Dial */}
      <div className="flex items-center space-x-2">
        <div className="relative w-14 h-14 flex items-center justify-center">
          <svg className="w-14 h-14 -rotate-90 transform" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r={radius}
              stroke="#131c29"
              strokeWidth="6"
              fill="none"
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            />
            <circle
              cx="40"
              cy="40"
              r={radius}
              stroke="#ff2a6d"
              strokeWidth="6"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={ulOffset}
              strokeLinecap="round"
              className="transition-all duration-500 shadow-glow-red"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <ArrowUp className="w-3 h-3 text-cyber-red animate-pulse" />
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-slate-400 font-mono">UL SEED</span>
          <div className="flex items-baseline space-x-1">
            <span className="text-sm font-bold font-mono text-cyber-red text-cyber-glow-red">{ul.val}</span>
            <span className="text-[9px] text-slate-400 font-mono">{ul.unit}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
