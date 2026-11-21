//! Quick system controls: Wi-Fi, Bluetooth, volume and brightness.
//!
//! - Wi-Fi / Bluetooth on-off: Windows.Devices.Radios (same switches as the
//!   Action Center tiles).
//! - Wi-Fi networks: Windows.Devices.WiFi (scan, connect, saved profiles).
//!   Windows 11 24H2+ only lets apps scan when location access is on, which
//!   the island already uses for weather.
//! - Bluetooth devices: paired devices + whether they're connected. Windows
//!   gives apps no way to connect an audio device, so tapping one opens
//!   Bluetooth settings.
//! - Volume: Core Audio (IAudioEndpointVolume) on the default output device.
//! - Brightness: laptop panels via WMI, external monitors via DDC/CI.

use serde::Serialize;

#[derive(Debug, Serialize, Clone, Default)]
pub struct Radios {
    /// None = this PC has no such radio.
    pub wifi: Option<bool>,
    pub bluetooth: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct WifiNetwork {
    pub ssid: String,
    /// 0–4
    pub bars: u8,
    pub secured: bool,
    pub connected: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct BtDevice {
    pub name: String,
    pub connected: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct Volume {
    /// 0.0–1.0
    pub level: f32,
    pub muted: bool,
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn radios_get() -> Result<Radios, String> {
    blocking(imp::radios_get).await
}

/// kind: "wifi" | "bluetooth". Returns the new state.
#[tauri::command]
pub async fn radio_set(kind: String, on: bool) -> Result<bool, String> {
    blocking(move || imp::radio_set(&kind, on)).await
}

#[tauri::command]
pub async fn wifi_networks(scan: bool) -> Result<Vec<WifiNetwork>, String> {
    blocking(move || imp::wifi_networks(scan)).await
}

/// Returns "connected" | "needs_password" | "failed".
#[tauri::command]
pub async fn wifi_connect(ssid: String, password: Option<String>) -> Result<String, String> {
    blocking(move || imp::wifi_connect(ssid, password)).await
}

#[tauri::command]
pub async fn bt_devices() -> Result<Vec<BtDevice>, String> {
    blocking(imp::bt_devices).await
}

#[tauri::command]
pub async fn volume_get() -> Result<Volume, String> {
    blocking(imp::volume_get).await
}

#[tauri::command]
pub async fn volume_set(level: f32) -> Result<(), String> {
    blocking(move || imp::volume_set(level)).await
}

#[tauri::command]
pub async fn volume_mute(muted: bool) -> Result<(), String> {
    blocking(move || imp::volume_mute(muted)).await
}

/// 0–100, or None if no display supports software brightness.
#[tauri::command]
pub async fn brightness_get() -> Result<Option<u32>, String> {
    blocking(|| Ok(imp::brightness_get())).await
}

#[tauri::command]
pub async fn brightness_set(value: u32) -> Result<(), String> {
    blocking(move || imp::brightness_set(value.min(100))).await
}

/// page: "wifi" | "bluetooth" | "sound" | "display"
#[tauri::command]
pub fn open_settings(page: String) -> Result<(), String> {
    imp::open_settings(&page)
}

#[cfg(windows)]
mod imp {
    use super::{BtDevice, Radios, Volume, WifiNetwork};
    use std::{os::windows::process::CommandExt, process::Command, sync::OnceLock};
    use windows::{
        core::HSTRING,
        Devices::{
            Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice},
            Enumeration::DeviceInformation,
            Radios::{Radio, RadioAccessStatus, RadioKind, RadioState},
            WiFi::{WiFiAdapter, WiFiAvailableNetwork, WiFiConnectionStatus, WiFiReconnectionKind},
        },
        Networking::Connectivity::NetworkAuthenticationType,
        Security::Credentials::PasswordCredential,
        Win32::{
            Devices::Display::{
                DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
                GetPhysicalMonitorsFromHMONITOR, SetMonitorBrightness, PHYSICAL_MONITOR,
            },
            Foundation::{BOOL, LPARAM, RECT},
            Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
            Media::Audio::{eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator},
            System::{
                Com::{CoCreateInstance, CLSCTX_ALL},
                WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
            },
        },
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn init() {
        // Also initializes COM (MTA) for Core Audio. Safe to repeat.
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
    }

    fn e(err: windows::core::Error) -> String {
        err.message().to_string()
    }

    /* ------------------------------------------------------------- radios */

    fn radio(kind: RadioKind) -> Option<Radio> {
        let list = Radio::GetRadiosAsync().ok()?.get().ok()?;
        (0..list.Size().ok()?)
            .filter_map(|i| list.GetAt(i).ok())
            .find(|r| r.Kind().ok() == Some(kind))
    }

    fn is_on(kind: RadioKind) -> Option<bool> {
        radio(kind).and_then(|r| r.State().ok()).map(|s| s == RadioState::On)
    }

    pub fn radios_get() -> Result<Radios, String> {
        init();
        let _ = Radio::RequestAccessAsync().and_then(|o| o.get());
        Ok(Radios {
            wifi: is_on(RadioKind::WiFi),
            bluetooth: is_on(RadioKind::Bluetooth),
        })
    }

    pub fn radio_set(kind: &str, on: bool) -> Result<bool, String> {
        init();
        Radio::RequestAccessAsync().and_then(|o| o.get()).map_err(e)?;
        let kind = match kind {
            "wifi" => RadioKind::WiFi,
            "bluetooth" => RadioKind::Bluetooth,
            other => return Err(format!("unknown radio: {other}")),
        };
        let r = radio(kind).ok_or_else(|| "this PC has no such radio".to_string())?;
        let target = if on { RadioState::On } else { RadioState::Off };
        let status = r.SetStateAsync(target).and_then(|o| o.get()).map_err(e)?;
        if status != RadioAccessStatus::Allowed {
            return Err("Windows didn't allow changing this radio".into());
        }
        Ok(r.State().map(|s| s == RadioState::On).unwrap_or(on))
    }

    /* --------------------------------------------------------------- wifi */

    fn adapter() -> Result<WiFiAdapter, String> {
        let _ = WiFiAdapter::RequestAccessAsync().and_then(|o| o.get());
        let list = WiFiAdapter::FindAllAdaptersAsync().and_then(|o| o.get()).map_err(e)?;
        if list.Size().map_err(e)? == 0 {
            return Err("no Wi-Fi adapter".into());
        }
        list.GetAt(0).map_err(e)
    }

    fn connected_ssid(a: &WiFiAdapter) -> Option<String> {
        let profile = a.NetworkAdapter().ok()?.GetConnectedProfileAsync().ok()?.get().ok()?;
        let ssid = profile.WlanConnectionProfileDetails().ok()?.GetConnectedSsid().ok()?.to_string();
        (!ssid.is_empty()).then_some(ssid)
    }

    fn is_secured(n: &WiFiAvailableNetwork) -> bool {
        n.SecuritySettings()
            .and_then(|s| s.NetworkAuthenticationType())
            .map(|t| t != NetworkAuthenticationType::Open80211 && t != NetworkAuthenticationType::None)
            .unwrap_or(true)
    }

    fn available(a: &WiFiAdapter) -> Result<Vec<WiFiAvailableNetwork>, String> {
        let nets = a.NetworkReport().and_then(|r| r.AvailableNetworks()).map_err(e)?;
        Ok((0..nets.Size().map_err(e)?).filter_map(|i| nets.GetAt(i).ok()).collect())
    }

    pub fn wifi_networks(scan: bool) -> Result<Vec<WifiNetwork>, String> {
        init();
        let a = adapter()?;
        if scan {
            let _ = a.ScanAsync().and_then(|o| o.get());
        }
        let current = connected_ssid(&a);
        let mut out: Vec<WifiNetwork> = Vec::new();
        for n in available(&a)? {
            let ssid = n.Ssid().map(|s| s.to_string()).unwrap_or_default();
            if ssid.is_empty() {
                continue; // hidden network
            }
            let bars = n.SignalBars().unwrap_or(0);
            // The same SSID shows up once per access point / band; keep the strongest.
            if let Some(existing) = out.iter_mut().find(|x| x.ssid == ssid) {
                existing.bars = existing.bars.max(bars);
                continue;
            }
            let connected = current.as_deref() == Some(ssid.as_str());
            out.push(WifiNetwork { secured: is_secured(&n), ssid, bars, connected });
        }
        // If the connected network didn't show up in the scan, still list it.
        if let Some(cur) = current {
            if !out.iter().any(|x| x.connected) {
                out.push(WifiNetwork { ssid: cur, bars: 4, secured: true, connected: true });
            }
        }
        out.sort_by(|a, b| b.connected.cmp(&a.connected).then(b.bars.cmp(&a.bars)));
        Ok(out)
    }

    pub fn wifi_connect(ssid: String, password: Option<String>) -> Result<String, String> {
        init();
        let a = adapter()?;
        let net = available(&a)?
            .into_iter()
            .find(|n| n.Ssid().map(|s| s.to_string() == ssid).unwrap_or(false))
            .ok_or_else(|| "network not found".to_string())?;
        let secured = is_secured(&net);

        let op = match password.filter(|p| !p.is_empty()) {
            Some(p) => {
                let cred = PasswordCredential::new().map_err(e)?;
                cred.SetPassword(&HSTRING::from(p)).map_err(e)?;
                a.ConnectWithPasswordCredentialAsync(&net, WiFiReconnectionKind::Automatic, &cred)
            }
            // Uses the saved profile if Windows knows this network.
            None => a.ConnectAsync(&net, WiFiReconnectionKind::Automatic),
        };
        let status = op
            .and_then(|o| o.get())
            .and_then(|r| r.ConnectionStatus())
            .map_err(e)?;

        Ok(if status == WiFiConnectionStatus::Success {
            "connected"
        } else if status == WiFiConnectionStatus::InvalidCredential || secured {
            "needs_password"
        } else {
            "failed"
        }
        .into())
    }

    /* ---------------------------------------------------------- bluetooth */

    pub fn bt_devices() -> Result<Vec<BtDevice>, String> {
        init();
        let mut out: Vec<BtDevice> = Vec::new();
        let selectors = [
            (BluetoothDevice::GetDeviceSelectorFromPairingState(true).map_err(e)?, false),
            (BluetoothLEDevice::GetDeviceSelectorFromPairingState(true).map_err(e)?, true),
        ];
        for (selector, is_le) in selectors {
            let Ok(list) = DeviceInformation::FindAllAsyncAqsFilter(&selector).and_then(|o| o.get()) else {
                continue;
            };
            for i in 0..list.Size().unwrap_or(0) {
                let Ok(info) = list.GetAt(i) else { continue };
                let name = info.Name().map(|s| s.to_string()).unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let id = info.Id().unwrap_or_default();
                let connected = if is_le {
                    BluetoothLEDevice::FromIdAsync(&id)
                        .and_then(|o| o.get())
                        .and_then(|d| d.ConnectionStatus())
                        .map(|s| s == BluetoothConnectionStatus::Connected)
                        .unwrap_or(false)
                } else {
                    BluetoothDevice::FromIdAsync(&id)
                        .and_then(|o| o.get())
                        .and_then(|d| d.ConnectionStatus())
                        .map(|s| s == BluetoothConnectionStatus::Connected)
                        .unwrap_or(false)
                };
                // Many devices appear as both Classic and LE; merge by name.
                match out.iter_mut().find(|x| x.name == name) {
                    Some(x) => x.connected |= connected,
                    None => out.push(BtDevice { name, connected }),
                }
            }
        }
        out.sort_by(|a, b| b.connected.cmp(&a.connected).then(a.name.cmp(&b.name)));
        Ok(out)
    }

    /* ------------------------------------------------------------- volume */

    fn endpoint() -> Result<IAudioEndpointVolume, String> {
        init();
        unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(e)?;
            let device = devices.GetDefaultAudioEndpoint(eRender, eConsole).map_err(e)?;
            device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(e)
        }
    }

    pub fn volume_get() -> Result<Volume, String> {
        let ep = endpoint()?;
        unsafe {
            Ok(Volume {
                level: ep.GetMasterVolumeLevelScalar().map_err(e)?,
                muted: ep.GetMute().map_err(e)?.as_bool(),
            })
        }
    }

    pub fn volume_set(level: f32) -> Result<(), String> {
        let ep = endpoint()?;
        unsafe {
            ep.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null()).map_err(e)?;
            // Turning the volume up unmutes, like the Windows flyout does.
            if level > 0.0 && ep.GetMute().map(|m| m.as_bool()).unwrap_or(false) {
                let _ = ep.SetMute(false, std::ptr::null());
            }
        }
        Ok(())
    }

    pub fn volume_mute(muted: bool) -> Result<(), String> {
        let ep = endpoint()?;
        unsafe { ep.SetMute(muted, std::ptr::null()).map_err(e) }
    }

    /* --------------------------------------------------------- brightness */

    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        Wmi,
        Ddc,
        Unsupported,
    }
    static MODE: OnceLock<Mode> = OnceLock::new();

    fn powershell(script: &str) -> Option<String> {
        let out = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn wmi_get() -> Option<u32> {
        powershell(
            "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness",
        )?
        .parse()
        .ok()
    }

    fn wmi_set(v: u32) -> bool {
        powershell(&format!(
            "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=[uint32]1; Brightness=[byte]{v}}} | Out-Null"
        ))
        .is_some()
    }

    unsafe extern "system" fn collect(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<HMONITOR>);
        list.push(h);
        BOOL(1)
    }

    /// Runs `f` on every physical monitor that answers DDC/CI, then releases them.
    fn with_ddc_monitors<T>(mut f: impl FnMut(&PHYSICAL_MONITOR) -> Option<T>) -> Vec<T> {
        let mut handles: Vec<HMONITOR> = Vec::new();
        let mut results = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(HDC::default(), None, Some(collect), LPARAM(&mut handles as *mut _ as isize));
            for h in handles {
                let mut n = 0u32;
                if GetNumberOfPhysicalMonitorsFromHMONITOR(h, &mut n).is_err() || n == 0 {
                    continue;
                }
                let mut monitors = vec![PHYSICAL_MONITOR::default(); n as usize];
                if GetPhysicalMonitorsFromHMONITOR(h, &mut monitors).is_err() {
                    continue;
                }
                results.extend(monitors.iter().filter_map(&mut f));
                let _ = DestroyPhysicalMonitors(&monitors);
            }
        }
        results
    }

