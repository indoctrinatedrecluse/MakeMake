import React, { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

const RONGORONGO_SYMBOLS = ['𓇽', '𓆇', '𓅭', '𓋹', '𓎛', '𓐍', 'ᚱ', 'ᛃ', 'ᛏ', 'ᛒ', '⚡', '✦', '▲', '◆', '◈'];

const LOG_TEMPLATES = [
  '[DHT] Announce broadcast to 9,142 routing nodes // OK',
  '[SWARM] Handshake peer 178.62.x.x // BEP-10 extension verified',
  '[CRYPTO] Decrypting MSE handshake payload via ARC4 stream',
  '[TANGATA-MANU] Rare piece #42 secured from Motu-Nui seeder',
  '[BACKUP-DAEMON] Integrity check: .torrent metadata synchronized',
  '[ASTROLABE] Magnetic declination adjusted for Pacific peer cluster',
  '[OBSIDIAN] SHA-1 block verified against root info-hash table',
  '[CHOKE] Unchoking 4 optimistic peers on high-throughput links',
];

export const RongorongoConsole: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    // Initial logs
    setLogs(LOG_TEMPLATES.slice(0, 4));

    const interval = setInterval(() => {
      const randomLog = LOG_TEMPLATES[Math.floor(Math.random() * LOG_TEMPLATES.length)];
      const glyph = RONGORONGO_SYMBOLS[Math.floor(Math.random() * RONGORONGO_SYMBOLS.length)];
      const time = new Date().toLocaleTimeString();
      const entry = `[${time}] ${glyph} ${randomLog}`;

      setLogs((prev) => [entry, ...prev.slice(0, 5)]);
    }, 2800);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col p-2.5 bg-obsidian-950/90 border border-slate-800 rounded-lg font-mono text-[11px] overflow-hidden">
      <div className="flex items-center justify-between text-slate-400 mb-1.5 pb-1 border-b border-slate-800/80">
        <div className="flex items-center space-x-1.5 text-cyber-gold">
          <Terminal className="w-3.5 h-3.5" />
          <span className="font-bold tracking-wider">RONGORONGO TELEMETRY STREAM</span>
        </div>
        <span className="text-[10px] text-cyber-cyan animate-pulse">BOUSTROPHEDON: ACTIVE</span>
      </div>

      <div className="flex flex-col space-y-1">
        {logs.map((log, idx) => (
          <div
            key={idx}
            className={`truncate transition-all duration-300 ${
              idx === 0 ? 'text-cyber-cyan font-bold' : idx === 1 ? 'text-slate-300' : 'text-slate-400'
            }`}
          >
            {log}
          </div>
        ))}
      </div>
    </div>
  );
};
