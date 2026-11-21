//! Is the person at the keyboard, and are they busy with something full-screen?
//! Used by the hydration / standing reminders so they don't fire into an
//! empty room or over a game or presentation.

use serde::Serialize;

#[derive(Serialize)]
pub struct Activity {
    /// Milliseconds since the last keyboard or mouse input.
    idle_ms: u64,
    /// A full-screen app or game, a presentation, or Windows' quiet hours.
    busy: bool,
}

#[tauri::command]
pub fn activity() -> Activity {
    Activity { idle_ms: imp::idle_ms(), busy: imp::busy() }
}

#[cfg(windows)]
mod imp {
    use windows::Win32::{
        System::SystemInformation::GetTickCount,
        UI::{
            Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
            Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_QUIET_TIME, QUNS_RUNNING_D3D_FULL_SCREEN},
        },
    };

    pub fn idle_ms() -> u64 {
        unsafe {
            let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            GetTickCount().wrapping_sub(info.dwTime) as u64
        }
    }

    pub fn busy() -> bool {
        match unsafe { SHQueryUserNotificationState() } {
            Ok(s) => s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE || s == QUNS_QUIET_TIME,
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn idle_ms() -> u64 {
        0
    }
    pub fn busy() -> bool {
        false
    }
}
