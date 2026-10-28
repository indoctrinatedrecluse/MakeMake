# Changelog

All notable changes to **MakeMake // Rapa Nui Cyberpunk BitTorrent Engine** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
