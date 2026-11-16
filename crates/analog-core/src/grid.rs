//! Elevation grids (north-up lat/lon rasters) and the "walk-home area" around a base.
//!
//! The area is computed with two Dijkstra runs over the grid's 8-neighbour graph: one for the
//! effort to walk out from the base to every cell, one for the effort to walk back. A cell is
//! reachable when out + back fits the consumable budget. Uphill and downhill differ, so the two
//! runs are not the same.

use crate::route::{effort_factor, slope_factor, EvaParams};
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grid {
    /// Latitude of the centre of the first (north-most) row.
    pub lat0: f64,
    /// Longitude of the centre of the first (west-most) column.
    pub lon0: f64,
    /// Row / column spacing in degrees (positive; rows go south).
    pub dlat: f64,
    pub dlon: f64,
    pub rows: usize,
    pub cols: usize,
    /// Row-major elevations in metres; `None` where unknown.
    pub z: Vec<Option<f64>>,
    /// Row-major footing factor η (crate::footing; 1.0 = firm); empty = not counted.
    #[serde(default, skip_serializing)]
    pub foot: Vec<f32>,
    /// Row-major cells reported as blocked (e.g. an obstacle seen on the way); empty = none.
    /// Blocked cells are never stepped into by any route search.
    #[serde(default, skip_serializing)]
    pub blocked: Vec<bool>,
}

impl Grid {
    pub fn at(&self, r: usize, c: usize) -> Option<f64> {
        self.z.get(r * self.cols + c).copied().flatten()
    }
    pub fn lat(&self, r: f64) -> f64 {
        self.lat0 - r * self.dlat
    }
    pub fn lon(&self, c: f64) -> f64 {
        self.lon0 + c * self.dlon
    }
    /// Fractional (row, col) of a point.
    pub fn rc(&self, lat: f64, lon: f64) -> (f64, f64) {
        ((self.lat0 - lat) / self.dlat, (lon - self.lon0) / self.dlon)
    }
    pub fn contains(&self, lat: f64, lon: f64) -> bool {
        let (r, c) = self.rc(lat, lon);
        r >= 0.0 && c >= 0.0 && r <= (self.rows - 1) as f64 && c <= (self.cols - 1) as f64
    }
    /// Bilinear elevation; `None` outside the grid or next to a hole.
    pub fn sample(&self, lat: f64, lon: f64) -> Option<f64> {
        if !self.contains(lat, lon) {
            return None;
        }
        let (r, c) = self.rc(lat, lon);
        let (r0, c0) = (r.floor() as usize, c.floor() as usize);
        let (r1, c1) = ((r0 + 1).min(self.rows - 1), (c0 + 1).min(self.cols - 1));
        let (fr, fc) = (r - r0 as f64, c - c0 as f64);
        let a = self.at(r0, c0)?;
        let b = self.at(r0, c1)?;
        let d = self.at(r1, c0)?;
        let e = self.at(r1, c1)?;
        Some((a * (1.0 - fc) + b * fc) * (1.0 - fr) + (d * (1.0 - fc) + e * fc) * fr)
    }
    /// Footing factor of cell `i` (1.0 where not set).
    pub fn blocked_cell(&self, i: usize) -> bool {
        self.blocked.get(i).copied().unwrap_or(false)
    }
    /// Blocked at a point (nearest cell).
    pub fn blocked_at(&self, lat: f64, lon: f64) -> bool {
        if self.blocked.is_empty() || !self.contains(lat, lon) {
            return false;
        }
        let (r, c) = self.rc(lat, lon);
        self.blocked_cell(r.round() as usize * self.cols + c.round() as usize)
    }
    pub fn foot_cell(&self, i: usize) -> f64 {
        self.foot.get(i).map_or(1.0, |&x| f64::from(x))
    }
    /// Footing factor at a point (nearest cell); `None` outside the grid or without footing.
    pub fn foot_at(&self, lat: f64, lon: f64) -> Option<f64> {
        if self.foot.is_empty() || !self.contains(lat, lon) {
            return None;
        }
        let (r, c) = self.rc(lat, lon);
        Some(self.foot_cell(r.round() as usize * self.cols + c.round() as usize))
    }
    /// Mean footing factor along the straight line a → b (about one sample per cell); 1.0 where
    /// unknown.
    pub fn foot_line(&self, a: (f64, f64), b: (f64, f64)) -> f64 {
        if self.foot.is_empty() {
            return 1.0;
        }
        let steps = (((b.0 - a.0) / self.dlat)
            .abs()
            .max(((b.1 - a.1) / self.dlon).abs())
            .ceil() as usize)
            .clamp(1, 4000);
        let sum: f64 = (0..=steps)
            .map(|k| {
                let f = k as f64 / steps as f64;
                self.foot_at(a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f)
                    .unwrap_or(1.0)
            })
            .sum();
        sum / (steps + 1) as f64
    }
    /// Cell size in metres (north-south, east-west) on a body.
    pub fn cell_m(&self, world: World) -> (f64, f64) {
        let k = world.info().radius_km * 1000.0 * std::f64::consts::PI / 180.0;
        let mid = self.lat((self.rows as f64 - 1.0) / 2.0).to_radians().cos();
        (self.dlat * k, self.dlon * k * mid)
    }
}

