# 🗿 MAKEMAKE (マケマケ)
### *Hypermodern Cyberpunk BitTorrent Client Steeped in Rapa Nui Mythology*

```
                     .---.
                    /     \
                   | () () |       MAKEMAKE PROTOCOL v0.1.7
                    \  ^  /        [SYSTEM: AHU-ONLINE]
                     |||||         [SWARM: TANGATA-MANU ACTIVE]
                    /=====\
                   /       \
```

---

## 🌌 Lore & Vision

**MakeMake** is named after the supreme creator god of the **Rapa Nui** (Easter Island) people—god of fertility and patron of the **Tangata Manu** (Birdman) cult.

Every spring on the jagged volcanic cliffs of *Rano Kau*, competitors (*hopu manu*) scaled sheer sea cliffs and swam across turbulent, shark-inhabited waters to the sacred islet of *Motu Nui* to retrieve the first egg of the *Manutara* (sooty tern). The victor became the living embodiment of Makemake for a year.

**MakeMake fuses this ancient Polynesian maritime legacy with high-tech cyberpunk aesthetics:**
* **The Swarm as the Ocean**: Peers scattered across the globe are navigated using the ancient Polynesian art of **Wayfinding** (star compasses, ocean swells, celestial bearings).
* **The Moai as Data Monoliths**: Rather than sterile grey progress bars, torrents are represented as monolithic obsidian stelae whose volcanic matrix and glowing red *pukao* (topknots) illuminate as SHA integrity checks lock into place.
* **The Rongorongo Script**: The enigmatic, undeciphered wooden tablet script of Rapa Nui is reimagined as cryptographic DHT telemetry and cipher streams.
* **The Tangata Manu Protocol**: The rarest-first piece picking algorithm is visualized as cyber-petrels diving across the peer mesh to retrieve rare chunks.

---

## ⚡ Core Features (POC & Beyond)

### 1. Swarm Ingestion (.torrent & Magnet Links)
* **Metadata Preview Modal**:
  * Every `.torrent` or magnet link immediately opens a cyber-styled Inspection Modal.
  * For magnet links, initiates DHT metadata resolution with animated Rongorongo glyph decoders.
  * Displays complete file tree hierarchy with individual file size, piece counts, and selection checkboxes.
* **Destination prompt on every add**:
  * The native folder picker opens as soon as a `.torrent` file is parsed, and right after the
    swarm returns metadata for a magnet link.
  * The global default download location can be **left empty/unset** ("Clear" in Settings) — then
    MakeMake always asks, and falls back to the OS Downloads folder if the picker is cancelled.
  * Files are written exactly where you choose; every torrent then gets its own folder inside it,
    named after the torrent (single-file torrents included).
* **Existing folder? MakeMake asks before touching it.** Because every torrent has a predictable
  folder, MakeMake can tell before a single byte moves whether
  `<download folder>/<torrent name>` is already there. If it is, the dialog shows a
  pre-flight report — bytes already on disk versus the declared size, how many files exist, how many
  are complete, and how many *unrelated* files share the folder — and offers two choices:
  * 🛡 **Resume & Verify** (default): the payload is left exactly as it is; `librqbit` re-hashes the
    files that are there, keeps every piece that still matches and downloads only the missing ones.
    A half-finished download, or one whose torrent was removed from the list, continues where it
    stopped instead of starting over.
  * 🧨 **Start Over**: deletes only the paths this torrent declares, only regular files, only inside
    its own folder — never a wildcard, never a directory, never through a symlink, never outside the
    folder. Unrelated files are kept, and the button turns red for the occasion.
  * If the swarm is already in the queue the prompt says so, and re-adding it just continues that
    entry. A magnet whose metadata has not arrived yet is skipped, since its folder name is unknown.

### 2. Temporal Auto-Backup Engine
* **Automatic `.torrent` Archival**: the archive is written the moment the engine knows the
  metadata, so a download that is still in flight already has a real `.torrent` in the vault.
  * For file-based torrents the raw `.torrent` bytes are archived.
  * For magnet links MakeMake synthesizes a standard `.torrent` from the Bencoded metadata the
    swarm returned — no separate "convert" step needed.
* **Archive Refresh Interval** (*Instant / 1 h / 6 h / 12 h / 24 h / 3 d / 7 d*): controls how
  often the archived snapshot is refreshed while the payload is still downloading (all writes are
  temp-file + rename, so an archive is never observed half-written).
* **Post-Completion Migration**: completed `.torrent` archives are **moved** (not copied) into a
  dedicated `CompletedTorrents/` vault once the payload reaches 100 % hash verification.

