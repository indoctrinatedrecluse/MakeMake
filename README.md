# 🗿 MAKEMAKE (マケマケ)
### *Hypermodern Cyberpunk BitTorrent Client Steeped in Rapa Nui Mythology*

```
                     .---.
                    /     \
                   | () () |       MAKEMAKE PROTOCOL v0.1.0
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
  * Files are written exactly where you choose; every torrent keeps its own output folder.

### 2. Temporal Auto-Backup Engine
* **Automatic `.torrent` Archival**:
  * For file-based torrents, backs up the raw `.torrent` file to a secure vault directory.
  * For magnet links, automatically serializes the fetched Bencoded metadata into a standard `.torrent` file and archives it.
* **Configurable Backup Intervals**:
  * Options: *Instant*, *1 Hour*, *6 Hours*, *12 Hours*, *24 Hours*, *3 Days*, *7 Days*.
* **Post-Completion Migration**:
  * Option to automatically move completed `.torrent` archives into a dedicated `Finished/` vault once the payload reaches 100% hash verification.

### 3. Sacred Context HUD (Right-Click Context Menu)
* Comprehensive operational menu for each data monolith:
  * ⚡ **Awaken (Resume/Start)** / ⏸ **Dormant (Pause)**: Start or choke the swarm connection.
  * 🔄 **Verify Obsidian Integrity (Force Recheck)**: Recalculate piece hashes against the local disk payload.
  * 📂 **Open Sacred Chamber**: Open the download directory. 🔍 **Reveal Payload** selects it in Explorer.
  * 📄 **Open Downloaded File** for single-file torrents.
  * 🗂 **Select Payload Files…**: Jump to the drawer's Files tab to change the file selection live.
  * 📋 **Copy Info Hash / Magnet Link / Download Path**.
  * ⏱ **Swarm Priority** submenu: High / Normal / Low (persisted).
  * 💾 **Backup .torrent Now** and **Save .torrent As…** (native save dialog).
  * 🗑 **Remove from Swarm (Deregister)** — keeps the data on disk.
  * 💥 **Purge Monolith & Files** — irreversible, behind the hazard modal.
* Header actions: **Pause all / Resume all**. Status bar: **turtle throttle** toggle.

### 4. Safety Gates & Irreversible Action Modals
* Removal and deletion actions are protected by a cyberpunk hazard dialogue detailing exact file paths and sizes to prevent accidental data loss.

### 5. Cyber-Polynesian UI Gizmos
* **Swarm Astrolabe**: Interactive celestial/swell radar visualizing peer nodes, ping latencies, and geographic distribution.
* **Ahu Block Matrix**: Visual piece picker and block allocation map styled as an obsidian stone mosaic.
* **Caldera Fluid Gauges**: Circular fluid vector dials displaying download/upload bandwidth and disk cache saturation.
* **Rongorongo Decryptor**: Live streaming cyber-petroglyphs rendering DHT queries, peer handshakes, and tracker announces.

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
* **Torrent Core**: High-speed Rust BitTorrent coordinator supporting Bencode parsing, DHT metadata resolution, SHA-1 piece verification, and automated disk persistence.

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

# Production Build
npm run build
```
