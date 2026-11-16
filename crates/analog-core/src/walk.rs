//! Recorded walks (#11 A: "walk in Hokkaido, move on Mars"). A GPX track gives positions and
//! times; elevation comes from a DEM (NASADEM), never from the GPS. The summary turns the team's
//! own walk into the flat-ground speed the route model needs.

use crate::route::slope_factor;
use crate::world::{distance_km, LatLon, World};
use serde::{Deserialize, Serialize};

/// A recorded walk point (GPX trkpt) with elevation from a DEM.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct TimedPoint {
    pub lat: f64,
    pub lon: f64,
    #[serde(default)]
    pub elev: Option<f64>,
    /// Seconds since any epoch.
    pub t: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WalkSummary {
    pub km: f64,
    pub elapsed_h: f64,
    /// Time spent moving (stops of ≥ 30 s at under 0.5 km/h left out), hours.
    pub moving_h: f64,
    pub climb_m: f64,
    pub descent_m: f64,
    /// Flat-ground speed that, with the slope model of `route::evaluate_route`, gives the measured
    /// moving time over this terrain: Σ(distance / slope_factor) / moving time, km/h.
    pub flat_kmh: f64,
    /// Plain average while moving, km/h.
    pub moving_kmh: f64,
}

pub fn summary(world: World, pts: &[TimedPoint]) -> WalkSummary {
    let (mut km, mut moving_h, mut climb, mut descent, mut flat_km) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for w in pts.windows(2) {
        let (a, b) = (w[0], w[1]);
        let d = distance_km(
            world,
            LatLon {
                lat: a.lat,
                lon: a.lon,
            },
            LatLon {
                lat: b.lat,
                lon: b.lon,
            },
        );
        let dt_h = ((b.t - a.t) / 3600.0).max(0.0);
        km += d;
        if let (Some(ea), Some(eb)) = (a.elev, b.elev) {
            let dz = eb - ea;
            if dz > 0.0 {
                climb += dz
            } else {
                descent -= dz
            }
        }
        let stopped = dt_h * 3600.0 >= 30.0 && d / dt_h.max(1e-9) < 0.5;
        if dt_h <= 0.0 || stopped {
            continue;
        }
        moving_h += dt_h;
        let slope = match (a.elev, b.elev) {
            (Some(ea), Some(eb)) if d > 0.0 => (eb - ea) / (d * 1000.0),
            _ => 0.0,
        };
        flat_km += d / slope_factor(slope);
    }
    let elapsed_h = match (pts.first(), pts.last()) {
        (Some(a), Some(b)) => ((b.t - a.t) / 3600.0).max(0.0),
        _ => 0.0,
    };
    WalkSummary {
        km,
        elapsed_h,
        moving_h,
        climb_m: climb,
        descent_m: descent,
        flat_kmh: if moving_h > 0.0 {
            flat_km / moving_h
        } else {
            0.0
        },
        moving_kmh: if moving_h > 0.0 { km / moving_h } else { 0.0 },
    }
}

/// Lay a walk recorded on one body onto another: same east/north offsets in metres from its first
/// point, starting at `base`. Returns [lat, lon] per point.
pub fn transplant(from: World, pts: &[TimedPoint], to: World, base: LatLon) -> Vec<[f64; 2]> {
    let Some(p0) = pts.first() else {
        return Vec::new();
    };
    let k_from = from.info().radius_km * 1000.0 * std::f64::consts::PI / 180.0;
    let k_to = to.info().radius_km * 1000.0 * std::f64::consts::PI / 180.0;
    pts.iter()
        .map(|p| {
            let east = (p.lon - p0.lon) * k_from * p0.lat.to_radians().cos();
            let north = (p.lat - p0.lat) * k_from;
            [
                base.lat + north / k_to,
                base.lon + east / (k_to * base.lat.to_radians().cos()),
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    const K: f64 = 1.0 / (6371.0 * std::f64::consts::PI / 180.0); // degrees per km on Earth

    #[test]
    fn flat_speed_undoes_the_slope_model() {
        // 1 km on the flat at 4 km/h, then 1 km up a 10 % grade at the model's speed for 4 km/h.
        let up_h = 1.0 / (4.0 * slope_factor(0.1));
        let pts = [
            TimedPoint {
                lat: 0.0,
                lon: 0.0,
                elev: Some(0.0),
                t: 0.0,
            },
            TimedPoint {
                lat: 0.0,
                lon: K,
                elev: Some(0.0),
                t: 900.0,
            },
            TimedPoint {
                lat: 0.0,
                lon: 2.0 * K,
                elev: Some(100.0),
                t: 900.0 + up_h * 3600.0,
            },
        ];
        let s = summary(World::Earth, &pts);
        assert!((s.flat_kmh - 4.0).abs() < 0.05, "{}", s.flat_kmh);
        assert!((s.km - 2.0).abs() < 0.01 && (s.climb_m - 100.0).abs() < 1e-9);
        assert!(s.moving_kmh < 4.0);
    }

    #[test]
    fn stops_are_not_moving_time() {
        let pts = [
            TimedPoint {
                lat: 0.0,
                lon: 0.0,
                elev: None,
                t: 0.0,
            },
            TimedPoint {
                lat: 0.0,
                lon: K,
                elev: None,
                t: 900.0,
            },
            TimedPoint {
                lat: 0.0,
                lon: K,
                elev: None,
                t: 1800.0,
            }, // 15 min break
            TimedPoint {
                lat: 0.0,
                lon: 2.0 * K,
                elev: None,
                t: 2700.0,
            },
        ];
        let s = summary(World::Earth, &pts);
        assert!((s.moving_h - 0.5).abs() < 1e-9 && (s.elapsed_h - 0.75).abs() < 1e-9);
        assert!((s.flat_kmh - 4.0).abs() < 0.01);
    }

    #[test]
    fn transplant_keeps_metres() {
        let pts = [
            TimedPoint {
                lat: 43.0,
                lon: 141.0,
                elev: None,
                t: 0.0,
            },
            TimedPoint {
                lat: 43.0 + K,
                lon: 141.0,
                elev: None,
                t: 1.0,
            }, // 1 km north
        ];
        let base = LatLon {
            lat: 18.4,
            lon: 77.4,
        };
        let m = transplant(World::Earth, &pts, World::Mars, base);
        let d = distance_km(
            World::Mars,
            base,
            LatLon {
                lat: m[1][0],
                lon: m[1][1],
            },
        );
        assert!((d - 1.0).abs() < 0.01, "{d}");
        assert_eq!(m[0], [18.4, 77.4]);
    }
}
