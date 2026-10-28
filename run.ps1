<#
.SYNOPSIS
    MakeMake // Rapa Nui Cyberpunk BitTorrent Engine Launcher
.DESCRIPTION
    Builds and launches MakeMake as an independent process so it continues running
    even after the terminal session is closed.
.PARAMETER Mode
    'Desktop' (default): Builds and runs the native Tauri v2 desktop application.
    'Web': Runs the Vite web preview server and launches your default browser.
.PARAMETER Release
    Compiles with full optimizations (--release).
.PARAMETER Installer
    Compiles and packages the complete Windows NSIS installer and uninstaller suite.
.PARAMETER SkipBuild
    Skips the build step and launches the existing compiled binary directly.
.PARAMETER Port
    Port for Web mode (default: 1420).
.EXAMPLE
    .\run.ps1
    Builds and launches the native desktop app detached in background.
.EXAMPLE
    .\run.ps1 -Release
    Builds and launches the optimized release binary detached.
.EXAMPLE
    .\run.ps1 -Mode Web
    Launches web server in background and opens browser.
.EXAMPLE
    .\run.ps1 -SkipBuild
    Launches the compiled desktop binary immediately without rebuilding.
#>

[CmdletBinding()]
param(
    [ValidateSet('Desktop', 'Web')]
    [string]$Mode = 'Desktop',

    [switch]$Release,
    [switch]$Installer,
    [switch]$SkipBuild,
    [switch]$Console,
    [int]$Port = 1420,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

function Show-Banner {
    Write-Host @"
   .---.
  /     \      MAKEMAKE PROTOCOL // RAPA NUI SWARM ENGINE
 | () () |     AHU-ONLINE // TANGATA-MANU DAEMON
  \  ^  /      Target Mode: $Mode $(if ($Release) { '[RELEASE]' } else { '[DEBUG]' })
   |||||
  /=====\
 /       \
"@ -ForegroundColor Cyan
}

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    exit 0
}

Show-Banner
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

# 1. Dependency Pre-flight Check
Write-Host "[1/3] Verifying environment & dependencies..." -ForegroundColor Yellow

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js was not found in PATH. Please install Node.js (v18+)."
    exit 1
}

if ($Mode -eq 'Desktop' -and -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "Rust toolchain (cargo) was not found in PATH. Please install Rust."
    exit 1
}

if (-not (Test-Path "$ProjectRoot\node_modules")) {
    Write-Host "Installing npm dependencies (node_modules not found)..." -ForegroundColor Cyan
    npm install
}

# 2. Build Pipeline
# A running instance keeps a lock on makemake.exe, which would make the cargo
# link step fail with "Access is denied", so close it before building.
$running = Get-Process -Name 'makemake' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "[1/3] Closing running MakeMake instance(s) before rebuild..." -ForegroundColor Yellow
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
}

if ($Installer) {
    Write-Host "[2/3] Compiling and packaging MakeMake Windows NSIS Installer..." -ForegroundColor Cyan
    npm run build
    npx tauri build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Tauri installer packaging failed with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }
    Write-Host ""
    Write-Host "[OK] MAKEMAKE INSTALLER PACKAGING COMPLETE!" -ForegroundColor Green
    Write-Host "Installer location: $ProjectRoot\src-tauri\target\release\bundle\nsis\" -ForegroundColor Cyan
    exit 0
}

if (-not $SkipBuild) {
    Write-Host "[2/3] Building frontend assets (Vite + TypeScript)..." -ForegroundColor Cyan
    npm run build

    if ($Mode -eq 'Desktop') {
        Write-Host "[2/3] Compiling Tauri v2 Rust backend..." -ForegroundColor Cyan
        $CargoArgs = @('build', '--manifest-path', "$ProjectRoot\src-tauri\Cargo.toml")
        if ($Release) {
            $CargoArgs += '--release'
        }
        if ($Console) {
            $CargoArgs += '--features'
            $CargoArgs += 'console'
        }
        & cargo @CargoArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Cargo build failed with exit code $LASTEXITCODE."
            exit $LASTEXITCODE
        }
    }
} else {
    Write-Host "[2/3] Skipping build step as requested (-SkipBuild)." -ForegroundColor Green
}

# 3. Independent Detached Execution
Write-Host "[3/3] Engaging swarm process (Detached mode)..." -ForegroundColor Magenta

if ($Mode -eq 'Desktop') {
    $TargetSubdir = if ($Release) { 'release' } else { 'debug' }
    $BinaryPath = "$ProjectRoot\src-tauri\target\$TargetSubdir\makemake.exe"

    if (-not (Test-Path $BinaryPath)) {
        Write-Error "Compiled executable not found at: $BinaryPath. Please run without -SkipBuild first."
        exit 1
    }

    # Start-Process detached and hidden so no console window ever appears next to
    # the GUI (the debug binary would otherwise attach a visible console).
    $Proc = Start-Process -FilePath $BinaryPath -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru

    # Allow a brief moment for the window to initialize and verify process health
    Start-Sleep -Milliseconds 800
    if ($Proc.HasExited) {
        Write-Error "MakeMake process exited unexpectedly with ExitCode $($Proc.ExitCode). Please run in debug mode to inspect output."
        exit 1
    }

    Write-Host ""
    Write-Host "[OK] SUCCESS: MakeMake Desktop is running independently!" -ForegroundColor Green
    Write-Host "Process ID (PID) : $($Proc.Id)" -ForegroundColor DarkCyan
    Write-Host "Binary Location  : $BinaryPath" -ForegroundColor DarkGray
    Write-Host "You can now safely close this terminal window without interrupting MakeMake." -ForegroundColor Cyan
    Write-Host ""
}
else {
    # Web Mode: Start background Vite dev server detached
    $Url = "http://localhost:$Port"
    $Proc = Start-Process powershell -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-Command", "Set-Location '$ProjectRoot'; npm run dev -- --port $Port" -PassThru

    Start-Sleep -Seconds 2
    Start-Process $Url

    Write-Host ""
    Write-Host "[OK] SUCCESS: MakeMake Web Preview is running in the background!" -ForegroundColor Green
    Write-Host "Process ID (PID) : $($Proc.Id)" -ForegroundColor DarkCyan
    Write-Host "URL              : $Url" -ForegroundColor Cyan
    Write-Host "You can now safely close this terminal window without interrupting the server." -ForegroundColor Cyan
    Write-Host ""
}
