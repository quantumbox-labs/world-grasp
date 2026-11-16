//! Perseverance's real drive path (Mars 2020 MMGIS `M20_traverse.json`, simplified into
//! `web/public/data/m20_traverse.json`) used as evidence: which parts of a planned walk follow
//! ground a rover has actually crossed, and how steep the rover's own path got.

use crate::route::Waypoint;
use crate::world::World;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Drive {
    pub sol: u32,
    /// [lon, lat, elevation m]
    pub c: Vec<[f64; 3]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Traverse {
    pub drives: Vec<Drive>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoverStats {
    pub km: f64,
    pub first_sol: u32,
    pub last_sol: u32,
    /// Slope of the rover's path over ~`window_m` stretches, degrees.
    pub slope_p50: f64,
    pub slope_p90: f64,
    pub slope_max: f64,
    pub window_m: f64,
}

/// Local planar metres around a reference latitude (fine at a few tens of km).
fn xy(world: World, lat0: f64, lon: f64, lat: f64) -> (f64, f64) {
    let k = world.info().radius_km * 1000.0 * std::f64::consts::PI / 180.0;
    (lon * k * lat0.to_radians().cos(), lat * k)
}

fn pct(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let i = ((sorted.len() - 1) as f64 * q).round() as usize;
    sorted[i]
}

pub fn stats(t: &Traverse, window_m: f64) -> RoverStats {
    let w = World::Mars;
    let lat0 = t
        .drives
        .first()
        .and_then(|d| d.c.first())
        .map(|c| c[1])
        .unwrap_or(0.0);
    let mut km = 0.0;
    let mut slopes = Vec::new();
    for d in &t.drives {
        let mut acc = 0.0;
        let mut anchor = match d.c.first() {
            Some(a) => *a,
            None => continue,
        };
        for pair in d.c.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let (ax, ay) = xy(w, lat0, a[0], a[1]);
            let (bx, by) = xy(w, lat0, b[0], b[1]);
            let seg = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
            km += seg / 1000.0;
            acc += seg;
            if acc >= window_m {
                slopes.push(((b[2] - anchor[2]).abs() / acc).atan().to_degrees());
                anchor = b;
                acc = 0.0;
            }
        }
    }
    slopes.sort_by(|a, b| a.partial_cmp(b).unwrap());
    RoverStats {
        km,
        first_sol: t.drives.iter().map(|d| d.sol).min().unwrap_or(0),
        last_sol: t.drives.iter().map(|d| d.sol).max().unwrap_or(0),
        slope_p50: pct(&slopes, 0.5),
        slope_p90: pct(&slopes, 0.9),
        slope_max: slopes.last().copied().unwrap_or(0.0),
        window_m,
    }
}

/// Distance from p to segment ab (planar).
fn seg_dist(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    ((p.0 - a.0 - t * dx).powi(2) + (p.1 - a.1 - t * dy).powi(2)).sqrt()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteCheck {
    /// Per input point: metres to the nearest rover path.
    pub dist_m: Vec<f64>,
    /// Share of the route length (0–1) within `near_m` of the rover path.
    pub near_share: f64,
    pub near_m: f64,
    /// Steepest leg of the planned route, degrees (legs with known elevation).
    pub route_max_slope: f64,
    /// Share of route legs whose slope is at or below the rover's 90th percentile.
    pub within_rover_share: f64,
    pub rover: RoverStats,
}

/// Compare a planned route (densified points with elevation) with the rover's path.
pub fn check(t: &Traverse, pts: &[Waypoint], near_m: f64) -> RouteCheck {
    let w = World::Mars;
    let rover = stats(t, 25.0);
    let lat0 = pts.first().map(|p| p.lat).unwrap_or(0.0);
    let segs: Vec<((f64, f64), (f64, f64))> = t
        .drives
        .iter()
        .flat_map(|d| d.c.windows(2).map(|p| (p[0], p[1])).collect::<Vec<_>>())
        .map(|(a, b)| (xy(w, lat0, a[0], a[1]), xy(w, lat0, b[0], b[1])))
        .collect();
    let dist_m: Vec<f64> = pts
        .iter()
        .map(|p| {
            let q = xy(w, lat0, p.lon, p.lat);
            segs.iter()
                .map(|(a, b)| seg_dist(q, *a, *b))
                .fold(f64::INFINITY, f64::min)
        })
        .collect();
    let (mut total, mut near, mut legs, mut ok, mut max_slope) = (0.0, 0.0, 0, 0, 0.0_f64);
    for i in 1..pts.len() {
        let a = xy(w, lat0, pts[i - 1].lon, pts[i - 1].lat);
        let b = xy(w, lat0, pts[i].lon, pts[i].lat);
        let len = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        total += len;
        if dist_m[i - 1] <= near_m && dist_m[i] <= near_m {
            near += len;
        }
        if let (Some(za), Some(zb)) = (pts[i - 1].elev, pts[i].elev) {
            if len > 0.0 {
                let s = ((zb - za).abs() / len).atan().to_degrees();
                max_slope = max_slope.max(s);
                legs += 1;
                if s <= rover.slope_p90 {
                    ok += 1;
                }
            }
        }
    }
    RouteCheck {
        dist_m,
        near_share: if total > 0.0 { near / total } else { 0.0 },
        near_m,
        route_max_slope: max_slope,
        within_rover_share: if legs > 0 {
            ok as f64 / legs as f64
        } else {
            0.0
        },
        rover,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line() -> Traverse {
        // ~1 km due north at 18.44°N climbing 10 m every ~111 m.
        let c = (0..10)
            .map(|i| {
                [
                    77.45,
                    18.44 + i as f64 * 0.001875,
                    -2570.0 + i as f64 * 10.0,
                ]
            })
            .collect();
        Traverse {
            drives: vec![Drive { sol: 14, c }],
        }
    }

    #[test]
    fn stats_of_a_steady_climb() {
        let s = stats(&line(), 25.0);
        assert!((s.km - 1.0).abs() < 0.02, "km {}", s.km);
        // 10 m over ~111 m → ~5.1°
        assert!((s.slope_p50 - 5.1).abs() < 0.3, "slope {}", s.slope_p50);
        assert_eq!((s.first_sol, s.last_sol), (14, 14));
    }

    #[test]
    fn route_on_the_path_is_near() {
        let t = line();
        let on: Vec<Waypoint> = (0..5)
            .map(|i| Waypoint {
                lat: 18.44 + i as f64 * 0.003,
                lon: 77.45,
                elev: Some(-2570.0 + i as f64 * 16.0),
            })
            .collect();
        let r = check(&t, &on, 100.0);
        assert!(r.near_share > 0.99);
        let off: Vec<Waypoint> = on
            .iter()
            .map(|p| Waypoint {
                lon: p.lon + 0.02,
                ..*p
            })
            .collect();
        assert!(check(&t, &off, 100.0).near_share < 0.01);
    }
}

/// One point of the rover path with the walk home from there.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WalkbackPoint {
    pub lat: f64,
    pub lon: f64,
    /// Distance driven from the start of the record, km (same measure as `RoverStats::km`).
    pub km: f64,
    pub sol: u32,
    /// Walk home from here as a share of the budget (≤ 1: can walk home). `None`: base not
    /// reachable on foot, or outside the elevation grid (see `inside`).
    pub ratio: Option<f64>,
    pub inside: bool,
}

/// "If a crewed rover drove Perseverance's path and broke down, could the crew walk home?"
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoverWalkback {
    pub points: Vec<WalkbackPoint>,
    /// Index of the first point (inside the grid) the crew could not walk home from.
    pub first_stranded: Option<usize>,
    /// Share of the driven km (inside the grid) from which the crew can walk home.
    pub ok_share: f64,
    /// Driven km inside the elevation grid.
    pub inside_km: f64,
    pub budget_h: f64,
}

/// Walk-home check along the stored traverse, base at (`base_lat`, `base_lon`); `home` is
/// `grid::home_ratio` for that base on grid `g`.
pub fn walkback(
    t: &Traverse,
    g: &crate::grid::Grid,
    home: &[Option<f64>],
    budget_h: f64,
) -> RoverWalkback {
    let w = World::Mars;
    let lat0 = t
        .drives
        .first()
        .and_then(|d| d.c.first())
        .map(|c| c[1])
        .unwrap_or(0.0);
    let at = |lat: f64, lon: f64| -> (bool, Option<f64>) {
        if !g.contains(lat, lon) {
            return (false, None);
        }
        let (r, c) = g.rc(lat, lon);
        let i = r.round() as usize * g.cols + c.round() as usize;
        (true, home.get(i).copied().flatten())
    };
    let ok = |p: &WalkbackPoint| p.ratio.is_some_and(|r| r <= 1.0);
    let mut points = Vec::new();
    let (mut km, mut inside_km, mut ok_km) = (0.0, 0.0, 0.0);
    for d in &t.drives {
        for (i, c) in d.c.iter().enumerate() {
            if i > 0 {
                let a = d.c[i - 1];
                let (ax, ay) = xy(w, lat0, a[0], a[1]);
                let (bx, by) = xy(w, lat0, c[0], c[1]);
                km += ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt() / 1000.0;
            }
            let (inside, ratio) = at(c[1], c[0]);
            let p = WalkbackPoint {
                lat: c[1],
                lon: c[0],
                km,
                sol: d.sol,
                ratio,
                inside,
            };
            if let Some(prev) = points.last() {
                let prev: &WalkbackPoint = prev;
                if inside && prev.inside {
                    let seg = km - prev.km;
                    inside_km += seg;
                    if ok(&p) {
                        ok_km += seg;
                    }
                }
            }
            points.push(p);
        }
    }
    let first_stranded = points.iter().position(|p| p.inside && !ok(p));
    RoverWalkback {
        points,
        first_stranded,
        ok_share: if inside_km > 0.0 {
            ok_km / inside_km
        } else {
            0.0
        },
        inside_km,
        budget_h,
    }
}

#[cfg(test)]
mod walkback_tests {
    use super::*;
    use crate::grid::{home_ratio, Grid};
    use crate::route::EvaParams;

    #[test]
    fn stranded_where_the_walk_home_no_longer_fits() {
        // Flat 0.01° (~590 m) grid on Mars; a drive heading east from the base.
        let g = Grid {
            lat0: 0.0,
            lon0: 0.0,
            dlat: 0.01,
            dlon: 0.01,
            rows: 3,
            cols: 200,
            z: vec![Some(0.0); 600],
            foot: Vec::new(),
            blocked: Vec::new(),
        };
        let p = EvaParams {
            speed_kmh: 2.0,
            o2_h: 2.0,
            water_h: 2.0,
            reserve: 0.0,
            min_reserve_h: 0.0,
            unknown_slope: 0.3,
            work_h: 0.0,
        };
        let home = home_ratio(World::Mars, &g, 0.0, 0.0, &p, 25.0);
        let t = Traverse {
            drives: vec![Drive {
                sol: 10,
                c: (0..150).map(|i| [i as f64 * 0.01, 0.0, 0.0]).collect(),
            }],
        };
        let r = walkback(&t, &g, &home, p.budget());
        let i = r.first_stranded.expect("strands somewhere");
        let p0 = &r.points[i];
        // Budget 2 h at ~2 km/h on flat ground: home is too far a little beyond ~4 km.
        assert!(p0.km > 2.0 && p0.km < 8.0, "{}", p0.km);
        assert!(r.points[i - 1].ratio.unwrap() <= 1.0 && p0.ratio.is_none_or(|x| x > 1.0));
        assert!(r.ok_share > 0.0 && r.ok_share < 1.0);
        assert_eq!(p0.sol, 10);
    }
}

/// One row of the traverse as a table (for DuckDB/parquet export): which drive, its sol, position
/// and the distance driven so far, measured exactly as `RoverStats::km` and `walkback` do.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraversePoint {
    /// Index of the drive in the record (file order).
    pub drive: usize,
    /// Index of the point within its drive.
    pub seq: usize,
    pub sol: u32,
    pub lat: f64,
    pub lon: f64,
    pub elev_m: f64,
    pub km: f64,
}

pub fn points(t: &Traverse) -> Vec<TraversePoint> {
    let w = World::Mars;
    let lat0 = t
        .drives
        .first()
        .and_then(|d| d.c.first())
        .map(|c| c[1])
        .unwrap_or(0.0);
    let mut km = 0.0;
    let mut out = Vec::new();
    for (di, d) in t.drives.iter().enumerate() {
        for (i, c) in d.c.iter().enumerate() {
            if i > 0 {
                let a = d.c[i - 1];
                let (ax, ay) = xy(w, lat0, a[0], a[1]);
                let (bx, by) = xy(w, lat0, c[0], c[1]);
                km += ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt() / 1000.0;
            }
            out.push(TraversePoint {
                drive: di,
                seq: i,
                sol: d.sol,
                lat: c[1],
                lon: c[0],
                elev_m: c[2],
                km,
            });
        }
    }
    out
}

/// Rebuild a traverse from table rows (as read back with SQL), drives in `drive` order.
pub fn from_points(rows: &[TraversePoint]) -> Traverse {
    let mut drives: Vec<Drive> = Vec::new();
    let mut last: Option<usize> = None;
    for r in rows {
        if last != Some(r.drive) {
            drives.push(Drive {
                sol: r.sol,
                c: Vec::new(),
            });
            last = Some(r.drive);
        }
        drives.last_mut().unwrap().c.push([r.lon, r.lat, r.elev_m]);
    }
    Traverse { drives }
}

#[cfg(test)]
mod points_tests {
    use super::*;

    #[test]
    fn table_round_trip_keeps_the_numbers() {
        let t = Traverse {
            drives: vec![
                Drive {
                    sol: 15,
                    c: vec![[77.45, 18.44, -2569.0], [77.4505, 18.4402, -2570.0]],
                },
                Drive {
                    sol: 16,
                    c: vec![
                        [77.451, 18.441, -2571.0],
                        [77.452, 18.442, -2572.0],
                        [77.453, 18.443, -2573.0],
                    ],
                },
            ],
        };
        let p = points(&t);
        assert_eq!(p.len(), 5);
        assert!((p.last().unwrap().km - stats(&t, 25.0).km).abs() < 1e-12);
        assert_eq!(from_points(&p).drives.len(), 2);
        assert_eq!(
            serde_json::to_string(&from_points(&p)).unwrap(),
            serde_json::to_string(&t).unwrap()
        );
    }
}
