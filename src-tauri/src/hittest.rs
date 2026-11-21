//! Click-through handling.
//!
//! The island window is larger than the pill so the pill can grow without
//! resizing the native window. Everything outside the pill must let clicks
//! pass through to the apps underneath. The frontend reports the pill's
//! rectangle; a small loop watches the cursor and turns mouse events on only
//! while the cursor is over the pill.

use std::{
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use serde::Deserialize;
use tauri::WebviewWindow;

/// Extra pixels around the pill that still count as "inside", so the edge
/// doesn't flicker between states.
const PADDING: f64 = 6.0;
const POLL: Duration = Duration::from_millis(30);

/// Pill rectangle in physical pixels, relative to the webview's top-left.
#[derive(Debug, Deserialize, Clone, Copy, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Default)]
pub struct HitRect(pub Arc<Mutex<Option<Rect>>>);

#[tauri::command]
pub fn set_hit_rect(state: tauri::State<HitRect>, rect: Rect) {
    if let Ok(mut r) = state.0.lock() {
        *r = Some(rect);
    }
}

pub fn start(win: WebviewWindow, rect: HitRect) {
    thread::spawn(move || {
        let mut ignoring = true;
        loop {
            thread::sleep(POLL);

            let inside = (|| {
                let r = (*rect.0.lock().ok()?)?;
                let cursor = win.cursor_position().ok()?; // screen coords
                let origin = win.inner_position().ok()?; // webview top-left on screen
                let cx = cursor.x - origin.x as f64;
                let cy = cursor.y - origin.y as f64;
                Some(
                    cx >= r.x - PADDING
                        && cx <= r.x + r.w + PADDING
                        && cy >= r.y - PADDING
                        && cy <= r.y + r.h + PADDING,
                )
            })()
            .unwrap_or(false);

            let should_ignore = !inside;
            if should_ignore != ignoring {
                if win.set_ignore_cursor_events(should_ignore).is_ok() {
                    ignoring = should_ignore;
                }
            }
        }
    });
}
