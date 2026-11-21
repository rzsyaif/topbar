//! The Shelf: a clipboard space for files and images, plus recent screen
//! captures.
//!
//! Clips are copies saved in %APPDATA%\com.kiki.island\clips. "Summoning" one
//! puts it on the Windows clipboard (images as pixels, other files as files),
//! ready to paste into Figma or anywhere else.
//!
//! Captures: Snipping Tool saves screenshots to Pictures\Screenshots and
//! recordings to Videos\Screen Recordings. A small watcher notices new files.

use std::{
    borrow::Cow,
    collections::HashSet,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{ipc::InvokeBody, AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    pub path: String,
    pub name: String,
    /// "image" | "video" | "file"
    pub kind: String,
    pub size: u64,
    pub modified_ms: u64,
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const VIDEO_EXT: &[&str] = &["mp4", "mov", "webm", "mkv"];

fn kind_of(p: &Path) -> &'static str {
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if IMAGE_EXT.contains(&ext.as_str()) {
        "image"
    } else if VIDEO_EXT.contains(&ext.as_str()) {
        "video"
    } else {
        "file"
    }
}

fn item(p: &Path) -> Option<FileItem> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(FileItem {
        path: p.to_string_lossy().into_owned(),
        name: p.file_name()?.to_string_lossy().into_owned(),
        kind: kind_of(p).into(),
        size: meta.len(),
        modified_ms,
    })
}

fn clips_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("clips");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Keeps only safe filename characters and makes the name unique in `dir`.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let clean: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect();
    let clean = clean.trim().trim_matches('.');
    let clean = if clean.is_empty() { "clip" } else { clean };
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (clean.to_string(), String::new()),
    };
    let mut p = dir.join(format!("{stem}{ext}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    p
}

/* ------------------------------------------------------------------ clips */

/// Everything on the shelf, newest first.
#[tauri::command]
pub fn clips_list(app: AppHandle) -> Result<Vec<FileItem>, String> {
    let dir = clips_dir(&app)?;
    let mut items: Vec<FileItem> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| item(&e.ok()?.path()))
        .collect();
    items.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(items)
}

/// Saves a dropped file. The bytes come as the raw request body; the file name
/// in the `x-name` header (URL-encoded).
#[tauri::command]
pub fn clip_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<FileItem, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected file bytes".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "clip".into());
    let path = unique_path(&clips_dir(&app)?, &name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    item(&path).ok_or_else(|| "couldn't read the saved clip".into())
}

/// Adds whatever is on the Windows clipboard right now: an image, or copied files.
#[tauri::command]
pub async fn clip_from_clipboard(app: AppHandle) -> Result<Vec<FileItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = clips_dir(&app)?;
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        if let Ok(files) = cb.get().file_list() {
            let mut out = Vec::new();
            for f in files {
                if let Some(name) = f.file_name().map(|n| n.to_string_lossy().into_owned()) {
                    let dest = unique_path(&dir, &name);
                    if std::fs::copy(&f, &dest).is_ok() {
                        out.extend(item(&dest));
                    }
                }
            }
            if !out.is_empty() {
                return Ok(out);
            }
        }
        let img = cb.get_image().map_err(|_| "The clipboard has no image or files".to_string())?;
        let rgba = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())
            .ok_or("unreadable clipboard image")?;
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let dest = unique_path(&dir, &format!("Pasted image {secs}.png"));
        rgba.save(&dest).map_err(|e| e.to_string())?;
        Ok(item(&dest).into_iter().collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes a clip (only files inside the clips folder).
#[tauri::command]
pub fn clip_delete(app: AppHandle, path: String) -> Result<(), String> {
    let dir = clips_dir(&app)?;
    let p = PathBuf::from(&path);
    if p.parent() != Some(dir.as_path()) {
        return Err("not a clip".into());
    }
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

/* --------------------------------------------------------------- clipboard */

/// Puts a file on the Windows clipboard: images as pixels (paste straight into
/// Figma, Slack, docs), anything else as a file (paste in Explorer, or into
/// apps that accept files).
#[tauri::command]
pub async fn copy_to_clipboard(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        if kind_of(&p) == "image" {
            let img = image::open(&p).map_err(|e| e.to_string())?.to_rgba8();
            let (w, h) = img.dimensions();
            cb.set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: Cow::Owned(img.into_raw()),
            })
            .map_err(|e| e.to_string())
        } else {
            cb.set().file_list(&[p]).map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens a file in its default app.
#[tauri::command]
pub fn open_path(path: String, reveal: Option<bool>) -> Result<(), String> {
    let mut cmd = std::process::Command::new("explorer");
    if reveal.unwrap_or(false) {
        cmd.arg(format!("/select,{path}"));
    } else {
        cmd.arg(&path);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/* ---------------------------------------------------------------- captures */

fn capture_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(p) = app.path().picture_dir() {
        dirs.push(p.join("Screenshots"));
    }
    if let Ok(v) = app.path().video_dir() {
        dirs.push(v.join("Screen Recordings"));
    }
    dirs
}

fn scan_captures(app: &AppHandle) -> Vec<FileItem> {
    let mut items: Vec<FileItem> = capture_dirs(app)
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flatten()
        .filter_map(|e| item(&e.ok()?.path()))
        .filter(|i| i.kind != "file")
        .collect();
    items.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    items
}

/// The most recent screenshots and recordings, newest first.
#[tauri::command]
pub fn captures_recent(app: AppHandle, limit: Option<usize>) -> Vec<FileItem> {
    let mut items = scan_captures(&app);
    items.truncate(limit.unwrap_or(12));
    items
}

/// Watches the capture folders and emits "capture-added" for new files.
pub fn watch_captures(app: AppHandle) {
    std::thread::spawn(move || {
        let mut seen: HashSet<String> = scan_captures(&app).into_iter().map(|i| i.path).collect();
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            for i in scan_captures(&app) {
                if seen.contains(&i.path) {
                    continue;
                }
                // Recordings are written over time; wait until the size settles.
                if i.kind == "video" {
                    std::thread::sleep(Duration::from_millis(800));
                    if item(Path::new(&i.path)).map(|n| n.size) != Some(i.size) {
                        continue;
                    }
                }
                seen.insert(i.path.clone());
                let _ = app.emit("capture-added", &i);
            }
        }
    });
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
