//! Screen recording via Windows' own Snipping Tool, plus keeping the island
//! out of screenshots and recordings.
//!
//! Win+Shift+R opens Snipping Tool's recording overlay (pick an area, Start,
//! Stop). Recordings save to Videos\Screen Recordings.

use tauri::{AppHandle, Manager, WebviewWindow};

/// Opens Snipping Tool's screen-recording overlay.
#[tauri::command]
pub fn start_screen_record() -> Result<(), String> {
    imp::send_win_shift_r()
}

/// Opens the folder Snipping Tool saves recordings to.
#[tauri::command]
pub fn open_recordings(app: AppHandle) -> Result<(), String> {
    let videos = app.path().video_dir().map_err(|e| e.to_string())?;
    let folder = videos.join("Screen Recordings");
    let target = if folder.exists() { folder } else { videos };
    std::process::Command::new("explorer")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Hides (or shows) the island in screenshots and screen recordings. It stays
/// visible on your screen either way.
#[tauri::command]
pub fn set_capture_hidden(window: WebviewWindow, hidden: bool) -> Result<(), String> {
    imp::set_capture_hidden(&window, hidden)
}

#[cfg(windows)]
mod imp {
    use tauri::WebviewWindow;
    use windows::Win32::{
        Foundation::HWND,
        UI::{
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
                VK_LWIN, VK_SHIFT,
            },
            WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE},
        },
    };

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn send_win_shift_r() -> Result<(), String> {
        let r = VIRTUAL_KEY(b'R' as u16);
        let inputs = [
            key(VK_LWIN, false),
            key(VK_SHIFT, false),
            key(r, false),
            key(r, true),
            key(VK_SHIFT, true),
            key(VK_LWIN, true),
        ];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() {
            Ok(())
        } else {
            Err("Windows blocked the shortcut".into())
        }
    }

    pub fn set_capture_hidden(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd.0 as _);
        let affinity = if hidden { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        unsafe { SetWindowDisplayAffinity(hwnd, affinity) }.map_err(|e| e.message().to_string())
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::WebviewWindow;
    pub fn send_win_shift_r() -> Result<(), String> {
        Err("only available on Windows".into())
    }
    pub fn set_capture_hidden(_: &WebviewWindow, _: bool) -> Result<(), String> {
        Ok(())
    }
}