    fn ddc_get() -> Option<u32> {
        with_ddc_monitors(|m| unsafe {
            let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
            (GetMonitorBrightness(m.hPhysicalMonitor, &mut min, &mut cur, &mut max) != 0 && max > min)
                .then(|| (cur.saturating_sub(min)) * 100 / (max - min))
        })
        .into_iter()
        .next()
    }

    fn ddc_set(v: u32) -> bool {
        !with_ddc_monitors(|m| unsafe {
            let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
            if GetMonitorBrightness(m.hPhysicalMonitor, &mut min, &mut cur, &mut max) == 0 || max <= min {
                return None;
            }
            (SetMonitorBrightness(m.hPhysicalMonitor, min + v * (max - min) / 100) != 0).then_some(())
        })
        .is_empty()
    }

    fn mode() -> Mode {
        *MODE.get_or_init(|| {
            if wmi_get().is_some() {
                Mode::Wmi
            } else if ddc_get().is_some() {
                Mode::Ddc
            } else {
                Mode::Unsupported
            }
        })
    }

    pub fn brightness_get() -> Option<u32> {
        match mode() {
            Mode::Wmi => wmi_get(),
            Mode::Ddc => ddc_get(),
            Mode::Unsupported => None,
        }
    }

    pub fn brightness_set(v: u32) -> Result<(), String> {
        let ok = match mode() {
            Mode::Wmi => wmi_set(v),
            Mode::Ddc => ddc_set(v),
            Mode::Unsupported => false,
        };
        ok.then_some(()).ok_or_else(|| "brightness isn't adjustable on this display".into())
    }

