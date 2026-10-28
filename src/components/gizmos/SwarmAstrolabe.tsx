import React, { useEffect, useRef, useState } from 'react';

interface PeerNode {
  id: string;
  angle: number;
  distance: number;
  speed: number;
  country: string;
  isSeed: boolean;
  pulsePhase: number;
}

export const SwarmAstrolabe: React.FC<{ activeTorrentName?: string }> = ({ activeTorrentName }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredPeer, setHoveredPeer] = useState<PeerNode | null>(null);

  // Generate celestial peer constellation
  const peersRef = useRef<PeerNode[]>(
    Array.from({ length: 32 }, (_, i) => ({
      id: `PEER_${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      angle: Math.random() * Math.PI * 2,
      distance: 0.2 + Math.random() * 0.72,
      speed: Math.floor(Math.random() * 850) + 50,
      country: ['CL', 'NZ', 'PF', 'US', 'JP', 'DE', 'IS', 'AU', 'SG', 'BR'][i % 10],
      isSeed: i % 3 === 0,
      pulsePhase: Math.random() * Math.PI * 2,
    }))
  );

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
        ctx.strokeStyle = peer.isSeed ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255, 208, 0, 0.15)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Node Glow
        const pulse = 2 + Math.sin(peer.pulsePhase) * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, pulse + (peer.isSeed ? 2 : 1), 0, Math.PI * 2);
        ctx.fillStyle = peer.isSeed ? '#00f0ff' : '#ffd000';
        ctx.shadowColor = peer.isSeed ? '#00f0ff' : '#ffd000';
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
          ACTIVE PEERS: <span className="text-cyber-cyan font-bold">32 NODES</span>
        </div>
        {hoveredPeer ? (
          <div className="text-cyber-gold font-bold">
            [{hoveredPeer.country}] {hoveredPeer.id} : {hoveredPeer.speed} KB/s
          </div>
        ) : (
          <div className="text-slate-400 truncate max-w-[130px]">
            {activeTorrentName ? activeTorrentName.slice(0, 16) + '...' : 'RADAR LOCK: OK'}
          </div>
        )}
      </div>
    </div>
  );
};
