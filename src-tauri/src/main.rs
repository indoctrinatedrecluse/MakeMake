// Prevents an extra console window on Windows for BOTH debug and release builds.
// Build with `--features console` (run.ps1 -Console) when you want a visible console
// for low-level debugging; normally logs go to the tauri-plugin-log file instead.
#![cfg_attr(not(feature = "console"), windows_subsystem = "windows")]

fn main() {
  makemake_lib::run();
}