#[derive(Copy, Clone, PartialEq)]
struct Node(f64, usize);
impl Eq for Node {}
impl Ord for Node {
    fn cmp(&self, o: &Self) -> Ordering {
        o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal)
    }
}
impl PartialOrd for Node {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// Result of [`reach`]: per-cell share of the budget used for out + back (≤ 1 is reachable).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reach {
    pub rows: usize,
    pub cols: usize,
    /// Row-major; `None` where unreachable even in theory (holes, outside).
    pub ratio: Vec<Option<f64>>,
    pub budget_h: f64,
    /// Area of reachable cells, km².
    pub area_km2: f64,
    /// Farthest reachable straight-line distance from base, km.
    pub max_km: f64,
}

/// Base cell index of `(lat, lon)`, clamped into the grid.
fn base_cell(g: &Grid, lat: f64, lon: f64) -> (usize, usize) {
    let (br, bc) = g.rc(lat, lon);
    (
        br.round().clamp(0.0, (g.rows - 1) as f64) as usize,
        bc.round().clamp(0.0, (g.cols - 1) as f64) as usize,
    )
}

/// Effort-hours from the base cell to every cell (`reverse`: from every cell back to the base),
/// up to the budget; steps steeper than `max_slope_deg` are not walkable.
fn efforts(
    world: World,
    g: &Grid,
    start: usize,
    p: &EvaParams,
    max_slope_deg: f64,
    reverse: bool,
) -> Vec<f64> {
    dijkstra(world, g, start, p, max_slope_deg, reverse, p.budget(), None).0
}

/// Effort-hours to walk `dist` metres from elevation `za` to `zb`; `None` when steeper than
/// `max_slope` (rise over run).
fn step_cost(
    p: &EvaParams,
    za: Option<f64>,
    zb: Option<f64>,
    dist: f64,
    max_slope: f64,
) -> Option<f64> {
    let slope = match (za, zb) {
        (Some(za), Some(zb)) => (zb - za) / dist,
        _ => p.unknown_slope.abs(),
    };
    if slope.abs() > max_slope {
        return None;
    }
    Some(dist / (p.speed_kmh * 1000.0 * slope_factor(slope)) * effort_factor(slope))
}

/// Effort-hours to walk the straight line between two points, sampled about once per cell.
fn line_cost(
    world: World,
    g: &Grid,
    a: (f64, f64),
    b: (f64, f64),
    p: &EvaParams,
    max_slope: f64,
) -> Option<f64> {
    let (dy, dx) = g.cell_m(world);
    let len = (((b.0 - a.0) / g.dlat * dy).powi(2) + ((b.1 - a.1) / g.dlon * dx).powi(2)).sqrt();
    let n = ((len / dy.min(dx)).ceil() as usize).max(1);
    let seg = len / n as f64;
    let mut total = 0.0;
    let mut prev = g.sample(a.0, a.1);
    for k in 1..=n {
        let f = k as f64 / n as f64;
        let (la, lo) = (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f);
        let z = g.sample(la, lo);
        if g.blocked_at(la, lo) {
            return None;
        }
        total += step_cost(p, prev, z, seg, max_slope)? * g.foot_at(la, lo).unwrap_or(1.0);
        prev = z;
    }
    Some(total)
}

