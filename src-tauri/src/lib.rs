mod activity;
mod glass;
mod hittest;
mod hud;
mod picker;
mod shelf;
mod location;
mod record;
mod system;
mod media;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, WebviewWindow,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// The tray's "Start with Windows" item, so the island's own settings can keep it in sync.
#[derive(Default)]
struct TrayAutostart(std::sync::Mutex<Option<CheckMenuItem<tauri::Wry>>>);

/// Gap between the top of the screen and the island window, in physical pixels.
const TOP_OFFSET: i32 = 0;

fn position_top_center(win: &WebviewWindow) -> tauri::Result<()> {
    let monitor = match win.primary_monitor()? {
        Some(m) => m,
        None => return Ok(()),
    };
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let w_size = win.outer_size()?;
    let x = m_pos.x + (m_size.width as i32 - w_size.width as i32) / 2;
    let y = m_pos.y + TOP_OFFSET;
    win.set_position(PhysicalPosition::new(x, y))
}

/// Launched by Windows at sign-in (the startup entry passes this flag).
const AUTOSTART_ARG: &str = "--autostart";

/* ------------------------------------------------------------ startup log */

/// %APPDATA%\com.kiki.island\startup.log — a few lines per launch, so a
/// failed start at sign-in leaves a trace. Kept small (trimmed at ~64 KB).
fn log_path() -> Option<std::path::PathBuf> {
    let dir = std::path::PathBuf::from(std::env::var_os("APPDATA")?).join("com.kiki.island");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("startup.log"))
}

pub fn log(msg: impl AsRef<str>) {
    use std::io::Write;
    let Some(path) = log_path() else { return };
    if std::fs::metadata(&path).map(|m| m.len() > 64 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{secs}] {}", msg.as_ref());
    }
}

/* -------------------------------------------------------------- autostart */

/// The tray toggle's choice, kept next to the log. Missing = never chosen = on.
fn autostart_pref_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("autostart-initialized"))
}

fn autostart_wanted(app: &AppHandle) -> bool {
    autostart_pref_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim() != "off")
        .unwrap_or(true)
}

fn save_autostart_pref(app: &AppHandle, on: bool) {
    if let Some(p) = autostart_pref_path(app) {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = std::fs::write(p, if on { "on" } else { "off" });
    }
}

/// Installed builds keep "Start with Windows" registered on every launch
/// (unless you turned it off in the tray). Re-registering each time keeps the
/// entry pointing at the current Island.exe after updates. Dev builds never
/// touch it, so `tauri dev` doesn't register the debug exe.
fn ensure_autostart(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let al = app.autolaunch();
    if !autostart_wanted(app) {
        log("autostart: off (turned off in tray)");
        return;
    }
    // Re-register to refresh the exe path and the --autostart flag.
    match al.enable() {
        Ok(()) => {
            save_autostart_pref(app, true);
            log(format!("autostart: registered, enabled={:?}", al.is_enabled()));
        }
        Err(e) => log(format!("autostart: enable failed: {e}")),
    }
}

/* ------------------------------------------------------------------- tray */

/// "Start with Windows", for the island's settings and welcome screen.
#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let al = app.autolaunch();
    (if on { al.enable() } else { al.disable() }).map_err(|e| e.to_string())?;
    let now_on = al.is_enabled().unwrap_or(on);
    save_autostart_pref(&app, now_on);
    if let Some(item) = app.state::<TrayAutostart>().0.lock().unwrap().as_ref() {
        let _ = item.set_checked(now_on);
    }
    log(format!("autostart: set from island -> {now_on}"));
    Ok(now_on)
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let start_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, start_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Island", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&autostart, &separator, &quit])?;
    let autostart_item = autostart.clone();
    *app.state::<TrayAutostart>().0.lock().unwrap() = Some(autostart.clone());
    let mut tray = TrayIconBuilder::with_id("island").tooltip("Island").menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| match event.id.as_ref() {
        "quit" => app.exit(0),
        "autostart" => {
            let al = app.autolaunch();
            let was_on = al.is_enabled().unwrap_or(false);
            let _ = if was_on { al.disable() } else { al.enable() };
            let now_on = al.is_enabled().unwrap_or(!was_on);
            save_autostart_pref(app, now_on);
            log(format!("autostart: toggled in tray -> {now_on}"));
            // Reflect the real state, in case Windows refused the change.
            let _ = autostart_item.set_checked(now_on);
        }
        _ => {}
    })
    .build(app)?;
    Ok(())
}

