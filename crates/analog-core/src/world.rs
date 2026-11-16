//! Planetary bodies and geodesy.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum World {
    Earth,
    Moon,
    Mars,
}

/// Physical constants used by the app for one body.
#[derive(Debug, Clone, Serialize)]
pub struct WorldInfo {
    pub id: World,
    pub label: &'static str,
    pub icon: &'static str,
    /// Mean radius in km.
    pub radius_km: f64,
    /// Surface gravity in m/s².
    pub gravity: f64,
    /// Axial tilt in degrees (used for noon sun elevation).
    pub axial_tilt_deg: f64,
    /// Default map view [lat, lon, zoom].
    pub view: [f64; 3],
}

impl World {
    pub const ALL: [World; 3] = [World::Earth, World::Moon, World::Mars];

    pub fn info(self) -> WorldInfo {
        match self {
            World::Earth => WorldInfo {
                id: self,
                label: "地球 Earth",
                icon: "🌏",
                radius_km: 6371.0,
                gravity: 9.81,
                axial_tilt_deg: 23.44,
                view: [43.2, 142.3, 7.0],
            },
            World::Moon => WorldInfo {
                id: self,
                label: "月 Moon",
                icon: "🌙",
                radius_km: 1737.4,
                gravity: 1.62,
                axial_tilt_deg: 1.54,
                view: [0.0, 0.0, 2.0],
            },
            World::Mars => WorldInfo {
                id: self,
                label: "火星 Mars",
                icon: "🔴",
                radius_km: 3389.5,
                gravity: 3.72,
                axial_tilt_deg: 25.19,
                view: [18.38, 77.58, 6.0],
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LatLon {
    pub lat: f64,
    #[serde(alias = "lng")]
    pub lon: f64,
}

/// Great-circle (haversine) distance in km on the given body.
pub fn distance_km(world: World, a: LatLon, b: LatLon) -> f64 {
    let r = std::f64::consts::PI / 180.0;
    let (lat1, lat2) = (a.lat * r, b.lat * r);
    let d_lat = lat2 - lat1;
    let d_lon = (b.lon - a.lon) * r;
    let h = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * world.info().radius_km * h.sqrt().min(1.0).asin()
}

/// Range of the noon sun elevation over a year, in degrees: (min, max).
pub fn noon_elevation_range(lat: f64, tilt: f64) -> (f64, f64) {
    let a = lat.abs();
    let max = if a <= tilt { 90.0 } else { 90.0 - (a - tilt) };
    let min = (90.0 - (a + tilt)).max(0.0);
    (min, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarter_meridian_matches_radius() {
        let d = distance_km(
            World::Mars,
            LatLon { lat: 0.0, lon: 0.0 },
            LatLon {
                lat: 90.0,
                lon: 0.0,
            },
        );
        assert!((d - std::f64::consts::FRAC_PI_2 * 3389.5).abs() < 1e-6);
    }

    #[test]
    fn same_angle_scales_with_radius() {
        let (a, b) = (
            LatLon {
                lat: 10.0,
                lon: 10.0,
            },
            LatLon {
                lat: 11.0,
                lon: 12.0,
            },
        );
        let ratio = distance_km(World::Earth, a, b) / distance_km(World::Moon, a, b);
        assert!((ratio - 6371.0 / 1737.4).abs() < 1e-9);
    }

    #[test]
    fn noon_elevation_hokkaido() {
        let (lo, hi) = noon_elevation_range(43.0, 23.44);
        assert!((lo - 23.56).abs() < 1e-9 && (hi - 70.44).abs() < 1e-9);
    }
}
