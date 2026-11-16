//! Bidirectional vs one-sided plan_route on the real Jezero grid (with footing): same status and
//! the same path cost for random destinations under three weightings; settled cells and time.
//!   cargo run --release -p analog-core --example plan_compare
use analog_core::footing::Footing;
use analog_core::grid::{plan_route_with, Grid, RouteWeights};
use analog_core::route::EvaParams;
use analog_core::world::World;
use std::time::Instant;

fn main() {
    let mut g: Grid =
        serde_json::from_str(&std::fs::read_to_string("web/public/data/jezero_dem.json").unwrap())
            .unwrap();
    let f: Footing = serde_json::from_str(
        &std::fs::read_to_string("web/public/data/jezero_footing.json").unwrap(),
    )
    .unwrap();
    g.foot = f.etas();
    let p = EvaParams::new(2.0, 8.0, 0.2);
    let base = (18.4446, 77.4509);
    let weights = [
        ("fastest", RouteWeights::default()),
        (
            "shortest",
            RouteWeights {
                distance: true,
                ..RouteWeights::default()
            },
        ),
        (
            "safer",
            RouteWeights {
                time: 1.0,
                slope: 1.0,
                footing: 1.0,
                margin: 1.0,
                distance: false,
            },
        ),
    ];
    let mut seed = 12345u64;
    let mut rnd = || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((seed >> 33) as f64) / ((1u64 << 31) as f64)
    };
    let mut fails = 0;
    for (name, w) in weights {
        let (mut n, mut ok, mut s1, mut s2, mut t1, mut t2) = (0, 0, 0usize, 0usize, 0.0, 0.0);
        for _ in 0..60 {
            let to = (base.0 + (rnd() - 0.5) * 0.12, base.1 + (rnd() - 0.5) * 0.12);
            let a = Instant::now();
            let one = plan_route_with(World::Mars, &g, base, to, &p, 30.0, &w, false);
            t1 += a.elapsed().as_secs_f64();
            let b = Instant::now();
            let two = plan_route_with(World::Mars, &g, base, to, &p, 30.0, &w, true);
            t2 += b.elapsed().as_secs_f64();
            n += 1;
            if one.status != two.status {
                fails += 1;
                println!(
                    "  MISMATCH status {} vs {} at {:?}",
                    one.status, two.status, to
                );
                continue;
            }
            if one.status == "ok" {
                ok += 1;
                let rel = (one.path_cost - two.path_cost).abs() / one.path_cost.max(1e-9);
                if rel > 1e-9 {
                    fails += 1;
                    println!(
                        "  MISMATCH cost {:.6} vs {:.6} at {:?}",
                        one.path_cost, two.path_cost, to
                    );
                }
                s1 += one.settled.len();
                s2 += two.settled.len();
            }
        }
        println!(
            "{name}: {n} destinations ({ok} reachable) — cells settled one-sided {} vs bidirectional {} ({:.0} %), time {:.0} ms vs {:.0} ms total",
            s1, s2, 100.0 * s2 as f64 / s1.max(1) as f64, t1 * 1000.0, t2 * 1000.0
        );
    }
    println!("mismatches: {fails}");
}