### 3. Session Guard (Crash-Safe Resume)
* **Pause-on-exit is mandatory**: closing the window (X, Alt+F4, OS shutdown request) first hides
  the UI, then pauses every swarm — seeding or leeching, complete or not — drops all peer
  connections and flushes `librqbit`'s resume database (`session.json`, per-torrent `.bitv` piece
  maps, `.torrent` bytes) before the process exits. Nothing is ever left half-written.
  * Both exit paths are covered: the window's `CloseRequested` **and** `RunEvent::ExitRequested`
    (OS shutdown/logoff, `app.exit()`, the last window being destroyed). The seal is idempotent, so
    they can never race.
* **Panic hook**: a panic is logged and gets a bounded (5 s, separate thread) attempt to pause every
  swarm and flush resume data. A panic on the UI thread then exits the process (the event loop
  cannot recover); a panic in a background task leaves the app running with everything paused.
* **Intent is remembered**: a durability checkpoint is written every 15 s, so even a hard crash
  still knows which swarms were live. On the next launch those swarms are re-armed automatically
  (optional) while explicitly paused swarms always stay parked.
* **Crash detection + archive self-repair**: a `session-active.marker` is written at launch and
  removed only after a clean seal. If the next launch finds it, the previous run died abruptly —
  the restored swarms are re-armed and every `.torrent` archive that is missing (or was never
  confirmed) is rewritten from the metadata `librqbit` restored. The auto-backup vault therefore
  doubles as the recovery path for the one piece of state a crash could otherwise lose: if the
  session database itself is gone, drag the archived `.torrent` files back in and the
  existing-folder prompt re-adopts the payload on disk instead of downloading it again.
* **Self-healing restore**: a restored swarm has to re-verify its pieces, and `librqbit` defers
  (and occasionally re-applies) a pause that lands mid-check — so MakeMake keeps re-arming until
  the swarm has been stably live, with a bounded retry budget.

### 4. Sacred Context HUD (Right-Click Context Menu)
* Comprehensive operational menu for each data monolith, grouped into
  **Transfer / Storage / Payload / Registry** sections:
  * ⚡ **Awaken (Resume/Start)** / ⏸ **Dormant (Pause)**: Start or choke the swarm connection.
    Both answer immediately — the engine returns the fresh row instead of leaving the UI to wait for
    the next poll.
  * 🌱 **Refresh Swarm Data**: scrape the trackers on demand for the seed/leecher counts.
  * 🧭 **Live swarm telemetry** in the panel header: seeds / leechers in the swarm (tracker scrape),
    peers connected / known, and the engine's own one-line explanation of what the torrent is doing.
  * 🔄 **Verify Obsidian Integrity (Force Recheck)**: Recalculate piece hashes against the local disk payload.
  * ⏱ **Swarm Priority** expander: High / Normal / Low (persisted, current value ticked).
  * 📂 **Open Sacred Chamber**: Open the torrent's payload folder. 🔍 **Reveal Payload** selects it in Explorer.
  * 📄 **Open Downloaded File** for single-file torrents.
  * 🗂 **Select Payload Files…**: Jump to the drawer's Files tab to change the file selection live.
  * 📋 **Copy to Clipboard** expander: info hash, magnet link, download path and the tracker URLs.
  * 💾 **Backup .torrent Now** and **Save .torrent As…** (native save dialog).
  * 🗑 **Remove from Swarm (Keep Files)** → 💥 **Purge Monolith & Files** (irreversible, hazard modal).
    The purge runs on a background thread and reports back: the row stays visible as
    `Deleting — 4 512 of 20 000 files`, then disappears with a toast naming how many files were
    erased (and the first one that could not be), so a delete is never a silent maybe.
* The panel measures itself before it is placed, so the destructive rows can never fall off the
  bottom of the window; it closes on scroll, resize, blur and Escape, and is keyboard navigable
  (↑/↓/Enter/Escape).
* Header actions: **Pause all / Resume all**. Status bar: **turtle throttle** toggle.

### 5. Swarm Telemetry (Seeds, Leechers, Peers)
* **Seeds and leechers come from the trackers, not from guesswork.** `librqbit` only reports the peers
  this client is connected to, so MakeMake scrapes the torrent's announce URLs directly — HTTP(S) via
  BEP-48 (`/announce` → `/scrape`) and UDP via BEP-15 — every 10 minutes, on add, on resume, and on
  demand from the context menu. Overlapping answers are merged with `max`, the number of trackers that
  replied is part of the row, and "no tracker answered" is rendered as `?` instead of a fake `0`.
* **Every row carries the numbers**: `SEEDS / LEECH` (swarm), `PEERS connected/known`, both speeds, and
  an **IDLE 90s** badge when a supposedly downloading torrent has not received a single verified byte
  for a while.
