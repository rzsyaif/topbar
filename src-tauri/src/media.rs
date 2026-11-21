//! Now-playing info and controls via Windows System Media Transport Controls
//! (SMTC). Spotify desktop, Chrome/Edge (YouTube Music, YouTube, etc.) and most
//! media apps publish to SMTC, so one integration covers all of them.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub has_session: bool,
    /// e.g. "Spotify.exe", "Chrome", "MSEdge"
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    /// Position at `updated_at_ms`. The frontend interpolates from here.
    pub position_ms: i64,
    pub duration_ms: i64,
    /// Unix ms when SMTC last updated the position.
    pub updated_at_ms: i64,
    /// data: URL of the album art, if any.
    pub artwork: Option<String>,
}

#[derive(Clone, Default)]
pub struct MediaStore(pub Arc<Mutex<MediaState>>);

#[tauri::command]
pub fn media_get(store: tauri::State<MediaStore>) -> MediaState {
    store.0.lock().map(|s| s.clone()).unwrap_or_default()
}

/// action: "toggle" | "play" | "pause" | "next" | "previous"
#[tauri::command]
pub async fn media_command(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || imp::command(&action))
        .await
        .map_err(|e| e.to_string())?
}

pub fn start(app: AppHandle, store: MediaStore) {
    imp::start(app, store);
}

#[cfg(windows)]
mod imp {
    use super::{MediaState, MediaStore};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use tauri::{AppHandle, Emitter};
    use windows::{
        core::{Interface, Result},
        Foundation::IAsyncOperation,
        Media::Control::{
            GlobalSystemMediaTransportControlsSession as Session,
            GlobalSystemMediaTransportControlsSessionManager as Manager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
        },
        Storage::Streams::DataReader,
        Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
    };

    const POLL: Duration = Duration::from_millis(500);
    /// Windows FILETIME epoch (1601) to Unix epoch, in 100ns ticks.
    const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    fn init_thread() {
        // Safe to call more than once; ignore "already initialized".
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
    }

    fn manager() -> Result<Manager> {
        Manager::RequestAsync()?.get()
    }

    fn read_artwork(session: &Session) -> Option<String> {
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let thumb = props.Thumbnail().ok()?;
        let stream = thumb.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 {
            return None;
        }
        let mime = stream
            .ContentType()
            .map(|h| h.to_string())
            .ok()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "image/png".into());
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        // DataReaderLoadOperation has no blocking get(); view it as IAsyncOperation<u32>.
        reader
            .LoadAsync(size)
            .ok()?
            .cast::<IAsyncOperation<u32>>()
            .ok()?
            .get()
            .ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;
        Some(format!("data:{};base64,{}", mime, STANDARD.encode(buf)))
    }

    /// Reads everything except artwork (that's fetched only on track change).
    fn snapshot(session: &Session) -> Result<MediaState> {
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        let playback = session.GetPlaybackInfo()?;
        let timeline = session.GetTimelineProperties()?;

        let playing = playback.PlaybackStatus()? == Status::Playing;
        let start = timeline.StartTime()?.Duration;
        let end = timeline.EndTime()?.Duration;
        let pos = timeline.Position()?.Duration;
        let updated = timeline.LastUpdatedTime()?.UniversalTime;
        let updated_at_ms = if updated > 0 {
            (updated - EPOCH_DIFF_TICKS) / 10_000
        } else {
            now_ms()
        };

        Ok(MediaState {
            has_session: true,
            app_id: session.SourceAppUserModelId()?.to_string(),
            title: props.Title()?.to_string(),
            artist: props.Artist()?.to_string(),
            album: props.AlbumTitle()?.to_string(),
            playing,
            position_ms: (pos - start).max(0) / 10_000,
            duration_ms: (end - start).max(0) / 10_000,
            updated_at_ms,
            artwork: None,
        })
    }

    pub fn start(app: AppHandle, store: MediaStore) {
        thread::spawn(move || {
            init_thread();
            let mut mgr: Option<Manager> = None;
            let mut last = MediaState::default();
            let mut last_track_key = String::new();
            let mut artwork: Option<String> = None;

            loop {
                if mgr.is_none() {
                    mgr = manager().ok();
                }

                let mut next = mgr
                    .as_ref()
                    .and_then(|m| m.GetCurrentSession().ok())
                    .and_then(|s| {
                        let mut st = snapshot(&s).ok()?;
                        let key = format!("{}|{}|{}", st.title, st.artist, st.album);
                        if key != last_track_key {
                            last_track_key = key;
                            artwork = read_artwork(&s);
                        } else if artwork.is_none() {
                            // Browsers sometimes publish artwork a moment after the title.
                            artwork = read_artwork(&s);
                        }
                        st.artwork = artwork.clone();
                        Some(st)
                    })
                    .unwrap_or_default();

                if !next.has_session {
                    last_track_key.clear();
                    artwork = None;
                    next.updated_at_ms = 0;
                }

                if next != last {
                    if let Ok(mut s) = store.0.lock() {
                        *s = next.clone();
                    }
                    let _ = app.emit("media-update", &next);
                    last = next;
                }

                thread::sleep(POLL);
            }
        });
    }

    pub fn command(action: &str) -> std::result::Result<(), String> {
        init_thread();
        let session = manager()
            .and_then(|m| m.GetCurrentSession())
            .map_err(|e| e.message().to_string())?;
        let op = match action {
            "toggle" => session.TryTogglePlayPauseAsync(),
            "play" => session.TryPlayAsync(),
            "pause" => session.TryPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            other => return Err(format!("unknown media action: {other}")),
        };
        op.and_then(|o| o.get())
            .map(|_| ())
            .map_err(|e| e.message().to_string())
    }
}

/// Non-Windows stub so the project still compiles elsewhere.
#[cfg(not(windows))]
mod imp {
    use super::MediaStore;
    use tauri::AppHandle;

    pub fn start(_app: AppHandle, _store: MediaStore) {}

    pub fn command(_action: &str) -> Result<(), String> {
        Err("media control is only available on Windows".into())
    }
}