/// Dijkstra over the 8-neighbour graph from `start`, up to `cap` effort-hours, stopping early
/// once `target` is settled. Returns effort per cell and each cell's predecessor.
#[allow(clippy::too_many_arguments)]
fn dijkstra(
    world: World,
    g: &Grid,
    start: usize,
    p: &EvaParams,
    max_slope_deg: f64,
    reverse: bool,
    cap: f64,
    target: Option<usize>,
) -> (Vec<f64>, Vec<usize>) {
    let n = g.rows * g.cols;
    let budget = cap;
    let (dy, dx) = g.cell_m(world);
    let max_slope = max_slope_deg.to_radians().tan();
    // Effort-hours to step from cell a to neighbour b.
    // Footing: mean of the two cells (loose ground is slower and costs more per km).
    let step = |a: usize, b: usize, dist: f64| {
        if g.blocked_cell(a) || g.blocked_cell(b) {
            return None;
        }
        step_cost(p, g.z[a], g.z[b], dist, max_slope)
            .map(|h| h * (g.foot_cell(a) + g.foot_cell(b)) / 2.0)
    };
    let dirs: [(i64, i64); 8] = [
        (-1, 0),
        (1, 0),
        (0, -1),
        (0, 1),
        (-1, -1),
        (-1, 1),
        (1, -1),
        (1, 1),
    ];
    let mut best = vec![f64::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    let mut heap = BinaryHeap::new();
    best[start] = 0.0;
    heap.push(Node(0.0, start));
    while let Some(Node(cost, i)) = heap.pop() {
        if cost > best[i] || cost > budget {
            continue;
        }
        if Some(i) == target {
            break;
        }
        let (r, c) = ((i / g.cols) as i64, (i % g.cols) as i64);
        for (ddr, ddc) in dirs {
            let (nr, nc) = (r + ddr, c + ddc);
            if nr < 0 || nc < 0 || nr >= g.rows as i64 || nc >= g.cols as i64 {
                continue;
            }
            let j = nr as usize * g.cols + nc as usize;
            let dist = ((ddr as f64 * dy).powi(2) + (ddc as f64 * dx).powi(2)).sqrt();
            // Outbound: i → j. Return trip: walking j → i, so cost the reverse step.
            let s = if reverse {
                step(j, i, dist)
            } else {
                step(i, j, dist)
            };
            if let Some(s) = s {
                let nc2 = cost + s;
                if nc2 < best[j] {
                    best[j] = nc2;
                    prev[j] = i;
                    heap.push(Node(nc2, j));
                }
            }
        }
    }
    (best, prev)
}

/// Least-effort walking path between two points over the grid (the "easy path" when drawing a
/// route): cell centres from `from` to `to`, with the end points themselves at both ends.
/// `None` when either point is outside the grid or no walkable path connects them.
pub fn easy_path(
    world: World,
    g: &Grid,
    from: (f64, f64),
    to: (f64, f64),
    p: &EvaParams,
    max_slope_deg: f64,
) -> Option<Vec<(f64, f64)>> {
    if !g.contains(from.0, from.1) || !g.contains(to.0, to.1) || g.rows == 0 || g.cols == 0 {
        return None;
    }
    let (ar, ac) = base_cell(g, from.0, from.1);
    let (br, bc) = base_cell(g, to.0, to.1);
    let (a, b) = (ar * g.cols + ac, br * g.cols + bc);
    let (best, prev) = dijkstra(world, g, a, p, max_slope_deg, false, f64::INFINITY, Some(b));
    if !best[b].is_finite() {
        return None;
    }
    let mut cells = vec![b];
    while let Some(&i) = cells.last() {
        if i == a {
            break;
        }
        cells.push(prev[i]);
    }
    cells.reverse();
    // Grid path: the end points themselves, cell centres in between.
    let ll = |i: usize| (g.lat((i / g.cols) as f64), g.lon((i % g.cols) as f64));
    let mut pts: Vec<(f64, f64)> = cells.iter().map(|&i| ll(i)).collect();
    let mut cost: Vec<f64> = cells.iter().map(|&i| best[i]).collect();
    pts[0] = from;
    if pts.len() > 1 {
        *pts.last_mut().unwrap() = to;
    } else {
        pts.push(to);
        cost.push(best[b]);
    }
    // String-pull: an 8-neighbour path zigzags even on flat ground, so from each anchor jump to
    // the farthest point whose straight line costs no more than 3% over the grid path to it.
    let max_slope = max_slope_deg.to_radians().tan();
    let mut out = vec![pts[0]];
    let mut i = 0;
    while i + 1 < pts.len() {
        let mut j = i + 1;
        for k in (i + 2..pts.len()).rev() {
            let grid_cost = cost[k] - cost[i];
            if let Some(c) = line_cost(world, g, pts[i], pts[k], p, max_slope) {
                if c <= grid_cost * 1.03 + 1e-9 {
                    j = k;
                    break;
                }
            }
        }
        out.push(pts[j]);
        i = j;
    }
    Some(out)
}

/// Per cell: effort to walk back to the base only, as a share of the budget (≤ 1: can walk home).
/// `None` where the base cannot be reached within the budget. Used when the crew is already out
/// there (for example a rover that broke down) and only the walk home counts.
pub fn home_ratio(
    world: World,
    g: &Grid,
    base_lat: f64,
    base_lon: f64,
    p: &EvaParams,
    max_slope_deg: f64,
) -> Vec<Option<f64>> {
    let budget = p.budget();
    let (br, bc) = base_cell(g, base_lat, base_lon);
    efforts(world, g, br * g.cols + bc, p, max_slope_deg, true)
        .into_iter()
        .map(|t| (t.is_finite() && budget > 0.0).then(|| t / budget))
        .collect()
}

/// Walk-home area around a base. Steps steeper than `max_slope_deg` are not walkable.
pub fn reach(
    world: World,
    g: &Grid,
    base_lat: f64,
    base_lon: f64,
    p: &EvaParams,
    max_slope_deg: f64,
) -> Reach {
    let n = g.rows * g.cols;
    let budget = p.budget();
    let (dy, dx) = g.cell_m(world);
    let (br, bc) = base_cell(g, base_lat, base_lon);
    let start = br * g.cols + bc;
    let run = |reverse: bool| efforts(world, g, start, p, max_slope_deg, reverse);
    let out = run(false);
    let back = run(true);
    let mut area = 0.0;
    let mut max_km = 0.0_f64;
    let ratio = (0..n)
        .map(|i| {
            let t = out[i] + back[i] + p.work();
            if !t.is_finite() || budget <= 0.0 {
                return None;
            }
            let r = t / budget;
            if r <= 1.0 {
                area += dx * dy / 1e6;
                let (rr, cc) = ((i / g.cols) as f64, (i % g.cols) as f64);
                let d = (((rr - br as f64) * dy).powi(2) + ((cc - bc as f64) * dx).powi(2)).sqrt();
                max_km = max_km.max(d / 1000.0);
            }
            Some(r)
        })
        .collect();
    Reach {
        rows: g.rows,
        cols: g.cols,
        ratio,
        budget_h: budget,
        area_km2: area,
        max_km,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(rows: usize, cols: usize, d: f64) -> Grid {
        Grid {
            lat0: 0.0,
            lon0: 0.0,
            dlat: d,
            dlon: d,
            rows,
            cols,
            z: vec![Some(0.0); rows * cols],
            foot: Vec::new(),
            blocked: Vec::new(),
        }
    }
    fn params() -> EvaParams {
        EvaParams {
            water_h: 100.0,
            min_reserve_h: 0.0,
            ..EvaParams::new(2.0, 2.0, 0.0)
        }
    }

    #[test]
    fn bilinear_sample() {
        let mut g = flat(2, 2, 1.0);
        g.z = vec![Some(0.0), Some(10.0), Some(20.0), Some(30.0)];
        assert!((g.sample(-0.5, 0.5).unwrap() - 15.0).abs() < 1e-9);
        assert!(g.sample(1.0, 0.0).is_none());
    }

    #[test]
    fn flat_reach_is_about_half_budget_radius() {
        // 2 h budget at 2 km/h → 2 km out and 2 km back. Cell ≈ 59 m on Mars at 0.001°.
        let g = flat(161, 161, 0.001);
        let r = reach(World::Mars, &g, -0.08, 0.08, &params(), 25.0);
        assert!((r.max_km - 2.0).abs() < 0.15, "max_km {}", r.max_km);
        let disk = std::f64::consts::PI * 4.0;
        assert!(
            r.area_km2 > disk * 0.75 && r.area_km2 < disk * 1.05,
            "area {}",
            r.area_km2
        );
    }

    #[test]
    fn a_wall_blocks_the_way() {
        let mut g = flat(61, 61, 0.001);
        // 500 m cliff along column 40.
        for r in 0..61 {
            for c in 40..61 {
                g.z[r * 61 + c] = Some(500.0);
            }
        }
        let rr = reach(World::Mars, &g, -0.03, 0.03, &params(), 25.0);
        let east = rr.ratio[30 * 61 + 45];
        assert!(east.is_none(), "beyond the cliff should be unreachable");
        assert!(rr.ratio[30 * 61 + 35].unwrap() < 1.0);
    }

    #[test]
    fn easy_path_goes_around_blocked_cells() {
        let mut g = flat(61, 61, 0.001);
        // Flat ground, but cells across column 30 reported blocked (open at the south end).
        g.blocked = vec![false; 61 * 61];
        for r in 0..50 {
            g.blocked[r * 61 + 30] = true;
        }
        let path = easy_path(
            World::Mars,
            &g,
            (-0.03, -0.0),
            (-0.03, 0.06),
            &params(),
            25.0,
        )
        .unwrap();
        assert!(
            path.iter().any(|&(lat, _)| lat <= -0.0495),
            "path did not detour around the blocked cells"
        );
        assert!(
            path.iter().all(|&(lat, lon)| !g.blocked_at(lat, lon)),
            "path steps on a blocked cell"
        );
        // No blocked cells: straight across.
        g.blocked.clear();
        let straight = easy_path(
            World::Mars,
            &g,
            (-0.03, -0.0),
            (-0.03, 0.06),
            &params(),
            25.0,
        )
        .unwrap();
        assert!(straight.iter().all(|&(lat, _)| (lat + 0.03).abs() < 1e-9));
    }

    #[test]
    fn easy_path_goes_around_a_wall() {
        let mut g = flat(61, 61, 0.001);
        // 500 m wall across column 30, open at the south end (rows 50..).
        for r in 0..50 {
            g.z[r * 61 + 30] = Some(500.0);
        }
        let path = easy_path(
            World::Mars,
            &g,
            (-0.03, -0.0),
            (-0.03, 0.06),
            &params(),
            25.0,
        )
        .unwrap();
        assert_eq!(path.first(), Some(&(-0.03, -0.0)));
        assert_eq!(path.last(), Some(&(-0.03, 0.06)));
        // It must pass the wall through the gap, south of row 50 (lat ≤ -0.05).
        assert!(
            path.iter().any(|&(lat, _)| lat <= -0.0495),
            "path did not detour"
        );
        // Flat ground: the straight line, no zigzag points.
        let flat_path = easy_path(
            World::Mars,
            &flat(61, 61, 0.001),
            (-0.01, 0.0),
            (-0.05, 0.03),
            &params(),
            25.0,
        )
        .unwrap();
        assert_eq!(flat_path.len(), 2, "{flat_path:?}");
        // Outside the grid: no path.
        assert!(easy_path(World::Mars, &g, (1.0, 0.0), (-0.03, 0.06), &params(), 25.0).is_none());
    }
}

/// What the route planner trades off. Each weight multiplies a dimensionless penalty added to the
/// walking time of a step (1.0 = as costly as the time itself); all zero but `time` = fastest walk.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct RouteWeights {
    /// Walking time (and so O₂ / water): the base cost.
    #[serde(default = "one")]
    pub time: f64,
    /// Avoid steep steps: penalty (slope / 10°)².
    #[serde(default)]
    pub slope: f64,
    /// Avoid poor footing: penalty (η − 1) / 0.5 (η from footing.rs).
    #[serde(default)]
    pub footing: f64,
    /// Keep a margin for the walk home: penalty = share of the budget out + back from that cell.
    #[serde(default)]
    pub margin: f64,
    /// Shortest distance instead: the step cost is its length (still only walkable cells of the
    /// walk-home area); the other weights are ignored.
    #[serde(default)]
    pub distance: bool,
}
fn one() -> f64 {
    1.0
}
impl Default for RouteWeights {
    fn default() -> Self {
        RouteWeights {
            time: 1.0,
            slope: 0.0,
            footing: 0.0,
            margin: 0.0,
            distance: false,
        }
    }
}

/// Why no route: the destination is outside the walk-home area (or outside the grid).
#[derive(Debug, Clone, Serialize)]
pub struct PlannedRoute {
    /// [lat, lon] from the base to the destination (string-pulled), empty when none.
    pub path: Vec<(f64, f64)>,
    /// "ok" | "outside_grid" | "outside_reach" | "no_path"
    pub status: &'static str,
    /// Share of the budget (out + back) at the destination cell.
    pub goal_ratio: Option<f64>,
    /// Cells in the order Dijkstra settled them, with their weighted cost (for the search
    /// animation; not serialized).
    #[serde(skip)]
    pub settled: Vec<u32>,
    #[serde(skip)]
    pub settled_cost: Vec<f32>,
    /// 0 = settled from the base, 1 = from the destination (bidirectional search).
    #[serde(skip)]
    pub settled_side: Vec<u8>,
    /// Cost of the cell path before string-pulling (comparison tests).
    #[serde(skip)]
    pub path_cost: f64,
}

/// Plan a walk from the base to a destination: Dijkstra over the cells of the walk-home area only
/// (cells where walking out and back fits the budget), with the step cost = walking time
/// (slope, footing) × (time weight + the other penalties). The cell path is string-pulled where a
/// straight line costs no more than 3 % over it.
pub fn plan_route(
    world: World,
    g: &Grid,
    from: (f64, f64),
    to: (f64, f64),
    p: &EvaParams,
    max_slope_deg: f64,
    w: &RouteWeights,
) -> PlannedRoute {
    plan_route_with(world, g, from, to, p, max_slope_deg, w, true)
}

/// plan_route with the search chosen: bidirectional (default) or one-sided from the base.
#[allow(clippy::too_many_arguments)]
pub fn plan_route_with(
    world: World,
    g: &Grid,
    from: (f64, f64),
    to: (f64, f64),
    p: &EvaParams,
    max_slope_deg: f64,
    w: &RouteWeights,
    bidirectional: bool,
) -> PlannedRoute {
    let none = |status, goal_ratio| PlannedRoute {
        path: Vec::new(),
        status,
        goal_ratio,
        settled: Vec::new(),
        settled_cost: Vec::new(),
        settled_side: Vec::new(),
        path_cost: f64::INFINITY,
    };
    if g.rows == 0 || !g.contains(from.0, from.1) || !g.contains(to.0, to.1) {
        return none("outside_grid", None);
    }
    let budget = p.budget();
    let (ar, ac) = base_cell(g, from.0, from.1);
    let (br, bc) = base_cell(g, to.0, to.1);
    let (a, b) = (ar * g.cols + ac, br * g.cols + bc);
    let out = efforts(world, g, a, p, max_slope_deg, false);
    let back = efforts(world, g, a, p, max_slope_deg, true);
    let ratio = |i: usize| {
        let t = out[i] + back[i] + p.work();
        (t.is_finite() && budget > 0.0).then(|| t / budget)
    };
    let goal_ratio = ratio(b);
    if goal_ratio.is_none_or(|r| r > 1.0) {
        return none("outside_reach", goal_ratio);
    }
    let (dy, dx) = g.cell_m(world);
    let max_slope = max_slope_deg.to_radians().tan();
    // Weighted step cost between neighbouring cells; None = not walkable or outside the area.
    let cost = |i: usize, j: usize, dist: f64| -> Option<f64> {
        if g.blocked_cell(i) || g.blocked_cell(j) {
            return None;
        }
        let rj = ratio(j).filter(|&r| r <= 1.0)?;
        let t = step_cost(p, g.z[i], g.z[j], dist, max_slope)?;
        if w.distance {
            return Some(dist / 1000.0);
        }
        let foot = (g.foot_cell(i) + g.foot_cell(j)) / 2.0;
        let slope_deg = match (g.z[i], g.z[j]) {
            (Some(x), Some(y)) => ((y - x).abs() / dist).atan().to_degrees(),
            _ => 17.0,
        };
        let pen = w.time
            + w.slope * (slope_deg / 10.0).powi(2)
            + w.footing * ((foot - 1.0) / 0.5).max(0.0)
            + w.margin * rj;
        Some(t * foot * pen)
    };
    let n = g.rows * g.cols;
    let dirs: [(i64, i64); 8] = [
        (-1, 0),
        (1, 0),
        (0, -1),
        (0, 1),
        (-1, -1),
        (-1, 1),
        (1, -1),
        (1, 1),
    ];
    let neighbours = |i: usize| {
        let (r, c) = ((i / g.cols) as i64, (i % g.cols) as i64);
        dirs.iter().filter_map(move |&(ddr, ddc)| {
            let (nr, nc) = (r + ddr, c + ddc);
            (nr >= 0 && nc >= 0 && nr < g.rows as i64 && nc < g.cols as i64).then(|| {
                let dist = ((ddr as f64 * dy).powi(2) + (ddc as f64 * dx).powi(2)).sqrt();
                (nr as usize * g.cols + nc as usize, dist)
            })
        })
    };
    let (mut settled, mut settled_cost, mut settled_side) = (Vec::new(), Vec::new(), Vec::new());
    let cells: Vec<usize> = if !bidirectional {
        // One-sided Dijkstra from the base.
        let mut best = vec![f64::INFINITY; n];
        let mut prev = vec![usize::MAX; n];
        let mut heap = BinaryHeap::new();
        best[a] = 0.0;
        heap.push(Node(0.0, a));
        while let Some(Node(c, i)) = heap.pop() {
            if c > best[i] {
                continue;
            }
            settled.push(i as u32);
            settled_cost.push(c as f32);
            settled_side.push(0u8);
            if i == b {
                break;
            }
            for (j, dist) in neighbours(i) {
                if let Some(s) = cost(i, j, dist) {
                    if c + s < best[j] {
                        best[j] = c + s;
                        prev[j] = i;
                        heap.push(Node(c + s, j));
                    }
                }
            }
        }
        if !best[b].is_finite() {
            Vec::new()
        } else {
            let mut cells = vec![b];
            while let Some(&i) = cells.last() {
                if i == a {
                    break;
                }
                cells.push(prev[i]);
            }
            cells.reverse();
            cells
        }
    } else if a == b {
        vec![a]
    } else {
        // Bidirectional Dijkstra: from the base with the step costs, from the destination with the
        // reversed steps (walking v → u costs cost(v, u): uphill and downhill differ), both only
        // through cells of the walk-home area. Stop once the two frontiers' minima add up to at
        // least the best meeting found (then that meeting is optimal).
        let mut df = vec![f64::INFINITY; n];
        let mut db = vec![f64::INFINITY; n];
        let (mut pf, mut pb) = (vec![usize::MAX; n], vec![usize::MAX; n]);
        let (mut hf, mut hb) = (BinaryHeap::new(), BinaryHeap::new());
        df[a] = 0.0;
        db[b] = 0.0;
        hf.push(Node(0.0, a));
        hb.push(Node(0.0, b));
        let (mut mu, mut meet) = (f64::INFINITY, (usize::MAX, usize::MAX));
        let allowed = |i: usize| i == a || ratio(i).is_some_and(|r| r <= 1.0);
        loop {
            let tf = hf.peek().map_or(f64::INFINITY, |x: &Node| x.0);
            let tb = hb.peek().map_or(f64::INFINITY, |x: &Node| x.0);
            if (tf.is_infinite() && tb.is_infinite()) || tf + tb >= mu {
                break;
            }
            if tf <= tb {
                let Node(c, i) = hf.pop().unwrap();
                if c > df[i] {
                    continue;
                }
                settled.push(i as u32);
                settled_cost.push(c as f32);
                settled_side.push(0);
                for (j, dist) in neighbours(i) {
                    if let Some(s) = cost(i, j, dist) {
                        if c + s < df[j] {
                            df[j] = c + s;
                            pf[j] = i;
                            hf.push(Node(c + s, j));
                        }
                        if db[j].is_finite() && c + s + db[j] < mu {
                            mu = c + s + db[j];
                            meet = (i, j);
                        }
                    }
                }
            } else {
                let Node(c, u) = hb.pop().unwrap();
                if c > db[u] {
                    continue;
                }
                settled.push(u as u32);
                settled_cost.push(c as f32);
                settled_side.push(1);
                for (v, dist) in neighbours(u) {
                    if !allowed(v) {
                        continue;
                    }
                    if let Some(s) = cost(v, u, dist) {
                        if c + s < db[v] {
                            db[v] = c + s;
                            pb[v] = u;
                            hb.push(Node(c + s, v));
                        }
                        if df[v].is_finite() && df[v] + s + c < mu {
                            mu = df[v] + s + c;
                            meet = (v, u);
                        }
                    }
                }
            }
        }
        if !mu.is_finite() {
            Vec::new()
        } else {
            let (x, y) = meet;
            let mut head = vec![x];
            while let Some(&i) = head.last() {
                if i == a {
                    break;
                }
                head.push(pf[i]);
            }
            head.reverse();
            let mut tail = vec![y];
            while let Some(&i) = tail.last() {
                if i == b {
                    break;
                }
                tail.push(pb[i]);
            }
            head.extend(tail);
            head
        }
    };
    if cells.is_empty() {
        return PlannedRoute {
            settled,
            settled_cost,
            settled_side,
            ..none("no_path", goal_ratio)
        };
    }
    // Cost from the base along the path (for the string-pull below and the comparison tests).
    let step_dist = |i: usize, j: usize| {
        let (dr, dc) = (
            (j / g.cols) as f64 - (i / g.cols) as f64,
            (j % g.cols) as f64 - (i % g.cols) as f64,
        );
        ((dr * dy).powi(2) + (dc * dx).powi(2)).sqrt()
    };
    let mut acc = vec![0.0];
    for k in 1..cells.len() {
        let s = cost(cells[k - 1], cells[k], step_dist(cells[k - 1], cells[k]))
            .unwrap_or(f64::INFINITY);
        acc.push(acc[k - 1] + s);
    }
    let path_cost = *acc.last().unwrap();
    let ll = |i: usize| (g.lat((i / g.cols) as f64), g.lon((i % g.cols) as f64));
    let mut pts: Vec<(f64, f64)> = cells.iter().map(|&i| ll(i)).collect();
    pts[0] = from;
    if pts.len() > 1 {
        *pts.last_mut().unwrap() = to;
    } else {
        pts.push(to);
    }
    // String-pull with the same weighted cost sampled along the straight line (≤ 3 % worse).
    let line = |p0: (f64, f64), p1: (f64, f64)| -> Option<f64> {
        let len =
            (((p1.0 - p0.0) / g.dlat * dy).powi(2) + ((p1.1 - p0.1) / g.dlon * dx).powi(2)).sqrt();
        let steps = ((len / dy.min(dx)).ceil() as usize).max(1);
        let mut total = 0.0;
        let mut prev_cell = {
            let (r, c) = g.rc(p0.0, p0.1);
            r.round() as usize * g.cols + c.round() as usize
        };
        for k in 1..=steps {
            let f = k as f64 / steps as f64;
            let (la, lo) = (p0.0 + (p1.0 - p0.0) * f, p0.1 + (p1.1 - p0.1) * f);
            let (r, c) = g.rc(la, lo);
            let cell = r.round() as usize * g.cols + c.round() as usize;
            total += cost(prev_cell, cell, len / steps as f64)?;
            prev_cell = cell;
        }
        Some(total)
    };
    let mut path = vec![pts[0]];
    let mut i = 0;
    while i + 1 < pts.len() {
        let mut j = i + 1;
        for k in (i + 2..pts.len()).rev() {
            if let Some(c) = line(pts[i], pts[k]) {
                if c <= (acc[k] - acc[i]) * 1.03 + 1e-9 {
                    j = k;
                    break;
                }
            }
        }
        path.push(pts[j]);
        i = j;
    }
    PlannedRoute {
        path,
        status: "ok",
        goal_ratio,
        settled,
        settled_cost,
        settled_side,
        path_cost,
    }
}

#[cfg(test)]
mod plan_tests {
    use super::*;

    #[test]
    fn plans_around_a_wall_and_refuses_unreachable_goals() {
        let mut g = Grid {
            lat0: 0.0,
            lon0: 0.0,
            dlat: 0.001,
            dlon: 0.001,
            rows: 61,
            cols: 61,
            z: vec![Some(0.0); 61 * 61],
            foot: Vec::new(),
            blocked: Vec::new(),
        };
        for r in 0..50 {
            g.z[r * 61 + 30] = Some(500.0);
        }
        let p = EvaParams {
            water_h: 100.0,
            min_reserve_h: 0.0,
            ..EvaParams::new(2.0, 8.0, 0.0)
        };
        let r = plan_route(
            World::Mars,
            &g,
            (-0.03, 0.0),
            (-0.03, 0.06),
            &p,
            25.0,
            &RouteWeights::default(),
        );
        assert_eq!(r.status, "ok");
        assert!(r.path.iter().any(|&(lat, _)| lat <= -0.0495));
        // A tiny O₂ budget: the far side is outside the walk-home area.
        let tight = EvaParams {
            water_h: 100.0,
            min_reserve_h: 0.0,
            ..EvaParams::new(2.0, 0.5, 0.0)
        };
        let r2 = plan_route(
            World::Mars,
            &g,
            (-0.03, 0.0),
            (-0.03, 0.06),
            &tight,
            25.0,
            &RouteWeights::default(),
        );
        assert_eq!(r2.status, "outside_reach");
    }

    #[test]
    fn bidirectional_matches_one_sided() {
        // Uneven ground (a ramp and a ridge) so uphill and downhill costs differ.
        let mut g = Grid {
            lat0: 0.0,
            lon0: 0.0,
            dlat: 0.001,
            dlon: 0.001,
            rows: 61,
            cols: 61,
            z: vec![Some(0.0); 61 * 61],
            foot: Vec::new(),
            blocked: Vec::new(),
        };
        for r in 0..61 {
            for c in 0..61 {
                let ridge = if (25..=27).contains(&c) && r < 45 {
                    40.0
                } else {
                    0.0
                };
                g.z[r * 61 + c] = Some(c as f64 * 1.5 + ridge);
            }
        }
        let p = EvaParams {
            water_h: 100.0,
            min_reserve_h: 0.0,
            ..EvaParams::new(2.0, 8.0, 0.0)
        };
        let ws = [
            RouteWeights::default(),
            RouteWeights {
                distance: true,
                ..RouteWeights::default()
            },
            RouteWeights {
                time: 1.0,
                slope: 2.0,
                footing: 1.0,
                margin: 1.0,
                distance: false,
            },
        ];
        for w in ws {
            for to in [(-0.03, 0.06), (-0.055, 0.05), (-0.01, 0.04), (-0.05, 0.002)] {
                let one = plan_route_with(World::Mars, &g, (-0.03, 0.0), to, &p, 30.0, &w, false);
                let two = plan_route_with(World::Mars, &g, (-0.03, 0.0), to, &p, 30.0, &w, true);
                assert_eq!(one.status, two.status);
                if one.status == "ok" {
                    assert!(
                        (one.path_cost - two.path_cost).abs() <= 1e-9 * one.path_cost.max(1.0),
                        "{} vs {}",
                        one.path_cost,
                        two.path_cost
                    );
                }
            }
        }
    }
}
