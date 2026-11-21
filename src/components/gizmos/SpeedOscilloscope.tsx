import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Activity } from 'lucide-react';
import { formatSpeed } from '../../utils/format';

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
  const speedsRef = useRef({ download: currentDownloadSpeed, upload: currentUploadSpeed });
  const [hoveredPoint, setHoveredPoint] = useState<{ dl: number; ul: number; timeSecAgo: number } | null>(null);

  useEffect(() => {
    speedsRef.current = { download: currentDownloadSpeed, upload: currentUploadSpeed };
  }, [currentDownloadSpeed, currentUploadSpeed]);

  // Sample on the clock, including zero-speed periods, so the plotted x-axis represents time.
  useEffect(() => {
    const sample = () => {
      const now = Date.now();
      const speeds = speedsRef.current;
      historyRef.current.push({ time: now, ...speeds });
      const cutoff = now - maxHistorySeconds * 1000;
      historyRef.current = historyRef.current.filter((point) => point.time >= cutoff);
    };
    sample();
    const timer = window.setInterval(sample, 1000);
    return () => window.clearInterval(timer);
  }, [maxHistorySeconds]);

  // Render loop for high-tech telemetry oscilloscope
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let drawTimer: number | undefined;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const palette = getComputedStyle(canvas);
      const cyan = palette.getPropertyValue('--cyber-cyan').trim() || '0 240 255';
      const red = palette.getPropertyValue('--cyber-red').trim() || '255 42 109';
      const surface = palette.getPropertyValue('--obsidian-950').trim() || '5 7 10';
      ctx.clearRect(0, 0, width, height);

      // Background grid & cyber scanlines
      ctx.fillStyle = `rgb(${surface})`;
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = `rgb(${palette.getPropertyValue('--obsidian-600').trim() || '40 53 76'} / 0.4)`;
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
        return;
      }

      // Calculate peak speed for dynamic scaling
      const maxSampleSpeed = Math.max(
        ...history.map((s) => Math.max(s.download, s.upload)),
        1024 * 1024 // min 1MB/s scale
      );
      const topScale = maxSampleSpeed * 1.15;

      const windowEnd = history[history.length - 1].time;
      const windowStart = windowEnd - maxHistorySeconds * 1000;
      const getX = (sample: SpeedSample) =>
        Math.max(0, Math.min(width, ((sample.time - windowStart) / (maxHistorySeconds * 1000)) * width));
      const getY = (val: number) => height - (val / topScale) * (height - 20) - 10;

      // Draw Download Waveform (Cyan)
      // Gradient Fill
      const dlGrad = ctx.createLinearGradient(0, 0, 0, height);
      dlGrad.addColorStop(0, `rgb(${cyan} / 0.35)`);
      dlGrad.addColorStop(1, `rgb(${cyan} / 0)`);

      ctx.beginPath();
      ctx.moveTo(0, height);
      history.forEach((sample, i) => {
        const x = getX(sample);
        const y = getY(sample.download);
        if (i === 0) ctx.lineTo(x, y);
        else {
          const prevX = getX(history[i - 1]);
          const prevY = getY(history[i - 1].download);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.lineTo(getX(history[history.length - 1]), height);
      ctx.closePath();
      ctx.fillStyle = dlGrad;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      history.forEach((sample, i) => {
        const x = getX(sample);
        const y = getY(sample.download);
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = getX(history[i - 1]);
          const prevY = getY(history[i - 1].download);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.strokeStyle = `rgb(${cyan})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = `rgb(${cyan})`;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw Upload Waveform (Vermilion Red)
      const ulGrad = ctx.createLinearGradient(0, 0, 0, height);
      ulGrad.addColorStop(0, `rgb(${red} / 0.25)`);
      ulGrad.addColorStop(1, `rgb(${red} / 0)`);

      ctx.beginPath();
      ctx.moveTo(0, height);
      history.forEach((sample, i) => {
        const x = getX(sample);
        const y = getY(sample.upload);
        if (i === 0) ctx.lineTo(x, y);
        else {
          const prevX = getX(history[i - 1]);
          const prevY = getY(history[i - 1].upload);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.lineTo(getX(history[history.length - 1]), height);
      ctx.closePath();
      ctx.fillStyle = ulGrad;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      history.forEach((sample, i) => {
        const x = getX(sample);
        const y = getY(sample.upload);
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = getX(history[i - 1]);
          const prevY = getY(history[i - 1].upload);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      });
      ctx.strokeStyle = `rgb(${red})`;
      ctx.lineWidth = 1.8;
      ctx.shadowColor = `rgb(${red})`;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Latest Tip Indicator Points
      const lastIdx = history.length - 1;
      const lastDlX = getX(history[lastIdx]);
      const lastDlY = getY(history[lastIdx].download);
      ctx.beginPath();
      ctx.arc(lastDlX, lastDlY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = `rgb(${cyan})`;
      ctx.shadowBlur = 8;
      ctx.fill();

      const lastUlY = getY(history[lastIdx].upload);
      ctx.beginPath();
      ctx.arc(lastDlX, lastUlY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = `rgb(${red})`;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

    };

    render();
    drawTimer = window.setInterval(render, 1000);
    return () => {
      if (drawTimer !== undefined) window.clearInterval(drawTimer);
    };
  }, [maxHistorySeconds]);

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
            const targetIdx = Math.max(0, Math.min(history.length - 1, Math.floor(relX * (history.length - 1))));
            if (history[targetIdx]) {
              setHoveredPoint({
                dl: history[targetIdx].download,
                ul: history[targetIdx].upload,
                timeSecAgo: Math.max(0, Math.round((Date.now() - history[targetIdx].time) / 1000)),
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
