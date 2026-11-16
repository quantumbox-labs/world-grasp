//! Route evaluation with the surface conditions on top of route.rs: the same legs (distance,
//! slope, Tobler speed, effort) scaled by the footing factor (crate::footing) where it is known.
//! The walk home from each point is costed with the mean footing along its straight line.
use crate::route::{leg, EvaParams, Leg, RouteEval, Tick, Waypoint, WATER_PER_O2};
use crate::world::World;

/// Footing per route point (`foot[i]`, 1.0 = firm) and the mean footing of the straight walk
/// from point i back to the base (`home_foot[i]`). Empty slices mean "not counted".
#[derive(Debug, Clone, Default)]
pub struct Surface {
    pub foot: Vec<f64>,
    pub home_foot: Vec<f64>,
    /// Walk home along the route reversed (each step costed in the walking-back direction) instead
    /// of in a straight line.
    pub retrace: bool,
}

fn scaled(l: Leg, f: f64) -> Leg {
    Leg {
        hours: l.hours * f,
        effort_h: l.effort_h * f,
        ..l
    }
}

/// route::evaluate_route with the footing applied (identical when `s` is empty).
pub fn evaluate(world: World, pts: &[Waypoint], p: EvaParams, s: &Surface) -> RouteEval {
    let at = |v: &Vec<f64>, i: usize| v.get(i).copied().unwrap_or(1.0);
    let budget = p.budget();
    let work = p.work();
    let limit_km = p.speed_kmh * budget / 2.0;
    let (mut out_km, mut out_h, mut out_e, mut max_slope, mut unknown) =
        (0.0, 0.0, 0.0, 0.0_f64, 0);
    let mut pnr = None;
    let mut legs = Vec::new();
    let mut ticks = Vec::new();
    let tick = |idx: usize, t_h: f64, km: f64, e: f64, home: &Leg| Tick {
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
        margin_h: budget - (e + work + home.effort_h),
    };
    // Walking back along the route: the cost from each point to the base over the reversed route.
    let home_along: Vec<Leg> = if s.retrace {
        let mut acc = vec![Leg {
            km: 0.0,
            slope_deg: 0.0,
            hours: 0.0,
            effort_h: 0.0,
            known: true,
        }];
        for i in 1..pts.len() {
            let l = scaled(
                leg(world, &pts[i], &pts[i - 1], &p),
                (at(&s.foot, i) + at(&s.foot, i - 1)) / 2.0,
            );
            let a = acc[i - 1];
            acc.push(Leg {
                km: a.km + l.km,
                slope_deg: 0.0,
                hours: a.hours + l.hours,
                effort_h: a.effort_h + l.effort_h,
                known: a.known && l.known,
            });
        }
        acc
    } else {
        Vec::new()
    };
    let home_of = |i: usize| -> Leg {
        if s.retrace {
            home_along[i]
        } else {
            scaled(leg(world, &pts[i], &pts[0], &p), at(&s.home_foot, i))
        }
    };
    if let Some(first) = pts.first() {
        ticks.push(tick(0, 0.0, 0.0, 0.0, &leg(world, first, first, &p)));
    }
    for i in 1..pts.len() {
        let l = scaled(
            leg(world, &pts[i - 1], &pts[i], &p),
            (at(&s.foot, i - 1) + at(&s.foot, i)) / 2.0,
        );
        out_km += l.km;
        out_h += l.hours;
        out_e += l.effort_h;
        if !l.known {
            unknown += 1;
        } else {
            max_slope = max_slope.max(l.slope_deg.abs());
        }
        legs.push(l);
        let home = home_of(i);
        if pnr.is_none() && out_e + work + home.effort_h > budget {
            pnr = Some(i);
        }
        ticks.push(tick(i, out_h, out_km, out_e, &home));
    }
    let back = if pts.len() > 1 {
        home_of(pts.len() - 1)
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
    use crate::route::evaluate_route;

    fn wp(lat: f64, lon: f64) -> Waypoint {
        Waypoint {
            lat,
            lon,
            elev: Some(0.0),
        }
    }

    #[test]
    fn empty_surface_matches_route_rs_and_footing_scales_time() {
        let pts = [wp(18.44, 77.45), wp(18.45, 77.45), wp(18.46, 77.46)];
        let p = EvaParams::new(2.0, 8.0, 0.2);
        let a = evaluate_route(World::Mars, &pts, p);
        let b = evaluate(World::Mars, &pts, p, &Surface::default());
        assert_eq!(a, b);
        let s = Surface {
            foot: vec![1.5; 3],
            home_foot: vec![1.5; 3],
            retrace: false,
        };
        let c = evaluate(World::Mars, &pts, p, &s);
        assert!((c.total_h - a.total_h * 1.5).abs() < 1e-9);
        assert!((c.total_effort_h - a.total_effort_h * 1.5).abs() < 1e-9);
    }

    #[test]
    fn retrace_walks_home_along_the_route() {
        // An L-shaped route: back along it is longer than the straight line home.
        let pts = [wp(18.44, 77.45), wp(18.45, 77.45), wp(18.45, 77.46)];
        let p = EvaParams::new(2.0, 8.0, 0.2);
        let straight = evaluate(World::Mars, &pts, p, &Surface::default());
        let along = evaluate(
            World::Mars,
            &pts,
            p,
            &Surface {
                retrace: true,
                ..Surface::default()
            },
        );
        assert!((along.back_km - along.out_km).abs() < 1e-9);
        assert!(along.back_km > straight.back_km);
        assert!(along.total_h > straight.total_h);
        assert_eq!(along.ticks[0].home_h, 0.0);
    }
}
