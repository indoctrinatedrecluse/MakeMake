import React, { useEffect, useRef, useState } from 'react';

interface PeerNode {
  id: string;
  angle: number;
  distance: number;
  pulsePhase: number;
}

/** Never plot more blips than the astrolabe can legibly show. */
const MAX_PLOTTED_PEERS = 40;

/**
 * Build the radar blips from the *real* connected peer count. Positions are
 * deterministic (golden-angle spiral) so the display does not jitter, and no
 * per-peer data is invented: every blip is one live connection reported by the
 * engine.
 */
const buildPeers = (count: number): PeerNode[] =>
  Array.from({ length: Math.max(0, Math.min(count, MAX_PLOTTED_PEERS)) }, (_, i) => ({
    id: `PEER_${(i + 1).toString().padStart(2, '0')}`,
    angle: ((i * 137.508) % 360) * (Math.PI / 180),
    distance: 0.22 + (((i * 0.61803398875) % 1) * 0.7),
    pulsePhase: (i * Math.PI) / 5,
  }));

export const SwarmAstrolabe: React.FC<{
  activeTorrentName?: string;
  activePeers?: number;
}> = ({ activeTorrentName, activePeers = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredPeer, setHoveredPeer] = useState<PeerNode | null>(null);

  // Celestial peer constellation driven by live librqbit peer counters.
  const peersRef = useRef<PeerNode[]>(buildPeers(activePeers));

  useEffect(() => {
    peersRef.current = buildPeers(activePeers);
  }, [activePeers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let rotation = 0;

    const render = () => {
      rotation += 0.003;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.min(centerX, centerY) - 15;

      ctx.clearRect(0, 0, width, height);

      // Background Radial Swell
      const grad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, maxRadius);
      grad.addColorStop(0, 'rgba(0, 240, 255, 0.08)');
      grad.addColorStop(0.7, 'rgba(8, 14, 24, 0.8)');
      grad.addColorStop(1, 'rgba(4, 6, 10, 0.95)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
      ctx.fill();

      // Astrolabe Wayfinding Concentric Rings
      [0.25, 0.5, 0.75, 1.0].forEach((ratio, idx) => {
        const r = maxRadius * ratio;
        ctx.strokeStyle = idx === 3 ? 'rgba(0, 240, 255, 0.4)' : 'rgba(0, 240, 255, 0.15)';
        ctx.lineWidth = idx === 3 ? 1.5 : 1;
        ctx.setLineDash(idx === 1 ? [4, 6] : idx === 2 ? [8, 12] : []);
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Cardinal Wayfinding Crosshairs (Polynesian Bearings)
      ctx.strokeStyle = 'rgba(255, 42, 109, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - maxRadius, centerY);
      ctx.lineTo(centerX + maxRadius, centerY);
      ctx.moveTo(centerX, centerY - maxRadius);
      ctx.lineTo(centerX, centerY + maxRadius);
      ctx.stroke();

      // Rotating Star Compass Needle / Radar Sweep
      const sweepAngle = rotation * 1.5;
      const sweepGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
      sweepGrad.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
      sweepGrad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, maxRadius, sweepAngle - 0.4, sweepAngle);
      ctx.closePath();
      ctx.fillStyle = sweepGrad;
      ctx.fill();
      ctx.restore();

      // Draw Tangata-Manu Peer Nodes & Connecting Arcs
      const peers = peersRef.current;
      peers.forEach((peer) => {
        peer.pulsePhase += 0.05;
        const currentAngle = peer.angle + rotation * 0.2;
        const x = centerX + Math.cos(currentAngle) * (peer.distance * maxRadius);
        const y = centerY + Math.sin(currentAngle) * (peer.distance * maxRadius);

        // Cybernetic Bezier Arc from center (Our Node) to Peer
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        const midX = (centerX + x) / 2 + Math.sin(peer.pulsePhase) * 10;
        const midY = (centerY + y) / 2 + Math.cos(peer.pulsePhase) * 10;
        ctx.quadraticCurveTo(midX, midY, x, y);
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Node Glow
        const pulse = 2 + Math.sin(peer.pulsePhase) * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, pulse + 1, 0, Math.PI * 2);
        ctx.fillStyle = '#00f0ff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Center Node (Makemake Sacred Core)
      ctx.beginPath();
      ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ff2a6d';
      ctx.shadowColor = '#ff2a6d';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(centerX, centerY, 10, 0, Math.PI * 2);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="relative flex flex-col items-center justify-center p-3 bg-obsidian-900 border border-cyber-cyan/30 rounded-lg overflow-hidden shadow-glow-cyan/20">
      <div className="absolute top-2 left-3 flex items-center space-x-2 text-xs font-mono text-cyber-cyan">
        <span className="w-2 h-2 rounded-full bg-cyber-cyan animate-ping" />
        <span className="font-bold tracking-wider">SWARM ASTROLABE // WAYFINDING</span>
      </div>

      <div className="absolute top-2 right-3 text-[10px] font-mono text-slate-400">
        BEARING: <span className="text-cyber-gold font-bold">109° E (RANO KAU)</span>
      </div>

      <canvas
        ref={canvasRef}
        width={260}
        height={260}
        className="w-[240px] h-[240px] cursor-crosshair mt-4"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left - 120;
          const y = e.clientY - rect.top - 120;
          const dist = Math.sqrt(x * x + y * y) / 110;
          const found = peersRef.current.find((p) => Math.abs(p.distance - dist) < 0.1);
          setHoveredPeer(found || null);
        }}
        onMouseLeave={() => setHoveredPeer(null)}
      />

      {/* Live Telemetry Footer */}
      <div className="w-full mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div>
          ACTIVE PEERS:{' '}
          <span className="text-cyber-cyan font-bold">
            {activePeers} {activePeers === 1 ? 'NODE' : 'NODES'}
          </span>
        </div>
        {hoveredPeer ? (
          <div className="text-cyber-gold font-bold">
            {hoveredPeer.id} : CONNECTED
          </div>
        ) : (
          <div className="text-slate-400 truncate max-w-[130px]">
            {activeTorrentName
              ? activeTorrentName.slice(0, 16) + '...'
              : activePeers > 0
              ? 'RADAR LOCK: OK'
              : 'STANDBY // NO PEERS'}
          </div>
        )}
      </div>
    </div>
  );
};
