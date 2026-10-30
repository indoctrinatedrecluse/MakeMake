# Changelog

All notable changes to **MakeMake // Rapa Nui Cyberpunk BitTorrent Engine** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.1.7] — 2026-10-30

Correctness release for the three things that made v0.1.6 feel broken: the seed/leech numbers were
fabricated, the context-menu actions could freeze the window, and "Purge" never proved it deleted
anything. It also gives every kind of *invisible* work a visible pulse, and stops the one-second
poll from carrying the entire library's file manifests.

### Added
- **Real seed / leecher counts per torrent.** librqbit exposes no swarm sizes at all (its stats only
  carry the peers *this* client is connected to), so MakeMake now scrapes the torrent's trackers
  itself — HTTP(S) per BEP-48 (`/announce` → `/scrape`) and UDP per BEP-15 — merges the answers with
  `max` (trackers report overlapping swarms) and reports how many trackers replied. Every row shows
  `SEEDS / LEECH` next to `PEERS`, and the details drawer and context menu repeat it. No tracker
  answering is shown as `?`, never as a fake zero. Magnet `tr=` lists are now kept, so a magnet has
  trackers to scrape.
- **"Refresh Swarm Data"** in the context menu: scrapes immediately instead of waiting for the
  10-minute refresh. A torrent that has just been added or resumed scrapes right away.
- **A status line that explains the state** (`statusDetail`) on every row, in the context menu and in
  the drawer: `Waiting for peers: 0 of 40 known, 3 dialling`, `Verifying the data already on disk —
  42% hashed`, `Connected to 3 peer(s) but no data is flowing — they may not have the pieces`, `Seeded
  swarm: 12 seed(s)`, and so on — all derived from real engine counters, never guessed.
- **Stall watchdog.** Each torrent tracks the last verified byte count; when nothing arrives while it
  is supposed to be downloading, the row shows an `IDLE 90s` badge and the status line says how long.
- **Purge progress and a result report.** "Purge Monolith & Files" now keeps the row visible as
  `Deleting — 4 512 of 20 000 files`, removes the payload with the engine's own walker, and reports
  `filesRemoved` / `filesFailed` back to the window (toast). Failures name the first file that could
  not be deleted instead of disappearing into the log.
- `refresh_swarm` command and `purges` in `get_snapshot`.

### Added — nothing looks frozen anymore
- **Animated hidden-work bands.** States that do a lot of work while moving no bytes now say so in
  the language of the theme, in the row, the context-menu header and the details drawer:
  `Verifying payload` (dash-chiselled glyph, verified-piece counter, filling bar), `Erasing payload`
  (falling shards, files-erased counter, red bar), `Waiting for an engine slot` (stepping-stone
  dots), `Resolving metadata` (magnet glyph + crawling bar). States whose size is genuinely unknown
  crawl; none of them ever shows a fake percentage.
- **Radar sweep on the tracker scrape.** `TorrentItem.swarmRefreshing` is true exactly while a
  BEP-48/BEP-15 scrape task is running, and the `SEEDS` cell swaps its sprout for a sweeping radar
  glyph for that window — so "Refresh Swarm Data" is visibly doing something even before the
  numbers land.
- **Operation monitor.** Every command the window sends (add, start, pause, verify, purge, remove,
  scrape, priority, file selection, backup, export, settings, turtle) is listed in a floating
  transmitter readout with a live elapsed counter; after eight seconds it adds `STILL WORKING —
  nothing is frozen`. A slow magnet resolution or a 20 000-file payload sweep is therefore never
  silent again.
- **Elapsed clock while a magnet resolves** in the add dialog (that wait is capped at 20 s, and it
  used to show a spinner with no clock).
- **A toast countdown.** Toasts carry a draining bar for as long as they live, so their
  disappearance is expected rather than abrupt.
- `get_torrent_files` command, and `fileCount` / `primaryPath` / `swarmRefreshing` on every row.

