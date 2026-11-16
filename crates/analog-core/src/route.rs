//! WALKBACK: EVA route evaluation with an O₂ and cooling-water return limit.
//!
//! Consumables are counted in "effort-hours": one hour of walking on flat ground uses one hour of
//! the nominal budget. Climbing costs more per hour (effort = 1 / Tobler factor). Cooling water
//! drains 1.15× faster than O₂ at the same effort: in the NASA walk-back test (Gernhardt 2010,
//! NTRS 20100017354) O₂ use was 2.7× and cooling-water use 3.1× the Apollo nominal rate.

use crate::world::{distance_km, LatLon, World};
use serde::{Deserialize, Serialize};

/// Cooling water drains this much faster than O₂ at the same effort (3.1 / 2.7, Gernhardt 2010).
pub const WATER_PER_O2: f64 = 3.1 / 2.7;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Waypoint {
    pub lat: f64,
    #[serde(alias = "lng")]
    pub lon: f64,
    /// Elevation in metres, if known.
    #[serde(default)]
    pub elev: Option<f64>,
}

impl Waypoint {
    pub fn ll(&self) -> LatLon {
        LatLon {
            lat: self.lat,
            lon: self.lon,
        }
    }
}

fn d_water() -> f64 {
    8.0
}
fn d_min_reserve() -> f64 {
    0.5
}
fn d_unknown_slope() -> f64 {
    UNKNOWN_SLOPE
}

/// Slope assumed where elevation is missing: 30 % (≈17°), so missing data never makes a route look easier.
pub const UNKNOWN_SLOPE: f64 = 0.3;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EvaParams {
    /// Walking speed on flat ground, km/h.
    pub speed_kmh: f64,
    /// O₂ supply at nominal effort, hours.
    pub o2_h: f64,
    /// Reserve kept back, 0–1 of each budget.
    pub reserve: f64,
    /// Cooling-water supply at nominal effort, hours.
    #[serde(default = "d_water")]
    pub water_h: f64,
    /// Reserve is never less than this many hours (Apollo practice: back at base with 30 min left).
    #[serde(default = "d_min_reserve")]
    pub min_reserve_h: f64,
    /// Slope (rise/run) assumed on segments without elevation.
    #[serde(default = "d_unknown_slope")]
    pub unknown_slope: f64,
    /// Hours of work at the destination, counted at the same O2 / water rate as nominal walking
    /// (estimate, 目安). Spent between walking out and walking back.
    #[serde(default)]
    pub work_h: f64,
}

impl EvaParams {
    pub fn new(speed_kmh: f64, o2_h: f64, reserve: f64) -> Self {
        EvaParams {
            speed_kmh,
            o2_h,
            reserve,
            water_h: d_water(),
            min_reserve_h: d_min_reserve(),
            unknown_slope: UNKNOWN_SLOPE,
            work_h: 0.0,
        }
    }

