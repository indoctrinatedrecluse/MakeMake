import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TorrentItem, SystemStats } from '../../types/torrent';

/**
 * One plotted swarm. The radius encodes completion (rim = 0 %, core = 100 %) and the
 * colour encodes the live engine state, so the astrolabe is a real at-a-glance map of
 * the queue instead of decoration.
 */
interface SwarmBlip {
  id: string;
  label: string;
  angle: number;
  distance: number;
  progress: number;
  colour: string;
  status: TorrentItem['status'];
  speed: number;
  selected: boolean;
  x: number;
  y: number;
}

/** Plotted swarms are capped so the dial stays legible. */
const MAX_PLOTTED_SWARMS = 48;

const COLOURS: Record<string, string> = {
  Downloading: '#00f0ff',
  Seeding: '#10ffa0',
  Paused: '#64748b',
  Checking: '#ffd000',
  Queued: '#e5b869',
  Completed: '#10ffa0',
  Error: '#ff2a6d',
};

/** Stable pseudo-random bearing for a swarm, derived from its info hash. */
const hashToAngle = (seed: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return ((hash % 4096) / 4096) * Math.PI * 2;
};

const formatSpeed = (bytesPerSecond: number): string => {
  if (!bytesPerSecond) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const SwarmAstrolabe: React.FC<{
  activeTorrentName?: string;
  activePeers?: number;
  torrents?: TorrentItem[];
  stats?: SystemStats;
}> = ({ activeTorrentName, activePeers = 0, torrents = [], stats }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hovered, setHovered] = useState<SwarmBlip | null>(null);

  const plotted = useMemo(() => torrents.slice(0, MAX_PLOTTED_SWARMS), [torrents]);

  // Latest geometry, written by the render loop so hover hit-testing can reuse it.
  const dataRef = useRef<{ blips: SwarmBlip[] }>({ blips: [] });
  // Hover is read through a ref so hovering never restarts (and rewinds) the sweep.
  const hoveredRef = useRef<SwarmBlip | null>(null);

  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  useEffect(() => {
    dataRef.current.blips = plotted.map((torrent) => {
      const ratio = Math.max(0, Math.min(100, torrent.progress)) / 100;
      return {
        id: torrent.infoHash,
        label: torrent.name,
        status: torrent.status,
        progress: torrent.progress,
        speed: torrent.downloadSpeed + torrent.uploadSpeed,
        colour: COLOURS[torrent.status] ?? '#00f0ff',
        selected: !!activeTorrentName && activeTorrentName === torrent.name,
        // Rim = freshly started, core = verified.
        distance: 1 - ratio * 0.84,
        angle: hashToAngle(torrent.infoHash),
        x: 0,
        y: 0,
      };
    });
  }, [plotted, activeTorrentName]);

  const activeSwarms = plotted.filter(
    (t) => t.status === 'Downloading' || t.status === 'Seeding',
  ).length;
  const downloading = plotted.filter((t) => t.status === 'Downloading').length;
  const paused = plotted.filter((t) => t.status === 'Paused').length;
  const completed = plotted.filter((t) => t.progress >= 100).length;
  const mode = activeSwarms > 0 ? 'LIVE' : plotted.length > 0 ? 'DORMANT' : 'STANDBY';
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let sweep = 0;

    const render = () => {
      sweep += 0.012;
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(cx, cy) - 20;
      const blips = dataRef.current.blips;

      ctx.clearRect(0, 0, width, height);

      // Chamber swell
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, maxRadius);
      grad.addColorStop(0, 'rgba(0, 240, 255, 0.10)');
      grad.addColorStop(0.65, 'rgba(8, 14, 24, 0.9)');
      grad.addColorStop(1, 'rgba(4, 6, 10, 0.98)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
      ctx.fill();

      // Completion rings: rim = 0 %, core = 100 %
      [0.16, 0.37, 0.58, 0.79, 1].forEach((ratio, idx) => {
        ctx.strokeStyle = idx === 4 ? 'rgba(0, 240, 255, 0.45)' : 'rgba(0, 240, 255, 0.14)';
        ctx.lineWidth = idx === 4 ? 1.5 : 1;
        ctx.setLineDash(idx === 0 ? [2, 5] : idx === 2 ? [6, 9] : []);
        ctx.beginPath();
        ctx.arc(cx, cy, maxRadius * ratio, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Completion labels (real percentages at each ring)
      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.font = '18px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      [0, 25, 50, 75, 100].forEach((pct, idx) => {
        const ratio = [1, 0.79, 0.58, 0.37, 0.16][idx];
        ctx.fillText(`${pct}`, cx + maxRadius * ratio + 7, cy - 10);
      });

      // Cardinal bearings
      ctx.strokeStyle = 'rgba(255, 42, 109, 0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - maxRadius, cy);
      ctx.lineTo(cx + maxRadius, cy);
      ctx.moveTo(cx, cy - maxRadius);
      ctx.lineTo(cx, cy + maxRadius);
      ctx.stroke();

      // Radar sweep
      const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
      sweepGrad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
      sweepGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxRadius, sweep, sweep + 0.6);
      ctx.closePath();
      ctx.fillStyle = sweepGrad;
      ctx.fill();

      // Swarm blips
      blips.forEach((blip) => {
        const x = cx + Math.cos(blip.angle) * maxRadius * blip.distance;
        const y = cy + Math.sin(blip.angle) * maxRadius * blip.distance;
        blip.x = x;
        blip.y = y;

        const transferring = blip.status === 'Downloading' || blip.status === 'Seeding';
        if (transferring) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.quadraticCurveTo((cx + x) / 2, (cy + y) / 2 - 8, x, y);
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // Faster swarms pulse faster, so the rhythm carries real information.
        const pulse = 3 + Math.sin(sweep * (blip.speed > 0 ? 6 : 2) + blip.angle) * 1.6;
        ctx.beginPath();
        ctx.arc(x, y, pulse + (blip.selected ? 2.5 : 0), 0, Math.PI * 2);
        ctx.fillStyle = blip.colour;
        ctx.shadowColor = blip.colour;
        ctx.shadowBlur = blip.selected ? 16 : 9;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (blip.selected) {
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 208, 0, 0.85)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      });

      // Hovered blip gets a bearing callout
      const active = hoveredRef.current;
      if (active) {
        const target = blips.find((blip) => blip.id === active.id);
        if (target) {
          ctx.beginPath();
          ctx.arc(target.x, target.y, 13, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 208, 0, 0.75)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Local node (ourselves)
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ff2a6d';
      ctx.shadowColor = '#ff2a6d';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(cx, cy, 10.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);
  return (
    <div className="relative flex flex-col p-3 bg-obsidian-900 border border-cyber-cyan/30 rounded-lg overflow-hidden shadow-glow-cyan/20">
      {/* Header: one flex row, so nothing can ever overlap the title */}
      <div className="flex items-center justify-between gap-2 min-w-0 text-[10px] font-mono">
        <div className="flex items-center gap-1.5 min-w-0 text-cyber-cyan">
          <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-cyber-cyan animate-pulse" />
          <span className="font-bold tracking-wider truncate">SWARM ASTROLABE</span>
        </div>
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold ${
            mode === 'LIVE'
              ? 'border-cyber-green/50 bg-cyber-green/10 text-cyber-green'
              : mode === 'DORMANT'
              ? 'border-cyber-amber/40 bg-cyber-amber/10 text-cyber-amber'
              : 'border-slate-700 bg-obsidian-950 text-slate-500'
          }`}
        >
          {mode}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={440}
        height={440}
        className="mx-auto mt-1.5 w-[220px] h-[220px] cursor-crosshair"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = 440 / Math.max(1, rect.width);
          const x = (e.clientX - rect.left) * scale;
          const y = (e.clientY - rect.top) * scale;
          let nearest: SwarmBlip | null = null;
          let nearestDistance = 18;
          dataRef.current.blips.forEach((blip) => {
            const distance = Math.hypot(blip.x - x, blip.y - y);
            if (distance < nearestDistance) {
              nearest = blip;
              nearestDistance = distance;
            }
          });
          setHovered(nearest);
        }}
        onMouseLeave={() => setHovered(null)}
      />

      {/* Legend — every colour maps to a real engine state */}
      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] font-mono">
        <span className="flex items-center gap-1 text-slate-400">
          <i className="w-1.5 h-1.5 rounded-full bg-cyber-cyan inline-block" /> LEECH {downloading}
        </span>
        <span className="flex items-center gap-1 text-slate-400">
          <i className="w-1.5 h-1.5 rounded-full bg-cyber-green inline-block" /> SEED {completed}
        </span>
        <span className="flex items-center gap-1 text-slate-400">
          <i className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block" /> PAUSED {paused}
        </span>
        <span className="flex items-center gap-1 text-slate-400">
          <i className="w-1.5 h-1.5 rounded-full bg-cyber-red inline-block" /> LOCAL NODE
        </span>
      </div>
      <div className="mt-1 text-[9px] font-mono text-slate-500">
        RIM = 0% · CORE = 100% VERIFIED
      </div>

      {/* Hover readout (fixed height, so the panel never reflows) */}
      <div className="mt-1.5 h-4 text-[10px] font-mono truncate">
        {hovered ? (
          <span className="text-cyber-gold">
            {hovered.label} · {hovered.progress.toFixed(1)}% · {hovered.status.toUpperCase()}
          </span>
        ) : (
          <span className="text-slate-500">
            {plotted.length > 0
              ? `${plotted.length} SWARM${plotted.length === 1 ? '' : 'S'} PLOTTED`
              : 'AWAITING SWARM INGESTION'}
          </span>
        )}
      </div>

      {/* Live telemetry footer */}
      <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 space-y-0.5 text-[10px] font-mono">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">DOWN</span>
          <span className="text-cyber-cyan font-bold">
            {formatSpeed(stats?.globalDownloadSpeed ?? 0)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">UP</span>
          <span className="text-cyber-green font-bold">
            {formatSpeed(stats?.globalUploadSpeed ?? 0)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">PEERS / DHT</span>
          <span className="text-slate-300">
            {activePeers} / {stats?.dhtNodes ?? 0}
          </span>
        </div>
      </div>
    </div>
  );
};


