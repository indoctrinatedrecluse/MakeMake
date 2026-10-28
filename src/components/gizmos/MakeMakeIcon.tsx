import React from 'react';

interface MakeMakeIconProps {
  className?: string;
  size?: number;
  glow?: boolean;
  color?: 'cyan' | 'red' | 'gold';
}

export const MakeMakeIcon: React.FC<MakeMakeIconProps> = ({
  className = '',
  size = 32,
  glow = true,
  color = 'cyan',
}) => {
  const glowFilter = glow
    ? color === 'red'
      ? 'drop-shadow(0 0 8px rgba(255, 42, 109, 0.8))'
      : color === 'gold'
      ? 'drop-shadow(0 0 8px rgba(255, 208, 0, 0.8))'
      : 'drop-shadow(0 0 8px rgba(0, 240, 255, 0.8))'
    : 'none';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block transition-all duration-300 ${className}`}
      style={{ filter: glowFilter }}
    >
      <defs>
        <radialGradient id={`bgGlow_${color}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#111c2e" />
          <stop offset="100%" stopColor="#05080e" />
        </radialGradient>

        <linearGradient id={`obsidianGrad_${color}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#303b4d" />
          <stop offset="50%" stopColor="#161c28" />
          <stop offset="100%" stopColor="#0a0d13" />
        </linearGradient>

        <linearGradient id={`pukaoGrad_${color}`} x1="0%" y1="0%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#ff4466" />
          <stop offset="50%" stopColor="#ff1744" />
          <stop offset="100%" stopColor="#88001a" />
        </linearGradient>
      </defs>

      {/* Outer Cyber Tech Ring */}
      <circle cx="256" cy="256" r="248" fill={`url(#bgGlow_${color})`} stroke="#1e293b" strokeWidth="6" />
      <circle cx="256" cy="256" r="236" fill="none" stroke="#00f0ff" strokeWidth="2" strokeDasharray="16 10" opacity="0.6" />
      <circle cx="256" cy="256" r="222" fill="none" stroke="#ff2a6d" strokeWidth="1.5" strokeDasharray="8 24 32 8" opacity="0.4" />

      {/* Tangata-Manu Petroglyph Wings Background */}
      <path d="M 64,340 C 94,260 164,220 224,240 C 184,270 124,320 84,420 Z" fill="#131b26" stroke="#00f0ff" strokeWidth="2" opacity="0.7" />
      <path d="M 448,340 C 418,260 348,220 288,240 C 328,270 388,320 428,420 Z" fill="#131b26" stroke="#00f0ff" strokeWidth="2" opacity="0.7" />

      {/* PUKAO (Red Scoria Cyber Cylinder / Topknot on Head) */}
      <polygon points="186,88 326,88 338,130 174,130" fill={`url(#pukaoGrad_${color})`} stroke="#ff7799" strokeWidth="2" />
      <ellipse cx="256" cy="88" rx="70" ry="14" fill="#ff4466" />
      <rect x="236" y="98" width="40" height="20" rx="3" fill="#110006" stroke="#ff2a6d" strokeWidth="1.5" />
      <line x1="244" y1="108" x2="268" y2="108" stroke="#ffffff" strokeWidth="2" />

      {/* MOAI HEAD MONOLITH MAIN BODY */}
      <polygon
        points="
          184,132 328,132 
          334,168 316,210 
          322,300 306,370 
          312,410 286,436 
          226,436 200,410 
          206,370 190,300 
          196,210 178,168
        "
        fill={`url(#obsidianGrad_${color})`}
        stroke="#475569"
        strokeWidth="3"
      />

      {/* Moai Severe Brow */}
      <polygon points="196,206 316,206 308,232 204,232" fill="#1e293b" stroke="#00f0ff" strokeWidth="1.5" />

      {/* Deep-Set Glowing Optics */}
      <polygon points="208,236 244,238 240,256 212,254" fill="#080c12" stroke="#00f0ff" strokeWidth="1.5" />
      <rect x="216" y="244" width="20" height="6" rx="2" fill="#00f0ff" />

      <polygon points="268,238 304,236 300,254 272,256" fill="#080c12" stroke="#00f0ff" strokeWidth="1.5" />
      <rect x="276" y="244" width="20" height="6" rx="2" fill="#00f0ff" />

      {/* High-Bridge Moai Nose with Chiseled Cyber Line */}
      <polygon points="244,228 268,228 274,330 256,346 238,330" fill="#243142" stroke="#475c75" strokeWidth="1.5" />
      <line x1="256" y1="230" x2="256" y2="340" stroke="#00f0ff" strokeWidth="2" opacity="0.8" />

      {/* Thin Stern Lip & Square Heavy Jaw */}
      <line x1="236" y1="368" x2="276" y2="368" stroke="#ff2a6d" strokeWidth="2" />
      <polygon points="214,394 298,394 284,424 228,424" fill="#18212e" stroke="#00f0ff" strokeWidth="1.5" />

      {/* Cyber Circuitry on Cheeks */}
      <path d="M 204,280 L 226,294 L 226,334 L 216,344" fill="none" stroke="#00f0ff" strokeWidth="2" />
      <circle cx="216" cy="344" r="3" fill="#00f0ff" />
      <path d="M 308,280 L 286,294 L 286,334 L 296,344" fill="none" stroke="#00f0ff" strokeWidth="2" />
      <circle cx="296" cy="344" r="3" fill="#00f0ff" />

      {/* Rongorongo Base Pedestal */}
      <rect x="160" y="444" width="192" height="24" rx="4" fill="#0b1017" stroke="#00f0ff" strokeWidth="2" />
      <circle cx="212" cy="456" r="4" fill="none" stroke="#ffd000" strokeWidth="2" />
      <path d="M 230,452 L 246,452 M 238,452 L 238,460" stroke="#00f0ff" strokeWidth="2" />
      <path d="M 266,452 L 282,460 M 266,460 L 282,452" stroke="#ff2a6d" strokeWidth="2" />
      <circle cx="300" cy="456" r="4" fill="none" stroke="#ffd000" strokeWidth="2" />
    </svg>
  );
};
