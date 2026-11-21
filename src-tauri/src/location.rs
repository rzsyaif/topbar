//! Device location via the Windows location service (Windows.Devices.Geolocation).
//! Needs Settings → Privacy & security → Location → "Location services" and
//! "Let desktop apps access your location" turned on.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct DeviceLocation {
    pub latitude: f64,
    pub longitude: f64,
}

#[tauri::command]
pub async fn get_location() -> Result<DeviceLocation, String> {
    tauri::async_runtime::spawn_blocking(imp::get)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod imp {
    use super::DeviceLocation;
    use windows::{
        Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy},
        Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
    };

    pub fn get() -> Result<DeviceLocation, String> {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let err = |e: windows::core::Error| e.message().to_string();

        let access = Geolocator::RequestAccessAsync()
            .and_then(|op| op.get())
            .map_err(err)?;
        if access != GeolocationAccessStatus::Allowed {
            return Err("location access is off for desktop apps".into());
        }

        let locator = Geolocator::new().map_err(err)?;
        // City-level accuracy is plenty for weather and prayer times, and faster.
        let _ = locator.SetDesiredAccuracy(PositionAccuracy::Default);
        let pos = locator
            .GetGeopositionAsync()
            .and_then(|op| op.get())
            .and_then(|p| p.Coordinate())
            .and_then(|c| c.Point())
            .and_then(|p| p.Position())
            .map_err(err)?;

        Ok(DeviceLocation {
            latitude: pos.Latitude,
            longitude: pos.Longitude,
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::DeviceLocation;
    pub fn get() -> Result<DeviceLocation, String> {
        Err("device location is only available on Windows".into())
    }
}
