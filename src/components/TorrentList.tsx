import React, { useMemo, useState } from 'react';
import { TorrentItem } from '../types/torrent';
import { TorrentRow } from './TorrentRow';
import { Search, Inbox, ArrowUpDown } from 'lucide-react';
import { TorrentFilter } from './Sidebar';

interface TorrentListProps {
  torrents: TorrentItem[];
  filter: TorrentFilter;
  viewMode: 'cards' | 'table';
  selectedTorrent: TorrentItem | null;
  onSelectTorrent: (torrent: TorrentItem) => void;
  onContextMenu: (e: React.MouseEvent, torrent: TorrentItem) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onOpenAddModal: () => void;
}

type SortField = 'name' | 'progress' | 'size' | 'dlSpeed' | 'ulSpeed' | 'eta';

export const TorrentList: React.FC<TorrentListProps> = ({
  torrents,
  filter,
  viewMode,
  selectedTorrent,
  onSelectTorrent,
  onContextMenu,
  onStart,
  onPause,
  onOpenAddModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('progress');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Filter torrents
  const filteredTorrents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return torrents.filter((t) => {
      if (query) {
        if (!t.name.toLowerCase().includes(query) && !t.infoHash.toLowerCase().includes(query)) {
          return false;
        }
      }

      switch (filter) {
        case 'active':
          return (
            t.resolving === true || t.status === 'Downloading' || t.status === 'Seeding'
          );
        case 'completed':
          return t.status === 'Seeding' || t.progress >= 100;
        case 'paused':
          return t.status === 'Paused';
        case 'backedUp':
          return t.backedUp;
        default:
          return true;
      }
    });
  }, [torrents, filter, searchQuery]);

  // Sort torrents
  const sortedTorrents = useMemo(() => {
    const rows = [...filteredTorrents];
    rows.sort((a, b) => {
      let comp = 0;
      switch (sortField) {
        case 'name':
          comp = a.name.localeCompare(b.name);
          break;
        case 'progress':
          comp = a.progress - b.progress;
          break;
        case 'size':
          comp = a.totalBytes - b.totalBytes;
          break;
        case 'dlSpeed':
          comp = a.downloadSpeed - b.downloadSpeed;
          break;
        case 'ulSpeed':
          comp = a.uploadSpeed - b.uploadSpeed;
          break;
        case 'eta':
          comp = (a.etaSeconds ?? 999999) - (b.etaSeconds ?? 999999);
          break;
      }
      return sortAsc ? comp : -comp;
    });
    return rows;
  }, [filteredTorrents, sortField, sortAsc]);

  return (
    <main className="flex-1 flex flex-col h-full bg-obsidian-950 overflow-hidden">
      {/* Sub-header Toolbar with Sort & Search */}
      <div className="h-12 px-4 border-b border-slate-800/80 bg-obsidian-900/40 flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3 text-xs font-mono text-slate-400">
          <span className="text-cyber-cyan font-bold uppercase tracking-wider">
            {filter === 'all'
              ? 'ALL MONOLITHS'
              : filter === 'active'
              ? 'ACTIVE SWARMS'
              : filter === 'completed'
              ? 'COMPLETED DATA STELAE'
              : filter === 'paused'
              ? 'DORMANT MONOLITHS'
              : 'ARCHIVED VAULT BACKUPS'}
          </span>
          <span className="text-slate-600">•</span>
          <span>{sortedTorrents.length} PAYLOADS</span>
        </div>

        {/* Quick Sort Pills & Search */}
        <div className="flex items-center space-x-3">
          <div className="hidden lg:flex items-center space-x-1.5 text-[10px] font-mono text-slate-400">
            <span>SORT:</span>
            {(['progress', 'dlSpeed', 'size', 'name'] as SortField[]).map((f) => (
              <button
                key={f}
                onClick={() => handleSort(f)}
                className={`px-2 py-0.5 rounded border transition-colors flex items-center space-x-1 ${
                  sortField === f
                    ? 'bg-cyber-cyan/20 border-cyber-cyan text-cyber-cyan font-bold'
                    : 'border-slate-800 hover:border-slate-700 text-slate-400'
                }`}
              >
                <span>{f.toUpperCase()}</span>
                {sortField === f && <ArrowUpDown className="w-2.5 h-2.5" />}
              </button>
            ))}
          </div>

          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search stelae..."
              className="w-full pl-9 pr-3 py-1 rounded bg-obsidian-950 border border-slate-800 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyber-cyan transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Main Torrent Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {sortedTorrents.length > 0 ? (
          viewMode === 'table' ? (
            <div className="rounded border border-slate-800 overflow-hidden">
              <table className="w-full text-left divide-y divide-slate-800">
                <thead className="bg-obsidian-900 text-slate-400 font-mono text-[10px] font-bold">
                  <tr>
                    <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('name')}>NAME</th>
                    <th className="px-3 py-2">STATUS</th>
                    <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('progress')}>PROGRESS</th>
                    <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('size')}>SIZE</th>
                    <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('dlSpeed')}>DL SPEED</th>
                    <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('ulSpeed')}>UL SPEED</th>
                    <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('eta')}>ETA</th>
                    <th className="px-3 py-2" title="Seeds / leechers in the swarm (tracker scrape)">SEEDS/LEECH</th>
                    <th className="px-3 py-2" title="Peers connected / known to this client">PEERS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-obsidian-950/80">
                  {sortedTorrents.map((t) => (
                    <TorrentRow
                      key={t.id}
                      torrent={t}
                      viewMode="table"
                      isSelected={selectedTorrent?.id === t.id}
                      onSelect={onSelectTorrent}
                      onContextMenu={onContextMenu}
                      onStart={onStart}
                      onPause={onPause}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            sortedTorrents.map((t) => (
              <TorrentRow
                key={t.id}
                torrent={t}
                viewMode="cards"
                isSelected={selectedTorrent?.id === t.id}
                onSelect={onSelectTorrent}
                onContextMenu={onContextMenu}
                onStart={onStart}
                onPause={onPause}
              />
            ))
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="p-5 rounded-full bg-obsidian-900 border border-dashed border-slate-800 text-slate-600">
              <Inbox className="w-12 h-12 stroke-[1.5]" />
            </div>
            <div>
              <div className="text-sm font-mono font-bold text-slate-300 uppercase tracking-widest">
                NO SACRED SWARMS IN THIS QUARRY
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1 max-w-sm">
                Drop a .torrent file or paste a magnet link to initiate peer discovery across Rapa Nui.
              </div>
            </div>
            <button
              onClick={onOpenAddModal}
              className="cyber-button px-5 py-2 bg-cyber-cyan text-black font-bold font-mono text-xs uppercase tracking-wider shadow-glow-cyan"
            >
              INGEST NEW TORRENT
            </button>
          </div>
        )}
      </div>
    </main>
  );
};