* **Every row explains itself**: a one-line status from the engine — `Verifying the data already on
  disk — 42% hashed`, `Connecting: 0 of 40 known peer(s) live, 3 dialling`, `Connected to 3 peer(s)
  but no data is flowing — they may not have the pieces you need (5 seed(s) in the swarm)`, `Seeding to
  2 peer(s)` — so a stalled swarm is diagnosable without reading logs.
* The `Wayfinding Peers` drawer tab lists the live peer registry (address, client, transport, counters)
  plus the scraped swarm sizes for that torrent.
* **Invisible work is never invisible.** Hashing a payload, erasing files from disk, resolving a
  magnet and waiting for an engine slot all render as an animated band (dash-chiselled verify glyph,
  falling purge shards, stepping-stone queue dots, a crawling magnet resolve) with the real counter
  the engine knows — verified pieces while hashing, erased files while purging — and a radar sweep
  next to `SEEDS` for exactly as long as a tracker scrape is in flight. States without a denominator
  crawl instead of inventing a percentage.
* **Every command is accounted for.** Add, start, pause, verify, purge, remove, scrape, priority, file
  selection, backup, export and settings each appear in a floating transmitter readout with a live
  elapsed counter, and say `STILL WORKING` after eight seconds — the window never looks wedged.
* **One poll, one manifest.** The one-second `get_snapshot` carries the file list of the torrent the
  drawer has open only; every other row carries its file count (and its payload path when it is a
  single-file torrent), and the rest is fetched on demand with `get_torrent_files`. Rows are memoised
  on the values they display, so a quiet queue costs almost nothing.

### 6. Safety Gates & Irreversible Action Modals
* Removal and deletion actions are protected by a cyberpunk hazard dialogue detailing exact file paths and sizes to prevent accidental data loss.

### 7. Cyber-Polynesian UI Gizmos
* **Swarm Astrolabe**: the radar plots every managed swarm for real — the bearing is derived from the
  info hash, the radius is the verified completion of that swarm (rim = 0 %, core = 100 %), and the
  colour is its live engine state (leech / seed / paused / error). Hover a blip for its name,
  progress and status; the footer carries live down/up rates plus peer and DHT counts.
* **Ahu Block Matrix**: Visual piece picker and block allocation map styled as an obsidian stone mosaic.
* **Caldera Fluid Gauges**: Circular fluid vector dials displaying download/upload bandwidth and disk cache saturation.
* **Rongorongo Decryptor**: Live event stream rendering real engine state changes (adds, pauses, checks, completions).

---

## 🎨 Aesthetic Specifications

* **Palette**:
  * **Obsidian Deep**: `#07090e`, `#0d1117`, `#161b22`
  * **Electric Cyan (Bioluminescence)**: `#00f0ff`
  * **Ceremonial Vermilion (Red Scoria / Pukao)**: `#ff2a6d`, `#ff4438`
  * **Rongorongo Gold / Sun Ochre**: `#e5b869`, `#ffd000`
  * **Volcanic Basalt Gray**: `#2d3748`
* **Typography**: Futuristic HUD monospaces, sharp angular geometric titles, and custom SVG Rongorongo glyph accents.
* **Audio-Visual FX**: Scanlines, CRT phosphor glow, holographic wireframes, and subtle micro-haptics.

---

## 🎬 Google Veo / Video Generation Prompt for Splash Screen

Use this exact prompt in **Google Veo / Imagen 3 Video / VideoFX** to generate the hypermodern cinematic background for the MakeMake splash screen:

> **Prompt:**  
> *"Cinematic 4K hypermodern cyberpunk reimagining of Easter Island (Rapa Nui). Massive monolithic Moai statues carved from reflective black volcanic obsidian and weathered basalt, towering over the crater cliffs of Rano Kau at midnight. Glowing neon cyan and ceremonial crimson laser circuitry veins pulse intricately across the statues' faces and chests. A stormy cybernetic Pacific ocean crashes below with bioluminescent electric teal waves. Holographic Polynesian star navigation charts, glowing cyber-petroglyphs, and floating geometric runes hover in the misty air around the statues. Volumetric fog, dark moody cyberpunk atmosphere, blade runner lighting, cinematic anamorphic lens flares, ultra-detailed 8k render, photorealistic, 60fps."*

*To install a custom video in MakeMake, simply place your generated `splash-moai.mp4` into the `public/` directory! MakeMake automatically falls back to an interactive real-time Canvas/CSS 3D cyber-Moai engine if no video is present.*

---

## 🏗️ Architecture & Technology Stack

