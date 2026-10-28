' =====================================================================
' MakeMake // Silent Launcher
' =====================================================================
' Double-click this file to launch MakeMake with NO PowerShell / console
' window at all. It prefers the release binary, falls back to the debug
' binary, and only runs the full build script when nothing is compiled.
Option Explicit

Dim shell, fso, root, releaseExe, debugExe, ps1
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
releaseExe = root & "\src-tauri\target\release\makemake.exe"
debugExe = root & "\src-tauri\target\debug\makemake.exe"
ps1 = root & "\run.ps1"

shell.CurrentDirectory = root

If fso.FileExists(releaseExe) Then
    shell.Run """" & releaseExe & """", 0, False
ElseIf fso.FileExists(debugExe) Then
    shell.Run """" & debugExe & """", 0, False
ElseIf fso.FileExists(ps1) Then
    ' Nothing compiled yet: build + launch, fully hidden.
    shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
Else
    MsgBox "MakeMake could not be located. Expected run.ps1 or a compiled binary.", 16, "MakeMake"
End If
