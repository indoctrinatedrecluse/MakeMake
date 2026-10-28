import React, { useEffect, useRef, useState } from 'react';
import { MakeMakeIcon } from './gizmos/MakeMakeIcon';
import { Play, Sparkles } from 'lucide-react';

interface SplashScreenProps {
  onDismiss: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onDismiss }) => {
  const [videoError, setVideoError] = useState(false);
  const [bootStep, setBootStep] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Boot sequence lines
  const bootMessages = [
    'ALIGNING CELESTIAL POLYNESIAN WAYFINDING RADAR...',
    'EXCAVATING RANO KAU VOLCANIC OBSIDIAN CORE...',
    'CALIBRATING SHA-256 AHU MONOLITH HASH ARRAYS...',
    'ENGAGING TANGATA-MANU BIRDMAN SWARM PROTOCOL...',
    'MAKEMAKE CREATOR ENGINE // ONLINE & OPERATIONAL.',
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setBootStep((prev) => {
        if (prev < bootMessages.length - 1) return prev + 1;
        return prev;
      });
    }, 600);

    return () => clearInterval(timer);
  }, [bootMessages.length]);

  // Canvas-based animated cyber-Moai scene
  useEffect(() => {
    if (!videoError && false) return; // Keep canvas always rendering in background
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let time = 0;

    // Volcanic ash particles
    const particles = Array.from({ length: 65 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      size: Math.random() * 2.5 + 0.8,
      speedY: -(Math.random() * 1.2 + 0.4),
      speedX: (Math.random() - 0.5) * 0.5,
      alpha: Math.random() * 0.7 + 0.2,
      color: Math.random() > 0.4 ? '#00f0ff' : '#ff2a6d',
    }));

    const render = () => {
      time += 0.03;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2 - 20;

      // Volcanic dark sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      skyGrad.addColorStop(0, '#04060a');
      skyGrad.addColorStop(0.6, '#080d16');
      skyGrad.addColorStop(1, '#020305');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, h);

      // Distant Rano Kau Caldera horizon silhouette
      ctx.fillStyle = '#06090e';
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * 0.75);
      ctx.bezierCurveTo(w * 0.2, h * 0.7, w * 0.4, h * 0.82, w * 0.6, h * 0.74);
      ctx.bezierCurveTo(w * 0.8, h * 0.68, w * 0.9, h * 0.79, w, h * 0.75);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      // Atmospheric Laser Grid at bottom
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, h * 0.8);
        ctx.lineTo(cx + (i - cx) * 2.5, h);
        ctx.stroke();
      }

      // Draw Volcanic Ash Particles
      particles.forEach((p) => {
        p.y += p.speedY;
        p.x += p.speedX;
        if (p.y < 0) {
          p.y = h;
          p.x = Math.random() * w;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
      });

      // Central Cyber Moai Monolith Aura Glow
      const aura = ctx.createRadialGradient(cx, cy, 30, cx, cy, 260);
      aura.addColorStop(0, 'rgba(0, 240, 255, 0.18)');
      aura.addColorStop(0.5, 'rgba(255, 42, 109, 0.08)');
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, cy, 260, 0, Math.PI * 2);
      ctx.fill();

      // Animated Glowing Cybernetic Veins traversing the space
      ctx.save();
      const pulse = Math.sin(time * 2);
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.4 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 15;

      // Laser vein line left
      ctx.beginPath();
      ctx.moveTo(cx - 140, cy + 80);
      ctx.lineTo(cx - 90, cy + 40);
      ctx.lineTo(cx - 90, cy - 60);
      ctx.lineTo(cx - 40, cy - 100);
      ctx.stroke();

      // Laser vein line right
      ctx.strokeStyle = `rgba(255, 42, 109, ${0.4 - pulse * 0.2})`;
      ctx.shadowColor = '#ff2a6d';
      ctx.beginPath();
      ctx.moveTo(cx + 140, cy + 80);
      ctx.lineTo(cx + 90, cy + 40);
      ctx.lineTo(cx + 90, cy - 60);
      ctx.lineTo(cx + 40, cy - 100);
      ctx.stroke();
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [videoError]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-obsidian-950 overflow-hidden select-none">
      {/* Background Video Player (longer 10s video priority) */}
      {!videoError && (
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-60 z-0"
          onError={() => setVideoError(true)}
        >
          <source src="/splash-moai-longer.mp4" type="video/mp4" />
          <source src="/splash-moai.mp4" type="video/mp4" />
        </video>
      )}

      {/* Canvas Scene (Fallback or overlay) */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full z-1 pointer-events-none ${
          !videoError ? 'opacity-40' : 'opacity-100'
        }`}
      />

      {/* CRT Scanline & Vignette Overlay */}
      <div className="absolute inset-0 scanlines z-2 pointer-events-none opacity-70" />
      <div className="absolute inset-0 bg-radial-vignette pointer-events-none z-2" />

      {/* Top Cyber Telemetry Header */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <MakeMakeIcon size={38} color="cyan" glow />
          <div>
            <div className="text-sm font-bold font-cyber tracking-widest text-cyber-cyan text-cyber-glow-cyan">
              MAKEMAKE // PROTOCOL 0.1
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              RAPA NUI SWARM ENGINE // AHU MONOLITH SUITE
            </div>
          </div>
        </div>

        <div className="text-right font-mono text-[11px] text-slate-400">
          <div>COORDINATES: <span className="text-cyber-gold font-bold">27°07′S 109°22′W</span></div>
          <div className="text-cyber-green">TANGATA MANU DAEMON: ACTIVE</div>
        </div>
      </div>

      {/* Central Hero: Glowing Cybernetic Moai Face & Petroglyph Seal */}
      <div className="relative z-10 flex flex-col items-center justify-center my-auto px-4">
        <div className="relative mb-6 group cursor-pointer" onClick={onDismiss}>
          {/* Pulsing Outer Runic Tech Rings */}
          <div className="absolute -inset-10 rounded-full border border-cyber-cyan/30 animate-spin" style={{ animationDuration: '40s' }} />
          <div className="absolute -inset-6 rounded-full border border-cyber-red/30 animate-spin" style={{ animationDuration: '25s', animationDirection: 'reverse' }} />
          <div className="absolute -inset-2 rounded-full border border-dashed border-cyber-gold/40 animate-pulse" />

          {/* Central Thematic Moai Icon */}
          <div className="p-4 rounded-full bg-obsidian-900/90 border border-cyber-cyan shadow-glow-cyan">
            <MakeMakeIcon size={140} color="cyan" glow />
          </div>
        </div>

        <h1 className="text-4xl md:text-5xl font-black font-cyber tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyber-cyan via-white to-cyber-red drop-shadow-[0_0_25px_rgba(0,240,255,0.7)] text-center">
          MAKEMAKE
        </h1>

        <p className="mt-2 text-xs md:text-sm font-mono text-cyber-cyan/80 tracking-widest uppercase text-center max-w-xl">
          The Sacred Creator God of Rapa Nui • Reborn as a Hypermodern Swarm Client
        </p>

        {/* Live Terminal Boot Sequence */}
        <div className="mt-8 w-full max-w-lg p-3 rounded-lg bg-obsidian-950/90 border border-slate-800 text-[11px] font-mono shadow-obsidian-inner">
          <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-800 text-slate-400">
            <span className="text-cyber-gold font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              SYSTEM INITIALIZATION PROTOCOL
            </span>
            <span className="text-cyber-cyan animate-pulse">BOOTING...</span>
          </div>

          <div className="space-y-1">
            {bootMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`transition-all duration-300 ${
                  idx < bootStep
                    ? 'text-slate-400'
                    : idx === bootStep
                    ? 'text-cyber-cyan font-bold flex items-center space-x-1.5'
                    : 'text-slate-600'
                }`}
              >
                <span>{idx < bootStep ? '✔' : idx === bootStep ? '▶' : '○'}</span>
                <span>{msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Action Footer */}
      <div className="relative z-10 w-full max-w-4xl mx-auto pb-8 px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-[11px] font-mono text-slate-400 text-center md:text-left">
          <span>Drop custom video as </span>
          <code className="text-cyber-gold bg-slate-900 px-1 py-0.5 rounded">public/splash-moai.mp4</code>
          <span> for 4K live video backdrop</span>
        </div>

        <button
          onClick={onDismiss}
          className="cyber-button px-8 py-3 bg-gradient-to-r from-cyber-cyan to-cyber-teal text-black font-bold font-cyber text-sm tracking-widest uppercase flex items-center space-x-2 shadow-glow-cyan hover:scale-105 transition-all"
        >
          <Play className="w-4 h-4 fill-black" />
          <span>ENTER THE SWARM</span>
        </button>
      </div>
    </div>
  );
};