### Changed — cheaper polling, calmer rendering
- **The one-second poll no longer ships the whole library's file manifests.** A 20 000-file pack
  was deep-cloned twice per tick (list + stats) and JSON-serialised into the IPC payload even
  though the window was only showing one torrent's file list. Now only the torrent the details
  drawer has open carries `files` / `fileProgress`; every other row carries its `fileCount` and, for
  single-file torrents, its `primaryPath`, and anything else asks for the manifest explicitly with
  `get_torrent_files` (switching rows, opening the Files tab, "Select files…").
- **Rows only re-render when what they show changed.** `TorrentRow` is memoised over a value key
  (`status`, counters, speeds, swarm numbers, stalled seconds, …), so a quiet row no longer tears
  down and re-lays out its progress bar, badge and heatmap every second. The list's filter and sort
  passes are memoised with it.
- **`animate-fadeIn` now exists.** Five components asked for it and silently got nothing; modals,
  the context menu and toasts now actually fade/slide in.
- **Toast timers are tokenised.** An older toast's timeout could clear a *newer* toast that had just
  replaced it; each timeout now only clears the toast it was created for.
- `prefers-reduced-motion` disables every new animation (the glyphs and bars stay, they just stop
  moving).

### Fixed
- **Purge/remove no longer hangs the app and now really deletes from disk.** It used to call
  librqbit's `Session::delete(id, true)`, which runs `std::fs::remove_file` per payload file inline on
  a tokio worker, gives up silently on the first Windows sharing violation, and can panic on a
  missing metadata handle (a panic inside a Tauri command never resolves the IPC promise, which is
  exactly a frozen window). Now the session release is bounded (`REMOVE_TIMEOUT`), and the files are
  erased by `sparse::purge_payload` on a blocking thread with retries for temporary locks
  (`ERROR_SHARING_VIOLATION` from Explorer's thumbnailer, players, antivirus), empty-directory pruning
  and a per-file counter.
- **Start / Pause / Verify / Purge answer the UI immediately.** `start_torrent` and `pause_torrent`
  return the freshly built row, so the click updates the list instead of waiting for the next ~1 s
  poll; every state-changing call is bounded by a timeout and reports a real error message when it
  does not complete. Locked-up handlers used to leave the confirm dialog and the row untouched
  forever.
- **Removal/keep-files no longer shows a phantom path** and the confirm dialog closes before the
  command runs.
- **Downloads start sooner.** librqbit's `concurrent_init_limit` (3 hash checks at a time) left every
  later torrent "Queued" behind the first few; it is now 8. The launch-time payload sweep is detached
  from session creation, so the first window poll does not wait for a whole library of stat calls.
- **No blocking `pause`/`unpause` inside the 1 s poll.** The launch-time re-arm loop and the
  "seed when finished" policy are bounded too, so a wedged state machine can no longer stall the poll
  that every row, counter and badge depends on.

### Tests
- 46 Rust tests (was 31 in v0.1.6): HTTP scrape parsing (seed/leech extraction, `failure reason`,
  garbage bodies), announce→scrape URL mapping (including `announce.php`, query strings and
  non-BEP-48 paths), UDP connect/scrape packet layout and response validation (BEP-15), hex
  info-hash decoding, scrape merge semantics, `purge_payload` (owning files only, folder pruning,
  foreign files kept, missing folder) and an end-to-end offline purge through the engine, the
  `statusDetail` branches, and the lean/full snapshot split (`files` empty for unselected rows,
  present for the drawer's torrent, served on demand by `get_torrent_files`).

## [v0.1.6] — 2026-10-30

Resume release. Pointing a magnet or `.torrent` at a folder that already holds that torrent's
payload no longer means starting from zero: MakeMake asks first, then verifies what is on disk and
downloads only the missing pieces. Plus a hardened crash path and a reworked context menu.

### Added
- **"This folder already exists" prompt.** The add dialog now asks the engine about the exact
  folder it would write to (`<download folder>/<torrent name>`) before anything happens, and shows
  how much of the current selection is already there: bytes on disk versus declared bytes, how many
  files exist, how many are complete, and how many *unrelated* files share the folder. Two choices:
  **Resume & Verify** (the default) or **Start Over**. A slow magnet whose metadata has not arrived
  yet is skipped, because its folder name is not known until the swarm answers.
- **Resume verifies, it does not re-download.** On resume the payload is left untouched and
  librqbit's initial hash check adopts every piece that still matches, so a half-finished or
  previously removed download continues exactly where it stopped. Verified end-to-end with an
  offline librqbit session: a payload written to disk beforehand is adopted as a complete piece
  instead of being fetched again.
- **Start Over is surgical.** It deletes only the paths the torrent itself declares, only regular
  files, only inside its own folder — never a wildcard, never a directory, never through a symlink,
  and never outside the folder (a `../` payload path is ignored). Unrelated files are reported and
  left alone. The engine drops the torrent from the session first so librqbit re-hashes the empty
  files instead of answering "already managed".
- **Already-queued swarms are flagged** in the prompt, so re-adding an info hash that is already in
  the list continues that entry instead of looking like a duplicate.
- **Crash detection.** A `session-active.marker` file is written when a run starts and removed only
  after the session has been sealed cleanly. If it is still there at the next launch, the previous
  run died without pausing its swarms: the restored swarms are re-armed, every `.torrent` archive
  that is missing or was never confirmed is rewritten from the metadata librqbit restored (the
  backup vault as a recovery mechanism), and the UI says so once.
- **Panic hook.** A panic now logs itself and makes a bounded (5 s, separate thread) attempt to
  pause every swarm and flush resume data. A panic on the UI thread then exits the process, because
  the event loop cannot recover; a background panic leaves the app running with everything safely
  paused.
- **Exit-request sealing.** `RunEvent::ExitRequested` — OS shutdown/logoff, `app.exit()` from
  anywhere, the last window being destroyed — now runs the same seal as the title-bar close. Until
  now only `CloseRequested` was covered.
- **Padding files are marked** (BEP-47) in the file list, cannot be selected, and are excluded from
  the selection, byte counts and folder inspection.

### Changed
- **Context menu rework.** Grouped into `Transfer / Storage / Payload / Registry` sections; the
  priority list and the four clipboard actions (info hash, magnet, path, tracker URLs) are inline
  expanders instead of separate rows; the panel is measured before it is placed, so the destructive
  entries can no longer fall off the bottom of the window; it closes on scroll/resize/blur and is
  keyboard navigable (arrows, Enter, Escape). `Reveal Payload` and `Copy Download Path` now point at
  the per-torrent folder instead of rebuilding `<dir>/<name>` on top of it.
- `add_torrent` takes an explicit mode (`resume` / `replace`); anything else is treated as
  `resume`, so a caller that forgets the argument can never erase data.
- **A destination report is only actionable while it is current.** Changing the folder (or the
  file selection) invalidates the previous answer, and a stale answer is discarded instead of
  offering `Start Over` against a folder the dialog is no longer pointing at.

### Tests
- Offline librqbit session proving an existing payload is adopted (piece verified from disk, bytes
  untouched); an end-to-end `resume` vs. `replace` add that shows resume leaves the old bytes alone
  while start over re-creates them empty and keeps the unrelated file next to them; destination
  inspection (missing folder, partial payload, foreign files, unresolved magnet); crash-marker
  lifecycle across a simulated crash and a clean seal; plus the new payload helpers: presence
  measurement, foreign-entry counting, surgical wipe, and the path-escape refusal.

## [v0.1.5] — 2026-10-29

Layout release. Every torrent now downloads into a folder of its own, named after the torrent,
instead of dropping its files into the folder that was picked for it.

### Changed
- **A dedicated folder per torrent.** The payload is written to
  `<chosen download folder>/<torrent name>`, using the same title the UI shows (sanitised for
  Windows: `\ / : * ? " < > |` replaced, device names such as `CON` neutralised, trailing dots and
  spaces dropped). Until now only multi-file torrents were nested; a single-file torrent was left
  loose in the download folder next to every other torrent and the user's own files. The layout now
  matches librqbit's own default, which MakeMake cannot use directly because it passes an explicit
  `output_folder` for the per-add destination prompt.
- **No double nesting.** A torrent whose file paths already begin with their own name
  (`Name/…`, which some trackers produce) is written to `<chosen folder>/Name/…` instead of
  `Name/Name/…`. The check looks at every payload file, so a torrent that mixes nested and flat
  paths still gets its folder.
- **Queued magnets report the real destination.** A `Resolving` row in the list shows the folder
  the payload will land in, not the parent folder that was picked.
- **Torrents added before v0.1.5 keep their existing folder.** Re-parenting a payload that is
  already on disk would mean re-creating and re-hashing it, so the new layout applies to newly
  added torrents.

### Tests
- Payload folder placement: multi-file torrents with flat paths, single-file torrents, torrents
  that already carry sub-folders, the no-double-nesting guard (including the mixed case), and the
  hostile-name case that must never escape the chosen download folder.

## [v0.1.4] — 2026-10-29

Engine-hardening release. Two small, well-tested crates replace hand-rolled code where the
hand-rolled version was measurably wrong, and the numbers behind the previous release's disk bug
are now visible in the UI instead of only in the log.

### Added
- **Free space of the download volume in the footer** (`DISK FREE`, amber under 10 %, red under
  2 %), read through `fs4` (`statvfs` / `GetDiskFreeSpaceExW`) and cached for 5 s so the
  one-second UI poll never re-stats the filesystem.
- **A disk-space warning when a torrent does not fit.** The add dialog reports how much is free
  versus what the swarm needs, and the engine logs the same at add time. Sparse placeholders make
  such a torrent cost nothing to *queue*, but it will stall once the volume fills — exactly what
  the 133 GiB torrent did in v0.1.3.
- **`ON DISK` in the Overview tab** of the details drawer: the bytes the filesystem actually
  reserved for the payload, next to its declared size, marked `sparse` while the two differ.
  `get_torrent_disk_usage` asks the filesystem through `fs4::FileExt::allocated_size`
  (`GetFileInformationByHandleEx` / `SEEK_HOLE`) and never reads a payload byte.

### Changed
- **Torrent names stay readable on disk.** Folder and `.torrent` archive names used to go through
  a hand-rolled sanitizer that replaced *every* non-alphanumeric character, so
  `Cyberpunk 2077 [DODI Repack]` became `Cyberpunk 2077 _DODI Repack_`. They now go through
  `sanitize-filename` (Node's rules — illegal characters, Windows device names such as `CON` and
  `NUL`, trailing dots and spaces), which keeps punctuation and still guarantees one safe path
  component.
- **Payload pre-creation runs off the async runtime.** [`sparse::prepare_payload`] performs one
  `open` + one `FSCTL_SET_SPARSE` per file; on a 20 000-file pack that blocked a runtime worker —
  and therefore the UI polls and the swarm's own IO — for the whole pass. The add path and the
  launch-time restore now run it in `spawn_blocking`, and directories are created once per
  directory instead of once per file.
- A payload path already occupied by a directory or a reparse point is skipped and counted instead
  of aborting the whole pass, which would have left librqbit to allocate the remaining files
  densely.

### Dependencies
- `sanitize-filename` (name sanitising; reuses the `regex` already compiled in the tree via
  librqbit) and `fs4` (filesystem statistics and allocated size; `windows-sys` on Windows, no new
  native dependency).
- Tests for name sanitising (readability, Windows device names, path separators, length clamp) and
  for payload pre-creation (occupied paths are skipped, nested directories created once).

## [v0.1.3] — 2026-10-29

Reliability release. A deep dive into the four symptoms — magnets that never reached the queue,
large torrents that froze the machine while "allocating space", a details drawer that locked up on
big torrents, and downloads that never started — turned up one root cause in librqbit, three in
MakeMake itself, and a fourth that was a runaway UI loop.

### Fixed
- **Large torrents no longer consume their full size on disk the moment they are added.**
  librqbit 9.0.1 tries to mark every payload file sparse before extending it, but its
  `DeviceIoControl(FSCTL_SET_SPARSE)` call passes a NULL `lpBytesReturned` together with a NULL
  `OVERLAPPED`, which Windows rejects. The sparse flag was therefore never applied and NTFS
  allocated the whole torrent densely. Measured on a real 133 GiB / 34 073-piece torrent: adding a
  single 66.76 GiB file reserved **66.76 GiB of free space within two seconds**, on a volume with
  108 GB left — which is why the machine stalled while "allocating space" and why the download had
  nowhere left to go. MakeMake now pre-creates the exact payload paths itself, empty and marked
  sparse, before handing the torrent over (see `src-tauri/src/sparse.rs`).
- **Adding a large torrent no longer re-hashes data it just created.** Because the payload is
  created at zero length, librqbit's initial check finishes immediately instead of reading (and
  SHA-1 hashing) the whole payload. The same 66.76 GiB file now initialises in ~2 s with 4 KB
  actually used, instead of ~94 s of full-disk hashing.
- **Magnets are queued instead of vanishing.** A magnet whose metadata had not arrived was awaited
  inside the `add_torrent` command: the dialog closed, nothing appeared in the list, and if the
  swarm was slow the add failed with nothing to show for it. Magnets are now registered as queue
  entries with a `Resolving` status, resolve in the background (3 attempts, real name/size/file
  list published as soon as the swarm answers), survive an app restart, and can be retried from
  the row button instead of being re-added by hand.
- **The 133 GiB "lag" was an unbounded polling loop.** `refreshData` depended on
  `selectedTorrent`, and the polling effect depended on `refreshData`; every poll replaced the
  selected object, re-created the callback, tore down and re-ran the effect, and fired another
  pair of IPC calls. The window now polls a single `get_snapshot` command on an adaptive timer
  (1 s active, 3 s idle, 5 s hidden) and keeps the selection in a ref.
- **The engine no longer walks the torrent list twice per tick.** `get_system_stats` called the
  whole `collect_items` pass (file metadata included) just to sum counters; it now reads librqbit
  directly, and the list itself is served with cached metadata.
- **Per-torrent metadata is cached.** `build_item` used to call `iter_file_details()` — one
  `String` per path component — for every torrent on every poll. Metadata is immutable per info
  hash, so it is snapshotted once.
- **The piece matrix no longer renders one DOM node per piece.** A 34 000-piece torrent produced
  34 000 divs re-laid out every second. It is now a canvas with a capped cell budget, and the
  reported "verified" count comes from the bytes librqbit actually has instead of a rounded
  progress estimate.
- **Multi-file torrents get their own folder again.** MakeMake always passed an explicit
  `output_folder`, which defeated librqbit's default sub-folder layout and dumped every payload
  file straight into the chosen directory, where it collided with other torrents and with the
  user's own files.
- **The Files tab renders a window** (200 rows, "show more") instead of thousands of rows, and its
  selection signature no longer allocates a string the size of the file list on every render.

### Changed
- `get_snapshot` (torrents + stats in one round trip) and `retry_pending` are new commands;
  `get_torrents` and `get_system_stats` remain for compatibility.
- Magnet metadata preview now gives up after 20 s (was 45 s) and says so, because the download no
  longer depends on it — the queue picks up from there.

### Added
- `examples/torrent_probe.rs`: a diagnostic harness that adds a real `.torrent` or magnet to a
  throw-away session and reports every half second what the engine is doing (state, checked bytes,
  disk usage, peers, speed). It is how the allocation and hashing costs above were measured, and
  it verifies that a download actually starts (`PROBE_LIVE=1`).
- Tests for sparse pre-creation, payload path selection (padding files, partial selections),
  queued-magnet items, the coarse piece map and the file-selection rules.

## [v0.1.2] — 2026-10-29

Licensing release: MakeMake is open source under **Apache-2.0**, and the published installer now
carries the terms instead of only the repository doing so.

### Added
- **Apache-2.0 licensing**: `LICENSE` carries the verbatim Apache License 2.0 text with the
  copyright notice appended, and `NOTICE` provides the attribution. The `Apache-2.0` SPDX
  identifier plus `Copyright 2026 Abhishek Mitra (indoctrinatedrecluse)` are declared in
  `package.json`, `src-tauri/Cargo.toml` and the Tauri bundle.
- **Installer license page**: the NSIS installer renders the Apache 2.0 agreement
  (`MUI_PAGE_LICENSE`) and the executable's version resource reports
  `LegalCopyright: Copyright 2026 Abhishek Mitra (indoctrinatedrecluse)`.

### Changed
- The repository is **public**, so release artifacts download without authentication.
- Commit history was normalised to the GitHub noreply identity — no personal email addresses are
  published.

## [v0.1.1] — 2026-10-29

Session-safety release: every exit now seals the swarm cleanly, the vault engine does what its
settings claim, and the Astrolabe finally says something useful.

### Added — Session Guard (crash-safe resume)
- **Pause-on-exit**: window close, Alt+F4 and OS shutdown requests are intercepted, the UI hides
  immediately, and every swarm (seeding or leeching, complete or not) is paused so `librqbit`
  flushes its resume database — `session.json`, per-torrent `.bitv` piece maps and the raw
  `.torrent` bytes — before the process exits. A wedged tracker can never trap the app: the seal
  is bounded at 8 s and then exits anyway.
- **Durability checkpoint every 15 s** recording which swarms were live, so a hard kill (power
  loss, task manager) still resumes correctly next launch.
- **Auto-resume on launch** (`Settings → Session Guard`): swarms that were running when the app
  closed are re-armed; explicitly paused swarms always stay paused.
- **Self-healing re-arm**: a restored swarm re-verifies its pieces and `librqbit` defers — and can
  re-apply — an unpause that lands mid-check, so MakeMake retries (bounded) until the swarm has
  been stably live for three polls.
- Atomic state-file writes (temp file + rename) so a crash can never truncate
  `makemake-state.json`.
- Footer shows `STATE SEALED: hh:mm:ss` (last durable checkpoint) plus a live swarm census;
  a toast announces a recovered session on launch.

### Fixed — Temporal auto-backup vault
- The archive is now written as soon as the metadata is known (magnet links included), instead of
  waiting for the whole interval — a download in progress always has a real `.torrent` in the
  vault. The interval is now an **archive refresh interval** while bytes are still flowing.
- Post-completion relocation is a genuine **move** (`rename`, copy + delete across volumes)
  instead of a copy that left the staging vault populated forever.
- Stale `backupPath` values left over from a relocation are self-healed instead of silently
  pointing at a file that no longer exists.
- Archive writes are temp-file + rename and per-torrent serialised (the UI polls the list and the
  stats concurrently).

### Fixed — client behaviour
- `pause`, `resume`, `pause_all`, `resume_all` and the exit seal no longer report spurious
  "torrent is already paused / already live" errors.
- `Settings` save is wrapped in error handling (a failed commit now shows a themed toast instead
  of an unhandled rejection).

### Changed — Swarm Astrolabe
- No more overlapping labels: the header is a single flex row with a `LIVE / DORMANT / STANDBY`
  badge, and the decorative "bearing" text is gone.
- The dial now plots **real swarms**: bearing from the info hash, radius = verified completion
  (rim = 0 %, core = 100 %, ring labels are percentages), colour = engine state (leech, seed,
  paused, error), pulse rate scaled by transfer speed, selected swarm ringed in gold.
- Hover readout shows the swarm name, exact progress and status; legend counts leeches / seeds /
  paused; footer shows live down/up rates and peers / DHT nodes.
- The left pane is fully opaque (`bg-obsidian-950`) so it matches the top HUD even while empty.

## [v0.1.0] — 2026-10-29

First public proof-of-concept release: a working desktop BitTorrent client (Tauri v2 + React +
Rust) running a real `librqbit` session — no mocks, no fabricated telemetry.

### Downloads & engine
- Real BitTorrent v1 engine via `librqbit` 9: DHT, HTTP/UDP/WebSocket trackers, TCP + uTP peer
  wire protocol, piece verification, fast-resume, UPnP port mapping and seeding after completion.
- Add torrents from a **magnet link**, a **`.torrent` file** (file picker), **drag & drop**, or
  **Ctrl+V** from the clipboard.
- **Every add asks where to store the payload.** The native folder picker opens as soon as a
  `.torrent` is parsed, and after the swarm returns metadata for a magnet link. The default
  download location can be left **unset** — MakeMake then always asks, and falls back to the OS
  Downloads folder if the picker is cancelled with nothing configured.
- Per-file selection before adding (`librqbit` `only_files`) with Select all / Deselect all.
- Per-file progress bars, overall progress, ETA, live down/up speeds and byte counters.
- Full session persistence: torrents, output folders, file selection and UI bookkeeping survive a
  relaunch (`%APPDATA%\MakeMake\makemake-state.json` + `librqbit` fast-resume data).
- Deleting a torrent can either detach it from the list or **also delete the downloaded data**.

### Client controls
- Pause / resume a single torrent, **Pause all** and **Resume all** in the header.
- Force recheck (re-hashes the on-disk data and resumes from what is actually there).
- Queue priority (`High` / `Normal` / `Low`) persisted per torrent.
- Global download/upload caps plus an alternate **turtle** bandwidth profile, toggled from the
  status bar and applied live to the running session.
- "Keep seeding after completion" switch.
- `.torrent` backup on add, manual backup, and **Save .torrent As…** export.
- Open download folder, reveal payload in Explorer, open a single downloaded file.

### Right-click context menu
- Resume / pause, verify integrity, open folder, reveal payload, open file, select files.
- Copy info hash / magnet link / download path.
- Priority submenu, backup, export, remove, and destructive "purge torrent + files" — each
  irreversible action still behind the themed confirmation modal.

### Details drawer ("Ahu Inspector")
- **Overview:** real engine state, info hash, storage path, ratio, peers, current priority and the
  engine's error message when a torrent fails.
- **Speed graph:** oscilloscope fed by live sample history.
- **Peers:** real rows from librqbit's live peer registry — address, state, client, transport
  (TCP/uTP), downloaded and uploaded bytes.
- **Files:** per-file progress (straight from `TorrentStats::file_progress`), inline payload
  re-selection with "Apply selection", open/reveal per file.
- **Piece matrix:** visual completion matrix derived from real progress.
- **Trackers:** announce URLs parsed from the resolved metadata, with transport type, or an honest
  "DHT-only swarm" message.

### Visuals & theme
- Ambient **long Moai video loop** as the app canvas and the splash screen backdrop.
- **Short Moai video** used for the ingestion modal canvas, and sampled into the NSIS
  installer/uninstaller artwork (`src-tauri/installer/*.bmp`, generated with
  `scripts/generate-installer-art.py`).
- Cyberpunk/Polynesian design system: obsidian palette, cyan/gold/red accents, scanlines, runic
  gizmos, audio haptics, card + table view modes, filters, search and sorting.
- **No fabricated telemetry:** the Swarm Astrolabe plots exactly the connected peer count reported
  by the engine (no random blips, countries or speeds), and the Rongorongo console streams real
  session events (adds, status transitions, completions, DHT node count) instead of invented logs.

### Launcher & packaging
- **No console/PowerShell window appears next to the app anymore**: the Windows binary is built as
  a GUI subsystem binary in debug *and* release (opt back in with `run.ps1 -Console`), the launcher
  starts it hidden, and `MakeMake.vbs` can launch it with no window at all.
- `run.ps1` modes: `Desktop` (default), `Web`, `-Release`, `-Installer`, `-SkipBuild`, `-Console`.
- NSIS installer: per-user install, custom header/sidebar artwork, uninstaller hooks that remove
  the binary, WebView2 data, app state and registry keys.
- GitHub Actions release workflow (`.github/workflows/release.yml`) builds the NSIS installer on
  every `v*` tag and attaches it to the GitHub release.

### Known limitations
- Per-torrent bandwidth limits are not exposed by librqbit; only session-wide caps + turtle mode.
- Sequential (in-order) downloading is not supported by the engine.
- Seed counts are not part of librqbit's public stats; the UI reports connected/seen peers instead.
- Magnet metadata resolution can take up to 45 s on sparse swarms; adding still works afterwards.
- Moving already-downloaded data to a new folder is not implemented yet (re-add with a new target
  folder to re-check in place).

[Unreleased]: https://github.com/indoctrinatedrecluse/MakeMake/compare/v0.1.7...HEAD
[v0.1.7]: https://github.com/indoctrinatedrecluse/MakeMake/compare/v0.1.6...v0.1.7
[v0.1.6]: https://github.com/indoctrinatedrecluse/MakeMake/releases/tag/v0.1.6
