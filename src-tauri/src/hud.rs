//! Watches volume and brightness so the island can show a level bar when you
//! change them with the keyboard (like the iPhone's Dynamic Island).

use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::system;

/// Volume: a cheap Core Audio read a few times a second; only changes are sent.
pub fn watch_volume(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<(i32, bool)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(150));
            let Ok(v) = system::volume_now() else { continue };
            let now = ((v.level * 100.0).round() as i32, v.muted);
            if last.is_some() && last != Some(now) {
                let _ = app.emit("volume-changed", &v);
            }
            last = Some(now);
        }
    });
}

/// Brightness: laptops report changes through a WMI event. One hidden
/// PowerShell process waits for those events and prints each new level.
/// (External monitors don't send events, so this is laptop-only.)
pub fn watch_brightness(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        const SCRIPT: &str = "Register-CimIndicationEvent -Namespace root/wmi -ClassName WmiMonitorBrightnessEvent -SourceIdentifier IslandBrightness -ErrorAction Stop | Out-Null; \
            while ($true) { $e = Wait-Event -SourceIdentifier IslandBrightness; \
            [Console]::Out.WriteLine($e.SourceEventArgs.NewEvent.Brightness); [Console]::Out.Flush(); \
            Remove-Event -EventIdentifier $e.EventIdentifier }";

        // Restart the listener if it ever stops, but give up if WMI isn't there.
        for _ in 0..5 {
            let Ok(mut child) = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .creation_flags(0x0800_0000)
                .spawn()
            else {
                return;
            };
            let started = std::time::Instant::now();
            if let Some(out) = child.stdout.take() {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Ok(v) = line.trim().parse::<u32>() {
                        let _ = app.emit("brightness-changed", v);
                    }
                }
            }
            let _ = child.wait();
            if started.elapsed() < Duration::from_secs(10) {
                return; // failed straight away: no WMI brightness on this PC
            }
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}