    fn keep(&self, budget: f64) -> f64 {
        (budget * self.reserve.clamp(0.0, 1.0)).max(self.min_reserve_h)
    }
    /// Usable O₂ effort-hours after the reserve.
    pub fn usable_o2(&self) -> f64 {
        (self.o2_h - self.keep(self.o2_h)).max(0.0)
    }
    /// Usable cooling-water effort-hours after the reserve.
    pub fn usable_water(&self) -> f64 {
        (self.water_h - self.keep(self.water_h)).max(0.0)
    }
    /// Effort-hours available for the whole walk: whichever consumable runs out first.
    pub fn budget(&self) -> f64 {
        self.usable_o2().min(self.usable_water() / WATER_PER_O2)
    }
    /// Work time at the destination in effort-hours (never negative).
    pub fn work(&self) -> f64 {
        self.work_h.max(0.0)
    }
    /// Which consumable limits the walk.
    pub fn limiting(&self) -> Limiting {
        if self.usable_water() / WATER_PER_O2 < self.usable_o2() {
            Limiting::Water
        } else {
            Limiting::O2
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Limiting {
    O2,
    Water,
}

/// One leg of the walk between two points.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Leg {
    pub km: f64,
    /// Signed slope in degrees (positive = uphill in walking direction).
    pub slope_deg: f64,
    pub hours: f64,
    pub effort_h: f64,
    pub known: bool,
}

/// Tobler's hiking function normalised so flat ground = 1.0 (Earth formula, used as a first guess).
pub fn slope_factor(slope: f64) -> f64 {
    (-3.5 * ((slope + 0.05).abs() - 0.05)).exp()
}

/// Effort multiplier on a slope (inverse of the speed factor, never below 0.8 on gentle descents).
pub fn effort_factor(slope: f64) -> f64 {
    (1.0 / slope_factor(slope)).max(0.8)
}

/// Leg between two points; missing elevation is costed as a steep climb (fail safe).
pub fn leg(world: World, a: &Waypoint, b: &Waypoint, p: &EvaParams) -> Leg {
    let km = distance_km(world, a.ll(), b.ll());
    let (slope, known) = match (a.elev, b.elev) {
        (Some(ea), Some(eb)) if km > 0.0 => ((eb - ea) / (km * 1000.0), true),
        (Some(_), Some(_)) => (0.0, true),
        _ => (p.unknown_slope.abs(), false),
    };
    let hours = km / (p.speed_kmh * slope_factor(slope));
    Leg {
        km,
        slope_deg: slope.atan().to_degrees(),
        hours,
        effort_h: hours * effort_factor(slope),
        known,
    }
}

/// State at a waypoint while walking out (for the helmet playback).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Tick {
    pub idx: usize,
    /// Hours walked since leaving base.
    pub t_h: f64,
    pub km: f64,
    /// Remaining fraction of the usable O₂ / water (0–1, can go negative).
    pub o2_left: f64,
    pub water_left: f64,
    /// Hours it takes to walk straight home from here.
    pub home_h: f64,
    /// Effort-hours left after walking home from here (negative = cannot make it).
    pub margin_h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteEval {
    pub out_km: f64,
    pub out_h: f64,
    pub back_km: f64,
    pub back_h: f64,
    /// Hours out + work at the destination + back.
    pub total_h: f64,
    /// Hours of work at the destination (included in total_h / total_effort_h).
    #[serde(default)]
    pub work_h: f64,
    /// Effort-hours used out, at the destination and back.
    pub total_effort_h: f64,
    /// Effort-hours available (the smaller of O₂ and water after reserves).
    pub usable_h: f64,
    pub usable_o2_h: f64,
    pub usable_water_h: f64,
    pub limiting: Limiting,
    /// Radius of the flat-ground return limit around the base, km.
    pub limit_km: f64,
    pub max_slope_deg: f64,
    /// Legs without elevation on both ends (costed as a steep climb).
    pub unknown_segments: usize,
    pub ok: bool,
    /// First waypoint index from which returning straight to base no longer fits the budget.
    pub point_of_no_return: Option<usize>,
    pub legs: Vec<Leg>,
    pub ticks: Vec<Tick>,
}

pub fn evaluate_route(world: World, pts: &[Waypoint], p: EvaParams) -> RouteEval {
    let budget = p.budget();
    let work = p.work();
    let limit_km = p.speed_kmh * budget / 2.0;
    let (mut out_km, mut out_h, mut out_e, mut max_slope, mut unknown) =
        (0.0, 0.0, 0.0, 0.0_f64, 0);
    let mut pnr = None;
    let mut legs = Vec::new();
    let mut ticks = Vec::new();
    let tick = |idx: usize, t_h: f64, km: f64, e: f64, home: &Leg| {
        let used = e + home.effort_h;
        Tick {
            idx,
            t_h,
            km,
            o2_left: if p.usable_o2() > 0.0 {
                1.0 - e / p.usable_o2()
            } else {
                0.0
            },
            water_left: if p.usable_water() > 0.0 {
                1.0 - e * WATER_PER_O2 / p.usable_water()
            } else {
                0.0
            },
            home_h: home.hours,
            margin_h: budget - used - work,
        }
    };
    if let Some(first) = pts.first() {
        ticks.push(tick(0, 0.0, 0.0, 0.0, &leg(world, first, first, &p)));
    }
    for i in 1..pts.len() {
        let s = leg(world, &pts[i - 1], &pts[i], &p);
        out_km += s.km;
        out_h += s.hours;
        out_e += s.effort_h;
        if !s.known {
            unknown += 1;
        } else {
            max_slope = max_slope.max(s.slope_deg.abs());
        }
        legs.push(s);
        let home = leg(world, &pts[i], &pts[0], &p);
        if pnr.is_none() && out_e + work + home.effort_h > budget {
            pnr = Some(i);
        }
        ticks.push(tick(i, out_h, out_km, out_e, &home));
    }
    let back = if pts.len() > 1 {
        leg(world, &pts[pts.len() - 1], &pts[0], &p)
    } else {
        Leg {
            km: 0.0,
            slope_deg: 0.0,
            hours: 0.0,
            effort_h: 0.0,
            known: true,
        }
    };
    let total_effort_h = out_e + work + back.effort_h;
    RouteEval {
        out_km,
        out_h,
        back_km: back.km,
        back_h: back.hours,
        total_h: out_h + work + back.hours,
        work_h: work,
        total_effort_h,
        usable_h: budget,
        usable_o2_h: p.usable_o2(),
        usable_water_h: p.usable_water(),
        limiting: p.limiting(),
        limit_km,
        max_slope_deg: max_slope,
        unknown_segments: unknown,
        ok: total_effort_h <= budget,
        point_of_no_return: pnr,
        legs,
        ticks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p() -> EvaParams {
        // Water budget large so O₂ limits, minimum reserve 0 so the arithmetic stays simple.
        EvaParams {
            water_h: 100.0,
            min_reserve_h: 0.0,
            ..EvaParams::new(2.0, 8.0, 0.2)
        }
    }
    fn wp(lat: f64, lon: f64, elev: Option<f64>) -> Waypoint {
        Waypoint { lat, lon, elev }
    }

    #[test]
    fn flat_factor_is_one_and_uphill_is_slower() {
        assert!((slope_factor(0.0) - 1.0).abs() < 1e-12);
        assert!(slope_factor(0.2) < slope_factor(0.0));
        assert!(slope_factor(-0.05) > 1.0);
        assert!(effort_factor(0.2) > 1.5 && effort_factor(-0.05) >= 0.8);
    }

    #[test]
    fn out_and_back_on_flat_ground() {
        // ~1 km east of the base on Mars and back.
        let dlon = (1.0 / 3389.5_f64).to_degrees();
        let r = evaluate_route(
            World::Mars,
            &[wp(0.0, 0.0, Some(0.0)), wp(0.0, dlon, Some(0.0))],
            p(),
        );
        assert!((r.out_km - 1.0).abs() < 1e-6 && (r.back_km - 1.0).abs() < 1e-6);
        assert!((r.total_h - 1.0).abs() < 1e-6 && (r.total_effort_h - 1.0).abs() < 1e-6);
        assert!(r.ok && r.point_of_no_return.is_none());
        assert!((r.usable_h - 6.4).abs() < 1e-12 && (r.limit_km - 6.4).abs() < 1e-12);
        assert_eq!(r.limiting, Limiting::O2);
        assert_eq!(r.ticks.len(), 2);
        assert!((r.work_h - 0.0).abs() < 1e-12);
        assert!((r.ticks[1].o2_left - (1.0 - 0.5 / 6.4)).abs() < 1e-9);
    }

    #[test]
    fn work_at_destination_counts_between_out_and_back() {
        // 3.2 km out + 3.2 km back on flat ground = 3.2 h ≤ 6.4 h; with 3.5 h of work it no longer fits.
        let deg = (3.2 / 3389.5_f64).to_degrees();
        let pts = [wp(0.0, 0.0, Some(0.0)), wp(0.0, deg, Some(0.0))];
        let base = evaluate_route(World::Mars, &pts, p());
        assert!(base.ok && base.point_of_no_return.is_none());
        let busy = EvaParams { work_h: 3.5, ..p() };
        let r = evaluate_route(World::Mars, &pts, busy);
        assert!((r.total_effort_h - (base.total_effort_h + 3.5)).abs() < 1e-9);
        assert!((r.total_h - (base.total_h + 3.5)).abs() < 1e-9);
        assert!((r.usable_h - base.usable_h).abs() < 1e-12);
        assert!(!r.ok);
        assert_eq!(r.point_of_no_return, Some(1));
        assert!((r.ticks[1].margin_h - (base.ticks[1].margin_h - 3.5)).abs() < 1e-9);
    }

    #[test]
    fn long_route_reports_point_of_no_return() {
        let deg = |km: f64| (km / 3389.5_f64).to_degrees();
        let pts = [
            wp(0.0, 0.0, Some(0.0)),
            wp(0.0, deg(3.0), Some(0.0)),
            wp(0.0, deg(6.0), Some(0.0)),
            wp(0.0, deg(9.0), Some(0.0)),
        ];
        let r = evaluate_route(World::Mars, &pts, p());
        assert!(!r.ok);
        // WP2: 6 km out + 6 km back = 6 h ≤ 6.4 h. WP3: 9 + 9 km = 9 h > 6.4 h.
        assert_eq!(r.point_of_no_return, Some(3));
        assert!(r.ticks[2].margin_h > 0.0 && r.ticks[3].margin_h < 0.0);
    }

    #[test]
    fn missing_elevation_is_costed_as_a_climb() {
        let deg = |km: f64| (km / 3389.5_f64).to_degrees();
        let known = evaluate_route(
            World::Mars,
            &[wp(0.0, 0.0, Some(0.0)), wp(0.0, deg(2.0), Some(0.0))],
            p(),
        );
        let unknown = evaluate_route(
            World::Mars,
            &[wp(0.0, 0.0, None), wp(0.0, deg(2.0), None)],
            p(),
        );
        assert_eq!(unknown.unknown_segments, 1);
        assert!(unknown.total_effort_h > known.total_effort_h * 2.0);
    }

    #[test]
    fn cooling_water_can_limit_before_o2() {
        let q = EvaParams {
            water_h: 7.0,
            ..EvaParams::new(2.0, 8.0, 0.2)
        };
        assert_eq!(q.limiting(), Limiting::Water);
        assert!((q.budget() - 5.6 / WATER_PER_O2).abs() < 1e-9);
    }

    #[test]
    fn reserve_is_at_least_thirty_minutes() {
        let q = EvaParams::new(2.0, 2.0, 0.1);
        assert!((q.usable_o2() - 1.5).abs() < 1e-12);
    }

    #[test]
    fn steep_climb_takes_longer() {
        let dlon = (1.0 / 6371.0_f64).to_degrees();
        let flat = evaluate_route(
            World::Earth,
            &[
                wp(43.0, 142.0, Some(0.0)),
                wp(43.0, 142.0 + dlon, Some(0.0)),
            ],
            p(),
        );
        let steep = evaluate_route(
            World::Earth,
            &[
                wp(43.0, 142.0, Some(0.0)),
                wp(43.0, 142.0 + dlon, Some(200.0)),
            ],
            p(),
        );
        assert!(steep.out_h > flat.out_h && steep.out_e_gt(&flat));
        assert!(steep.max_slope_deg > 10.0);
    }

    impl RouteEval {
        fn out_e_gt(&self, o: &RouteEval) -> bool {
            self.total_effort_h > o.total_effort_h
        }
    }
}
