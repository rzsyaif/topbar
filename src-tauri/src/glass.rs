//! The glass look is drawn entirely in CSS now.
//!
//! Earlier builds put a native Windows blur behind the island and clipped the
//! window to the island's shape. On Windows 11 the blur filled the whole
//! (invisible, 640×800) window, and the clipping made the island's rounded
//! edges jagged, because Windows window regions can't be anti-aliased. So the
//! native route is gone: these commands just make sure no blur or clipping is
//! left on the window.

use serde::Deserialize;
use tauri::WebviewWindow;

#[derive(Debug, Deserialize, Clone, Copy)]
#[allow(dead_code)]
pub struct Shape {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub r: f64,
}

#[derive(Default)]
pub struct GlassState;

/// Clears any native effect or clipping on the window.
#[tauri::command]
pub fn set_glass(window: WebviewWindow, _enabled: bool) -> Result<(), String> {
    let _ = window.set_effects(None::<tauri::utils::config::WindowEffectsConfig>);
    imp::clear_region(&window);
    Ok(())
}

/// Kept for compatibility; no longer clips anything.
#[tauri::command]
pub fn set_island_shape(_shapes: Vec<Shape>) -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
mod imp {
    use tauri::WebviewWindow;
    use windows::Win32::{Foundation::HWND, Graphics::Gdi::{SetWindowRgn, HRGN}};

    pub fn clear_region(w: &WebviewWindow) {
        if let Ok(h) = w.hwnd() {
            unsafe {
                SetWindowRgn(HWND(h.0 as _), HRGN::default(), true);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::WebviewWindow;
    pub fn clear_region(_: &WebviewWindow) {}
}