/// At sign-in the taskbar may not exist yet, so creating the tray icon can
/// fail. Retry for a while instead of letting the whole app quit.
fn build_tray_with_retry(app: AppHandle) {
    if build_tray(&app).is_ok() {
        log("tray: ready");
        return;
    }
    std::thread::spawn(move || {
        for attempt in 1..=30 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let handle = app.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            let _ = app.run_on_main_thread(move || {
                let _ = tx.send(build_tray(&handle).map_err(|e| e.to_string()));
            });
            match rx.recv() {
                Ok(Ok(())) => {
                    log(format!("tray: ready after {attempt} retries"));
                    return;
                }
                Ok(Err(e)) => log(format!("tray: attempt {attempt} failed: {e}")),
                Err(_) => {}
            }
        }
        log("tray: gave up; island still runs without a tray icon");
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let at_login = std::env::args().any(|a| a == AUTOSTART_ARG);
    log(format!(
        "launch {} exe={:?}",
        if at_login { "(at sign-in)" } else { "(manual)" },
        std::env::current_exe().ok()
    ));
    std::panic::set_hook(Box::new(|info| log(format!("PANIC: {info}"))));

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .manage(hittest::HitRect::default())
        .manage(media::MediaStore::default())
        .manage(glass::GlassState::default())
        .manage(TrayAutostart::default())
        .invoke_handler(tauri::generate_handler![
            hittest::set_hit_rect,
            media::media_get,
            media::media_command,
            location::get_location,
            system::radios_get,
            system::radio_set,
            system::wifi_networks,
            system::wifi_connect,
            system::bt_devices,
            system::volume_get,
            system::volume_set,
            system::volume_mute,
            system::brightness_get,
            system::brightness_set,
            system::open_settings,
            record::start_screen_record,
            record::open_recordings,
            record::set_capture_hidden,
            picker::picker_open,
            picker::picker_sample,
            picker::picker_done,
            shelf::clips_list,
            shelf::clip_save,
            shelf::clip_from_clipboard,
            shelf::clip_delete,
            shelf::copy_to_clipboard,
            shelf::open_path,
            shelf::captures_recent,
            activity::activity,
            glass::set_glass,
            glass::set_island_shape,
            autostart_get,
            autostart_set,
        ])
        .setup(move |app| {
            let win = app
                .get_webview_window("main")
                .expect("main window missing");

            // Auto-update: only switched on once a public key is in tauri.conf.json,
            // so builds without one still start normally.
            let has_key = app
                .config()
                .plugins
                .0
                .get("updater")
                .and_then(|u| u.get("pubkey"))
                .and_then(|k| k.as_str())
                .map(|k| !k.trim().is_empty())
                .unwrap_or(false);
            if has_key {
                if let Err(e) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                    log(format!("updater: {e}"));
                }
            } else {
                log("updater: no public key in tauri.conf.json yet, updates off");
            }

            // None of these are worth quitting over; log and carry on.
            if let Err(e) = position_top_center(&win) {
                log(format!("position: {e}"));
            }
            // Start fully click-through; the hit-test loop turns clicks on over the pill.
            let _ = win.set_ignore_cursor_events(true);
            if let Err(e) = win.show() {
                log(format!("show: {e}"));
            }

            let rect = app.state::<hittest::HitRect>().inner().clone();
            hittest::start(win.clone(), rect);

            let store = app.state::<media::MediaStore>().inner().clone();
            media::start(app.handle().clone(), store);

            shelf::watch_captures(app.handle().clone());
            hud::watch_volume(app.handle().clone());
            hud::watch_brightness(app.handle().clone());

            ensure_autostart(app.handle());
            build_tray_with_retry(app.handle().clone());

            // At sign-in the display layout can still be settling; re-center once it has.
            if at_login {
                let w = win.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    let _ = position_top_center(&w);
                    let _ = w.show();
                });
            }
            log(format!("setup: done, v{}", app.package_info().version));
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        log(format!("exited with error: {e}"));
    }
}
