//! Screen colour picker.
//!
//! Opens a transparent full-screen window over the monitor under the cursor.
//! That window is excluded from screen capture, so sampling the screen sees
//! what's underneath it. The page draws a magnifier from an 11×11 sample
//! around the cursor; clicking picks the centre pixel.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "picker";
/// Side of the sampled square, in pixels (odd, so there's a centre).
pub const GRID: i32 = 11;

#[derive(Serialize, Clone)]
pub struct Sample {
    pub hex: String,
    /// GRID×GRID pixels, row by row, as [r, g, b, r, g, b, …].
    pub pixels: Vec<u8>,
}

/// Opens the picker over the monitor the cursor is on.
#[tauri::command]
pub async fn picker_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("main window missing")?;
    let cursor = main.cursor_position().map_err(|e| e.to_string())?;
    let monitors = main.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| {
            let p = m.position();
            let s = m.size();
            cursor.x >= p.x as f64
                && cursor.y >= p.y as f64
                && cursor.x < (p.x + s.width as i32) as f64
                && cursor.y < (p.y + s.height as i32) as f64
        })
        .or_else(|| monitors.first())
        .ok_or("no monitor")?
        .clone();

    let win = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html#picker".into()))
        .title("Pick a colour")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.set_position(PhysicalPosition::new(monitor.position().x, monitor.position().y));
    let _ = win.set_size(PhysicalSize::new(monitor.size().width, monitor.size().height));
    imp::exclude_from_capture(&win);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// The pixels around the cursor right now.
#[tauri::command]
pub fn picker_sample() -> Result<Sample, String> {
    imp::sample()
}

/// Called by the picker page. `hex` is None when cancelled (Esc).
/// Copies the colour as text and tells the island.
#[tauri::command]
pub fn picker_done(app: AppHandle, hex: Option<String>) -> Result<(), String> {
    if let Some(h) = &hex {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.set_text(h.clone());
        }
        let _ = app.emit("color-picked", h);
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    Ok(())
}

#[cfg(windows)]
mod imp {
    use super::{Sample, GRID};
    use windows::Win32::{
        Foundation::{HWND, POINT},
        Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
            SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY,
        },
        UI::WindowsAndMessaging::{GetCursorPos, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE},
    };

    pub fn exclude_from_capture(win: &tauri::WebviewWindow) {
        if let Ok(h) = win.hwnd() {
            unsafe {
                let _ = SetWindowDisplayAffinity(HWND(h.0 as _), WDA_EXCLUDEFROMCAPTURE);
            }
        }
    }

    pub fn sample() -> Result<Sample, String> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p) }.map_err(|e| e.message().to_string())?;
        let half = GRID / 2;
        let mut bgra = vec![0u8; (GRID * GRID * 4) as usize];
        unsafe {
            let screen = GetDC(HWND::default());
            let mem = CreateCompatibleDC(screen);
            let bmp = CreateCompatibleBitmap(screen, GRID, GRID);
            let old = SelectObject(mem, HGDIOBJ(bmp.0));
            let ok = BitBlt(mem, 0, 0, GRID, GRID, screen, p.x - half, p.y - half, SRCCOPY | CAPTUREBLT).is_ok();
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: GRID,
                    biHeight: -GRID, // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let lines = GetDIBits(mem, bmp, 0, GRID as u32, Some(bgra.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
            SelectObject(mem, old);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(mem);
            ReleaseDC(HWND::default(), screen);
            if !ok || lines == 0 {
                return Err("couldn't read the screen".into());
            }
        }
        let pixels: Vec<u8> = bgra.chunks_exact(4).flat_map(|c| [c[2], c[1], c[0]]).collect();
        let centre = ((half * GRID + half) * 3) as usize;
        let hex = format!("#{:02X}{:02X}{:02X}", pixels[centre], pixels[centre + 1], pixels[centre + 2]);
        Ok(Sample { hex, pixels })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Sample;
    pub fn exclude_from_capture(_: &tauri::WebviewWindow) {}
    pub fn sample() -> Result<Sample, String> {
        Err("only available on Windows".into())
    }
}
