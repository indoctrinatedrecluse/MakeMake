import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import { SystemStats, TorrentItem } from '../../types/torrent';

const GLYPH = {
  session: '◈',
  added: '✦',
  status: '▲',
  complete: '⚡',
} as const;

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const stamp = () => new Date().toLocaleTimeString();

interface RongorongoConsoleProps {
  torrents: TorrentItem[];
  stats: SystemStats;
}

/**
 * Honest activity stream.
 *
 * This console used to print invented tracker/DHT chatter. It now derives every
 * line from real engine snapshots: session boot data, newly added torrents,
 * status transitions and completions. Nothing is random or fabricated.
 */
export const RongorongoConsole: React.FC<RongorongoConsoleProps> = ({ torrents, stats }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const previous = useRef<Map<string, TorrentItem> | null>(null);

  useEffect(() => {
    const next = new Map(torrents.map((t) => [t.id, t]));

    if (!previous.current) {
      const summary = `[${stamp()}] ${GLYPH.session} SESSION ONLINE · DHT ${stats.dhtNodes} NODES · ${torrents.length} MONOLITH${torrents.length === 1 ? '' : 'S'}`;
      setLogs([summary]);
      previous.current = next;
      return;
    }

    const fresh: string[] = [];
    for (const [id, torrent] of next) {
      const before = previous.current.get(id);
      if (!before) {
        fresh.push(
          `[${stamp()}] ${GLYPH.added} ADDED · ${torrent.name} · ${formatBytes(torrent.totalBytes)}`,
        );
        continue;
      }
      if (before.status !== torrent.status) {
        fresh.push(`[${stamp()}] ${GLYPH.status} ${torrent.name} · ${before.status} → ${torrent.status}`);
      }
      if (before.progress < 100 && torrent.progress >= 100) {
        fresh.push(`[${stamp()}] ${GLYPH.complete} COMPLETE · ${torrent.name} · seeded ${formatBytes(torrent.uploadedBytes)}`);
      }
    }

    previous.current = next;
    if (fresh.length > 0) {
      setLogs((prev) => [...fresh.reverse(), ...prev].slice(0, 6));
    }
  }, [torrents, stats.dhtNodes]);

  const lines =
    logs.length > 0
      ? logs
      : [`[${stamp()}] ${GLYPH.session} AWAITING SWARM EVENTS · ${stats.activeTorrents} ACTIVE`];

  return (
    <div className="flex flex-col p-2.5 bg-obsidian-950/90 border border-slate-800 rounded-lg font-mono text-[11px] overflow-hidden">
      <div className="flex items-center justify-between text-slate-400 mb-1.5 pb-1 border-b border-slate-800/80">
        <div className="flex items-center space-x-1.5 text-cyber-gold">
          <Terminal className="w-3.5 h-3.5" />
          <span className="font-bold tracking-wider">RONGORONGO EVENT STREAM</span>
        </div>
        <span className="text-[10px] text-cyber-cyan animate-pulse">LIVE</span>
      </div>

      <div className="flex flex-col space-y-1">
        {lines.map((log, idx) => (
          <div
            key={`${idx}-${log}`}
            className={`truncate transition-all duration-300 ${
              idx === 0 ? 'text-cyber-cyan font-bold' : idx === 1 ? 'text-slate-300' : 'text-slate-400'
            }`}
            title={log}
          >
            {log}
          </div>
        ))}
      </div>
    </div>
  );
};