* **Shell**: [Tauri v2](https://v2.tauri.app/) (Rust backend for memory safety, low resource footprint, and native OS interop)
* **Frontend**: React 19, TypeScript, Vite
* **Styling**: Tailwind CSS + Custom CSS Cyber Shaders
* **3D & Visualizations**: Three.js / React Three Fiber, Canvas2D procedural particle engines
* **Icons**: Custom SVG Rapa Nui & Cyberpunk Iconography + Lucide Icons
* **Torrent Core**: High-speed Rust BitTorrent coordinator (librqbit) with DHT metadata
  resolution, SHA-1 piece verification, automated disk persistence, and **sparse payload
  pre-allocation** so adding a 133 GiB torrent costs kilobytes instead of the whole torrent.
  Filesystem numbers (free space, real allocated size) come from `fs4`; torrent names are made
  path-safe with `sanitize-filename`.

---

## 🚀 Launching & Running with `run.ps1`

MakeMake includes an autonomous PowerShell launcher ([`run.ps1`](file:///d:/Projects/MakeMake/run.ps1)) that builds and launches the application as an **independent detached background process**, allowing you to close your terminal session at any time without terminating the app.

```powershell
# 1. Default: Build frontend + native desktop binary and launch detached (no console window)
.\run.ps1

# 2. Release Mode: Build fully optimized release binary and launch detached
.\run.ps1 -Release

# 3. Web Mode: Launch Vite dev preview server detached in background and open browser
.\run.ps1 -Mode Web

# 4. Instant Launch: Skip the build step and run the existing binary immediately
.\run.ps1 -SkipBuild

# 5. Windows NSIS Installer Package: Compile & package installer (.exe) with embedded uninstaller
.\run.ps1 -Installer

# 6. Attach a debug console (GUI subsystem is otherwise always used, so no window appears)
.\run.ps1 -Console

# 7. Help & Parameters:
.\run.ps1 -Help
```

Prefer zero windows at all? Double-click **`MakeMake.vbs`** — it launches the compiled binary (or
builds once, fully hidden) without any PowerShell or console window.

---

## 🗑️ Clean Uninstallation & Environment Sanitizer

MakeMake is engineered with strict uninstallation cleanliness:
1. **Direct `uninstall.exe` Execution**: When the native Windows NSIS uninstaller (`uninstall.exe`) is executed (either from Windows Settings or clicked directly in `%LOCALAPPDATA%\Programs\makemake`), custom NSIS lifecycle hooks (`NSIS_HOOK_PREUNINSTALL` and `NSIS_HOOK_POSTUNINSTALL`) execute to terminate any active swarm processes and **cleanly wipe all application data, WebView2 shader caches, logs, and state** from `%LOCALAPPDATA%\org.makemake.app` and registry keys.
2. **One-Click Script Sanitizer (`uninstall.ps1`)**:
```powershell
# Instant clean uninstallation & cache wipe
.\uninstall.ps1

# Complete purge including target/ and dist/ build caches
.\uninstall.ps1 -PurgeBuildArtifacts
```

---

## 🎬 Dual Video Engine Allocation

The project incorporates two generated video loops:
* **`public/splash-moai-longer.mp4` (~10s)**: Main animated video for the **Splash Screen** and ambient **App Canvas Looping Background** (with real-time toggle `[VIDEO: ON/OFF]` in the footer bar).
* **`public/splash-moai.mp4` (shorter loop)**: Used for the **torrent ingestion modal** canvas, and sampled into the **NSIS installer / uninstaller** artwork (`src-tauri/installer/installer-sidebar.bmp`, `installer-header.bmp`, `uninstaller-header.bmp`). NSIS can only render bitmaps, so the clip is sampled at a few timestamps:

```bash
# Requires Python + opencv-python (pip install opencv-python)
python scripts/generate-installer-art.py
```

### Manual Development Commands
```bash
# Web Development mode (Browser preview with mock IPC)
npm run dev

# Tauri Desktop Dev Mode
npm run tauri dev

# Production Build (TypeScript check + Vite bundle)
npm run build

# Native engine tests (offline librqbit sessions, filesystem helpers)
cd src-tauri && cargo test --release --locked
```

## 📜 License

MakeMake is released under the **Apache License, Version 2.0**.

```
Copyright 2026 Abhishek Mitra (indoctrinatedrecluse)
```

* Full terms: [`LICENSE`](LICENSE) — the verbatim Apache 2.0 text with the copyright notice appended.
* Attribution: [`NOTICE`](NOTICE).
* SPDX identifier: `Apache-2.0` (also declared in `package.json`, `src-tauri/Cargo.toml` and the
  Windows bundle, so the installed executable and the NSIS installer carry the same terms).

You may use, modify and redistribute this software — including commercially — provided you keep
the license and copyright notices, state significant changes, and include a copy of the license.
The software is provided **"AS IS", without warranties or conditions of any kind**; see Sections
7 and 8 of the license for the full disclaimer and limitation of liability.

