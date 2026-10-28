<#
.SYNOPSIS
    MakeMake Clean Uninstaller & Environment Sanitizer
.DESCRIPTION
    Safely terminates running MakeMake instances and cleanly purges all application
    data, WebView2 caches, shader caches, logs, and installed binaries.
.PARAMETER PurgeBuildArtifacts
    Also deletes local dist/ and target/ build artifacts.
#>

[CmdletBinding()]
param(
    [switch]$PurgeBuildArtifacts
)

$ErrorActionPreference = 'SilentlyContinue'

Write-Host @"
   .---.
  /     \      MAKEMAKE // PROTOCOL SANITIZATION DAEMON
 | () () |     Purging Swarm Data & Clean Uninstallation
  \  ^  /
   |||||
  /=====\
 /       \
"@ -ForegroundColor Red

# 1. Terminate running processes
Write-Host "[1/4] Stopping active MakeMake processes..." -ForegroundColor Yellow
$makemakeProcesses = Get-Process -Name makemake -ErrorAction SilentlyContinue
if ($makemakeProcesses) {
    $makemakeProcesses | Stop-Process -Force
    Start-Sleep -Milliseconds 500
    Write-Host "  -> Terminated active MakeMake process(es)." -ForegroundColor Cyan
} else {
    Write-Host "  -> No running MakeMake processes found." -ForegroundColor DarkGray
}

# 2. Clean WebView2 cache and application data
Write-Host "[2/4] Purging application storage and telemetry caches..." -ForegroundColor Yellow
$PathsToClean = @(
    "$env:LOCALAPPDATA\org.makemake.app",
    "$env:APPDATA\org.makemake.app"
)

foreach ($dir in $PathsToClean) {
    if (Test-Path $dir) {
        Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  -> Purged: $dir" -ForegroundColor Green
    }
}

# 3. Check for installed application directory in Programs
Write-Host "[3/4] Checking installed application directory..." -ForegroundColor Yellow
$InstalledDir = "$env:LOCALAPPDATA\Programs\makemake"
if (Test-Path $InstalledDir) {
    $Uninstaller = "$InstalledDir\uninstall.exe"
    if (Test-Path $Uninstaller) {
        Write-Host "  -> Executing native uninstaller: $Uninstaller..." -ForegroundColor Cyan
        Start-Process -FilePath $Uninstaller -ArgumentList "/S" -Wait
    }
    Remove-Item -Path $InstalledDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  -> Eradicated: $InstalledDir" -ForegroundColor Green
} else {
    Write-Host "  -> No installed program directory found in Programs." -ForegroundColor DarkGray
}

# 4. Optional: Purge build artifacts
if ($PurgeBuildArtifacts) {
    Write-Host "[4/4] Purging build artifacts (dist and target)..." -ForegroundColor Yellow
    if (Test-Path "$PSScriptRoot\dist") {
        Remove-Item -Path "$PSScriptRoot\dist" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  -> Removed: dist/" -ForegroundColor Green
    }
    if (Test-Path "$PSScriptRoot\src-tauri\target") {
        Remove-Item -Path "$PSScriptRoot\src-tauri\target" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  -> Removed: src-tauri/target/" -ForegroundColor Green
    }
} else {
    Write-Host "[4/4] Preserving local build artifacts (pass -PurgeBuildArtifacts to remove)." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "[OK] MAKEMAKE CLEAN ERADICATION COMPLETE." -ForegroundColor Green
Write-Host "All caches, telemetry logs, and state have been cleanly removed." -ForegroundColor Cyan
Write-Host ""
