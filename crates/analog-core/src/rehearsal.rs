//! "Rehearse it in Hokkaido": find a place on an Earth elevation grid where the same walk — same
//! shape, same length, same climbs and descents — can be practised.
//!
//! The Mars route is turned into a profile of samples (distance along the route, local x/y in
//! metres, elevation). Every placement of that shape on the Earth grid (start cell × rotation ×
//! mirror) is sampled and scored by the length-weighted RMS difference of segment slopes.

use crate::grid::Grid;
use crate::route::Waypoint;
use crate::world::World;
use serde::{Deserialize, Serialize};

/// One densified sample of the route to copy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ProfilePt {
    /// Metres east / north of the start.
    pub x: f64,
    pub y: f64,
    pub elev: f64,
}

/// Turn densified Mars waypoints (all with elevation) into a local profile.
pub fn profile(world: World, pts: &[Waypoint]) -> Vec<ProfilePt> {
    let Some(first) = pts.first() else {
        return vec![];
    };
    let k = world.info().radius_km * 1000.0 * std::f64::consts::PI / 180.0;
    let cos0 = first.lat.to_radians().cos();
    pts.iter()
        .filter_map(|p| {
            Some(ProfilePt {
                x: (p.lon - first.lon) * k * cos0,
                y: (p.lat - first.lat) * k,
                elev: p.elev?,
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Match {
    /// The course on Earth: lat, lon, elevation.
    pub pts: Vec<[f64; 3]>,
    /// Length-weighted RMS slope difference, degrees.
    pub rms_deg: f64,
    /// 0–100, 100 = identical slopes.
    pub score: f64,
    pub rotation_deg: f64,
    pub mirrored: bool,
    /// Total climb on the Mars route and on the Earth course, metres.
    pub climb_mars_m: f64,
    pub climb_earth_m: f64,
}

fn slopes(e: &[f64], len: &[f64]) -> Vec<f64> {
    e.windows(2)
        .zip(len)
        .map(|(w, l)| ((w[1] - w[0]) / l.max(1e-6)).atan().to_degrees())
        .collect()
}

fn climb(e: &[f64]) -> f64 {
    e.windows(2).map(|w| (w[1] - w[0]).max(0.0)).sum()
}

/// Best `top` placements of the profile on an Earth grid. `stride` = start-cell step,
/// `rot_step_deg` = rotation step. Placements whose starts are closer than `min_sep_m` to a better
/// one are dropped so the results are different places.
pub fn search(
    g: &Grid,
    prof: &[ProfilePt],
    stride: usize,
    rot_step_deg: f64,
    top: usize,
    min_sep_m: f64,
) -> Vec<Match> {
    if prof.len() < 2 || g.rows < 2 || g.cols < 2 {
        return vec![];
    }
    let earth = World::Earth;
    let k = earth.info().radius_km * 1000.0 * std::f64::consts::PI / 180.0;
    let lens: Vec<f64> = prof
        .windows(2)
        .map(|w| ((w[1].x - w[0].x).powi(2) + (w[1].y - w[0].y).powi(2)).sqrt())
        .collect();
    let total: f64 = lens.iter().sum();
    let mars_e: Vec<f64> = prof.iter().map(|p| p.elev).collect();
    let mars_s = slopes(&mars_e, &lens);
    // (rms, start lat, start lon) and (rotation, mirrored) per placement.
    let mut cands: Vec<(f64, f64, f64)> = Vec::new();
    let mut meta: Vec<(f64, bool)> = Vec::new();
    let steps = (360.0 / rot_step_deg).round().max(1.0) as usize;
    let stride = stride.max(1);
    let mut buf = vec![0.0; prof.len()];
    for r in (0..g.rows).step_by(stride) {
        let lat_s = g.lat(r as f64);
        let cos_s = lat_s.to_radians().cos();
        for c in (0..g.cols).step_by(stride) {
            let lon_s = g.lon(c as f64);
            if g.at(r, c).is_none() {
                continue;
            }
            for mirror in [false, true] {
                for s in 0..steps {
                    let th = (s as f64 * rot_step_deg).to_radians();
                    let (sn, cs) = th.sin_cos();
                    let mut ok = true;
                    for (i, p) in prof.iter().enumerate() {
                        let x = if mirror { -p.x } else { p.x };
                        let (ex, ny) = (x * cs - p.y * sn, x * sn + p.y * cs);
                        match g.sample(lat_s + ny / k, lon_s + ex / (k * cos_s)) {
                            Some(z) => buf[i] = z,
                            None => {
                                ok = false;
                                break;
                            }
                        }
                    }
                    if !ok {
                        continue;
                    }
                    let es = slopes(&buf, &lens);
                    let ss: f64 = es
                        .iter()
                        .zip(&mars_s)
                        .zip(&lens)
                        .map(|((a, b), l)| (a - b).powi(2) * l)
                        .sum();
                    let rms = (ss / total).sqrt();
                    cands.push((rms, lat_s, lon_s));
                    meta.push((s as f64 * rot_step_deg, mirror));
                }
            }
        }
    }
    let mut order: Vec<usize> = (0..cands.len()).collect();
    order.sort_by(|&a, &b| cands[a].0.partial_cmp(&cands[b].0).unwrap());
    let mut picked: Vec<usize> = Vec::new();
    for i in order {
        if picked.len() >= top {
            break;
        }
        let (_, la, lo) = cands[i];
        let far = picked.iter().all(|&j| {
            let (_, lb, lob) = cands[j];
            let dy = (la - lb) * k;
            let dx = (lo - lob) * k * la.to_radians().cos();
            (dx * dx + dy * dy).sqrt() >= min_sep_m
        });
        if far {
            picked.push(i);
        }
    }
    picked
        .into_iter()
        .map(|i| {
            let (rms, lat_s, lon_s) = cands[i];
            let (rot, mirror) = meta[i];
            let (sn, cs) = rot.to_radians().sin_cos();
            let cos_s = lat_s.to_radians().cos();
            let pts: Vec<[f64; 3]> = prof
                .iter()
                .map(|p| {
                    let x = if mirror { -p.x } else { p.x };
                    let (ex, ny) = (x * cs - p.y * sn, x * sn + p.y * cs);
                    let (la, lo) = (lat_s + ny / k, lon_s + ex / (k * cos_s));
                    [la, lo, g.sample(la, lo).unwrap_or(f64::NAN)]
                })
                .collect();
            let ee: Vec<f64> = pts.iter().map(|p| p[2]).collect();
            Match {
                rms_deg: rms,
                score: 100.0 * (-rms / 6.0).exp(),
                rotation_deg: rot,
                mirrored: mirror,
                climb_mars_m: climb(&mars_e),
                climb_earth_m: climb(&ee),
                pts,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Earth grid with a single east-facing ramp in the middle of flat ground.
    fn ramp() -> Grid {
        let (rows, cols) = (60, 60);
        let mut z = vec![Some(0.0); rows * cols];
        for r in 0..rows {
            for c in 20..40 {
                z[r * cols + c] = Some((c - 20) as f64 * 15.0);
            }
            for c in 40..cols {
                z[r * cols + c] = Some(300.0);
            }
        }
        Grid {
            lat0: 43.6,
            lon0: 142.8,
            dlat: 0.0005,
            dlon: 0.0005 / 43.6_f64.to_radians().cos(),
            rows,
            cols,
            z,
            foot: Vec::new(),
            blocked: Vec::new(),
        }
    }

    #[test]
    fn finds_the_ramp_for_a_climbing_profile() {
        // ~55 m cells; climb 15 m per cell for 10 cells going north.
        let prof: Vec<ProfilePt> = (0..11)
            .map(|i| ProfilePt {
                x: 0.0,
                y: i as f64 * 55.6,
                elev: i as f64 * 15.0,
            })
            .collect();
        let m = search(&ramp(), &prof, 2, 15.0, 3, 200.0);
        assert!(!m.is_empty());
        let best = &m[0];
        assert!(best.rms_deg < 2.0, "rms {}", best.rms_deg);
        assert!((best.climb_earth_m - 150.0).abs() < 30.0);
        // A flat-ground profile should prefer the flat parts.
        let flat: Vec<ProfilePt> = prof.iter().map(|p| ProfilePt { elev: 0.0, ..*p }).collect();
        let f = search(&ramp(), &flat, 2, 15.0, 1, 200.0);
        assert!(f[0].climb_earth_m < 5.0);
    }

    #[test]
    fn profile_keeps_distances() {
        let w = World::Mars;
        let pts = [
            Waypoint {
                lat: 18.44,
                lon: 77.45,
                elev: Some(0.0),
            },
            Waypoint {
                lat: 18.44 + (1.0 / 3389.5_f64).to_degrees(),
                lon: 77.45,
                elev: Some(10.0),
            },
        ];
        let p = profile(w, &pts);
        assert!((p[1].y - 1000.0).abs() < 1e-6 && p[1].x.abs() < 1e-9);
    }
}
