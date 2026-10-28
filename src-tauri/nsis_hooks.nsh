; =====================================================================
; MakeMake // Rapa Nui Cyberpunk Swarm Engine - NSIS Installer Hooks
; =====================================================================
; Provides total eradication of all client binaries, shortcuts,
; WebView2 application cache (%LOCALAPPDATA%\org.makemake.app),
; petroglyph telemetry logs, and registry keys upon uninstallation.
; Works whether initiated from Windows Settings or by directly running uninstall.exe.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "MakeMake // Initializing Tangata-Manu Swarm Installation..."
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "MakeMake // Moai Monolith suite installed successfully."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "MakeMake // Terminating active swarm engine processes..."
  nsExec::Exec 'taskkill /F /IM makemake.exe /T'

  DetailPrint "MakeMake // Purging WebView2 state, shader caches, and telemetry logs..."
  RMDir /r "$LOCALAPPDATA\org.makemake.app"
  RMDir /r "$APPDATA\org.makemake.app"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "MakeMake // Purging remaining storage directories..."
  RMDir /r "$LOCALAPPDATA\org.makemake.app"
  RMDir /r "$APPDATA\org.makemake.app"
  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "Software\org.makemake.app"
  DeleteRegKey HKCU "Software\MakeMake"

  DetailPrint "MakeMake // Clean uninstallation complete. Swarm eradicated."
!macroend
