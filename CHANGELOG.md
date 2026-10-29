# Changelog

All notable changes to **MakeMake // Rapa Nui Cyberpunk BitTorrent Engine** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/indoctrinatedrecluse/MakeMake/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/indoctrinatedrecluse/MakeMake/releases/tag/v0.1.0
