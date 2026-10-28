$ErrorActionPreference = 'Stop'
$p = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri\target\debug\makemake.exe'
$fs = [IO.File]::OpenRead($p)
$br = New-Object IO.BinaryReader($fs)
$fs.Position = 0x3C
$pe = $br.ReadInt32()
$fs.Position = $pe + 0x18 + 0x44
$sub = $br.ReadUInt16()
$br.Close()
$fs.Close()
Write-Output ("PE subsystem = {0} (2 = GUI / no console window, 3 = console)" -f $sub)