    /* ----------------------------------------------------------- settings */

    pub fn open_settings(page: &str) -> Result<(), String> {
        let uri = match page {
            "wifi" => "ms-settings:network-wifi",
            "bluetooth" => "ms-settings:bluetooth",
            "sound" => "ms-settings:sound",
            "display" => "ms-settings:display",
            _ => return Err("unknown settings page".into()),
        };
        Command::new("explorer")
            .arg(uri)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{BtDevice, Radios, Volume, WifiNetwork};
    const NO: &str = "only available on Windows";
    pub fn radios_get() -> Result<Radios, String> { Ok(Radios::default()) }
    pub fn radio_set(_: &str, _: bool) -> Result<bool, String> { Err(NO.into()) }
    pub fn wifi_networks(_: bool) -> Result<Vec<WifiNetwork>, String> { Err(NO.into()) }
    pub fn wifi_connect(_: String, _: Option<String>) -> Result<String, String> { Err(NO.into()) }
    pub fn bt_devices() -> Result<Vec<BtDevice>, String> { Err(NO.into()) }
    pub fn volume_get() -> Result<Volume, String> { Err(NO.into()) }
    pub fn volume_set(_: f32) -> Result<(), String> { Err(NO.into()) }
    pub fn volume_mute(_: bool) -> Result<(), String> { Err(NO.into()) }
    pub fn brightness_get() -> Option<u32> { None }
    pub fn brightness_set(_: u32) -> Result<(), String> { Err(NO.into()) }
    pub fn open_settings(_: &str) -> Result<(), String> { Err(NO.into()) }
}

/// Current volume, for the background watcher in hud.rs.
pub fn volume_now() -> Result<Volume, String> {
    imp::volume_get()
}
