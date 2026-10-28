import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Activity } from 'lucide-react';

interface SpeedSample {
  time: number;
  download: number; // bytes/sec
  upload: number;   // bytes/sec
}

interface SpeedOscilloscopeProps {
  currentDownloadSpeed: number;
  currentUploadSpeed: number;
  maxHistorySeconds?: number;
}

export const SpeedOscilloscope: React.FC<SpeedOscilloscopeProps> = ({
  currentDownloadSpeed,
  currentUploadSpeed,
  maxHistorySeconds = 60,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<SpeedSample[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<{ dl: number; ul: number; timeSecAgo: number } | null>(null);

  // Maintain circular time-series buffer
  useEffect(() => {
    const now = Date.now();
    historyRef.current.push({
      time: now,
      download: currentDownloadSpeed,
      upload: currentUploadSpeed,
    });

    if (historyRef.current.length > maxHistorySeconds) {
      historyRef.current.shift();
    }
  }, [currentDownloadSpeed, currentUploadSpeed, maxHistorySeconds]);

  // Render loop for high-tech telemetry oscilloscope
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Background grid & cyber scanlines
      ctx.fillStyle = '#060a10';
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
      ctx.lineWidth = 1;
      const horizontalDivs = 4;
      for (let i = 1; i < horizontalDivs; i++) {
        const y = (height / horizontalDivs) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const verticalDivs = 6;
      for (let i = 1; i < verticalDivs; i++) {
        const x = (width / verticalDivs) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      const history = historyRef.current;
      if (history.length < 2) {
        animId = requestAnimationFrame(render);
        return;
      }

      // Calculate peak speed for dynamic scaling
      const maxSampleSpeed = Math.max(
        ...history.map((s) => Math.max(s.download, s.upload)),
        1024 * 1024 // min 1MB/s scale
      );
      const topScale = maxSampleSpeed * 1.15;

      const getX = (idx: number) => (idx / (maxHistorySeconds - 1)) * width;
      const getY = (val: number) => height - (val / topScale) * (height - 20) - 10;

      // Draw Download Waveform (Cyan)
      // Gradient Fill
      const dlGrad = ctx.createLinearGradient(0, 0, 0, height);
      dlGrad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
      dlGrad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

      ctx.beginPath();
      ctx.moveTo(0, height);
      history.forEach((sample, i) => {
        const x = getX(i);
        const y = getY(sample.download);
        if (i === 0) ctx.lineTo(x, y);
        else {
          const prevX = getX(i - 1);
          const prevY = getY(history[i - 1].download);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.lineTo(getX(history.length - 1), height);
      ctx.closePath();
      ctx.fillStyle = dlGrad;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      history.forEach((sample, i) => {
        const x = getX(i);
        const y = getY(sample.download);
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = getX(i - 1);
          const prevY = getY(history[i - 1].download);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw Upload Waveform (Vermilion Red)
      const ulGrad = ctx.createLinearGradient(0, 0, 0, height);
      ulGrad.addColorStop(0, 'rgba(255, 42, 109, 0.25)');
      ulGrad.addColorStop(1, 'rgba(255, 42, 109, 0.0)');

      ctx.beginPath();
      ctx.moveTo(0, height);
      history.forEach((sample, i) => {
        const x = getX(i);
        const y = getY(sample.upload);
        if (i === 0) ctx.lineTo(x, y);
        else {
          const prevX = getX(i - 1);
          const prevY = getY(history[i - 1].upload);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.lineTo(getX(history.length - 1), height);
      ctx.closePath();
      ctx.fillStyle = ulGrad;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      history.forEach((sample, i) => {
        const x = getX(i);
        const y = getY(sample.upload);
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = getX(i - 1);
          const prevY = getY(history[i - 1].upload);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.strokeStyle = '#ff2a6d';
      ctx.lineWidth = 1.8;
      ctx.shadowColor = '#ff2a6d';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Latest Tip Indicator Points
      const lastIdx = history.length - 1;
      const lastDlX = getX(lastIdx);
      const lastDlY = getY(history[lastIdx].download);
      ctx.beginPath();
      ctx.arc(lastDlX, lastDlY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.fill();

      const lastUlY = getY(history[lastIdx].upload);
      ctx.beginPath();
      ctx.arc(lastDlX, lastUlY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ff2a6d';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [maxHistorySeconds]);

  const formatSpeed = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B/s`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  return (
    <div className="relative flex flex-col p-3 rounded-lg bg-obsidian-950/90 border border-slate-800 shadow-obsidian-inner overflow-hidden font-mono">
      {/* Oscilloscope Header Telemetry */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs">
        <div className="flex items-center space-x-2 text-cyber-cyan font-bold">
          <Activity className="w-4 h-4 animate-pulse" />
          <span>VOLCANIC CALDERA SPEED OSCILLOSCOPE</span>
        </div>

        <div className="flex items-center space-x-4 text-[11px]">
          <div className="flex items-center space-x-1.5 text-cyber-cyan">
            <ArrowDown className="w-3.5 h-3.5" />
            <span>DL: <strong>{formatSpeed(currentDownloadSpeed)}</strong></span>
          </div>
          <div className="flex items-center space-x-1.5 text-cyber-red">
            <ArrowUp className="w-3.5 h-3.5" />
            <span>UL: <strong>{formatSpeed(currentUploadSpeed)}</strong></span>
          </div>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className="relative w-full h-36">
        <canvas
          ref={canvasRef}
          width={640}
          height={144}
          className="w-full h-full rounded border border-slate-800/80 cursor-crosshair"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const history = historyRef.current;
            const targetIdx = Math.floor(relX * (history.length - 1));
            if (history[targetIdx]) {
              setHoveredPoint({
                dl: history[targetIdx].download,
                ul: history[targetIdx].upload,
                timeSecAgo: history.length - targetIdx,
              });
            }
          }}
          onMouseLeave={() => setHoveredPoint(null)}
        />

        {/* Hover Scrub Tooltip */}
        {hoveredPoint && (
          <div className="absolute top-2 left-3 px-2 py-1 rounded bg-obsidian-900/90 border border-cyber-cyan/50 text-[10px] shadow-lg pointer-events-none flex items-center space-x-3">
            <span className="text-slate-400">-{hoveredPoint.timeSecAgo}s ago:</span>
            <span className="text-cyber-cyan font-bold">DL: {formatSpeed(hoveredPoint.dl)}</span>
            <span className="text-cyber-red font-bold">UL: {formatSpeed(hoveredPoint.ul)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2">
        <span>-60 SECONDS</span>
        <span className="text-cyber-gold font-bold">BUFFER: REALTIME PACIFIC WAVE SPECTRUM</span>
        <span>NOW (0s)</span>
      </div>
    </div>
  );
};
