//! wasm-bindgen surface of analog-core. Everything goes in and out as JSON strings so the
//! TypeScript side (web/src/core.ts) owns the types and no extra glue crates are needed.

use analog_core::{
    conditions, data, eva, footing, grid, radiation, rehearsal, route, scoring, traverse, weather,
    world,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("serialize")
}
fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Static datasets and constants in one call: { worlds, earthSites, bodies, missions, profiles, dims }.
#[wasm_bindgen(js_name = bootstrap)]
pub fn bootstrap() -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Boot<'a> {
        worlds: Vec<world::WorldInfo>,
        earth_sites: &'a [data::EarthSite],
        bodies: &'a [data::Body],
        missions: &'a data::Missions,
        profiles: Vec<scoring::Profile>,
        dims: Vec<[&'static str; 2]>,
    }
    json(&Boot {
        worlds: world::World::ALL.iter().map(|w| w.info()).collect(),
        earth_sites: data::earth_sites(),
        bodies: data::bodies(),
        missions: data::missions(),
        profiles: scoring::profiles(),
        dims: scoring::DIMS.iter().map(|(k, l)| [*k, *l]).collect(),
    })
}

/// Ranking of every Earth site for a profile id (or a weights JSON object).
#[wasm_bindgen(js_name = rankAll)]
pub fn rank_all(profile_or_weights: &str) -> Result<String, JsError> {
    let w = if profile_or_weights.trim_start().starts_with('{') {
        serde_json::from_str(profile_or_weights).map_err(err)?
    } else {
        scoring::profile(profile_or_weights).w
    };
    Ok(json(&scoring::rank_all(&w)))
}

/// Evaluate an EVA route. `points`: [{lat, lon|lng, elev?}], `params`: {speed_kmh, o2_h, reserve}.
#[wasm_bindgen(js_name = evaluateRoute)]
pub fn evaluate_route(world: &str, points: &str, params: &str) -> Result<String, JsError> {
    let w: world::World =
        serde_json::from_value(serde_json::Value::String(world.into())).map_err(err)?;
    let pts: Vec<route::Waypoint> = serde_json::from_str(points).map_err(err)?;
    let p: route::EvaParams = serde_json::from_str(params).map_err(err)?;
    Ok(json(&route::evaluate_route(w, &pts, p)))
}

/// Great-circle distance in km on a body.
#[wasm_bindgen(js_name = distanceKm)]
pub fn distance_km(
    world: &str,
    lat1: f64,
    lon1: f64,
    lat2: f64,
    lon2: f64,
) -> Result<f64, JsError> {
    let w: world::World =
        serde_json::from_value(serde_json::Value::String(world.into())).map_err(err)?;
    Ok(world::distance_km(
        w,
        world::LatLon {
            lat: lat1,
            lon: lon1,
        },
        world::LatLon {
            lat: lat2,
            lon: lon2,
        },
    ))
}

// ---- WALKBACK datasets kept inside the module so large JSON is parsed once ----

use std::cell::RefCell;
use std::collections::HashMap;

thread_local! {
    static GRIDS: RefCell<HashMap<String, grid::Grid>> = RefCell::new(HashMap::new());
    static TRAVERSE: RefCell<Option<traverse::Traverse>> = const { RefCell::new(None) };
    static EVAS: RefCell<Option<eva::EvaStats>> = const { RefCell::new(None) };
    static WEATHER: RefCell<Option<weather::Weather>> = const { RefCell::new(None) };
    /// The last plan_route search: settled cells in order and their costs (search animation).
    static TRACE: RefCell<(Vec<u32>, Vec<f32>, Vec<u8>)> = const { RefCell::new((Vec::new(), Vec::new(), Vec::new())) };
}

fn parse_world(world: &str) -> Result<world::World, JsError> {
    serde_json::from_value(serde_json::Value::String(world.into())).map_err(err)
}

/// Store an elevation grid under a name (`{lat0, lon0, dlat, dlon, rows, cols, z}`).
#[wasm_bindgen(js_name = setGrid)]
pub fn set_grid(name: &str, grid_json: &str) -> Result<(), JsError> {
    let g: grid::Grid = serde_json::from_str(grid_json).map_err(err)?;
    if g.z.len() != g.rows * g.cols || g.rows < 2 || g.cols < 2 {
        return Err(JsError::new("grid size does not match rows × cols"));
    }
    GRIDS.with(|m| m.borrow_mut().insert(name.to_string(), g));
    Ok(())
}

fn with_grid<T>(name: &str, f: impl FnOnce(&grid::Grid) -> T) -> Result<T, JsError> {
    GRIDS.with(|m| {
        m.borrow()
            .get(name)
            .map(f)
            .ok_or_else(|| JsError::new(&format!("grid {name} not loaded")))
    })
}

/// Footing for a stored grid (`{rows, cols, ti, dci}`, jezero_footing.json), turned into the factor
/// η per cell by analog-core footing.rs; an empty string removes it (footing not counted).
#[wasm_bindgen(js_name = setFooting)]
pub fn set_footing(name: &str, footing_json: &str) -> Result<(), JsError> {
    let etas = if footing_json.is_empty() {
        Vec::new()
    } else {
        let f: footing::Footing = serde_json::from_str(footing_json).map_err(err)?;
        f.etas()
    };
    GRIDS.with(|m| {
        let mut m = m.borrow_mut();
        let g = m
            .get_mut(name)
            .ok_or_else(|| JsError::new(&format!("grid {name} not loaded")))?;
        if !etas.is_empty() && etas.len() != g.rows * g.cols {
            return Err(JsError::new("footing size does not match the grid"));
        }
        g.foot = etas;
        Ok(())
    })
}

/// Cells reported blocked (an obstacle seen on the way), as row-major indices `[i, …]`; every route
/// search on this grid steps around them. `"[]"` clears them.
#[wasm_bindgen(js_name = setBlocked)]
pub fn set_blocked(name: &str, cells_json: &str) -> Result<(), JsError> {
    let cells: Vec<usize> = serde_json::from_str(cells_json).map_err(err)?;
    GRIDS.with(|m| {
        let mut m = m.borrow_mut();
        let g = m
            .get_mut(name)
            .ok_or_else(|| JsError::new(&format!("grid {name} not loaded")))?;
        g.blocked = if cells.is_empty() {
            Vec::new()
        } else {
            let mut b = vec![false; g.rows * g.cols];
            for i in cells {
                if let Some(x) = b.get_mut(i) {
                    *x = true;
                }
            }
            b
        };
        Ok(())
    })
}

/// Footing factor η at `[[lat, lon], …]` (null outside the grid or when not set).
#[wasm_bindgen(js_name = sampleFooting)]
pub fn sample_footing(name: &str, latlons: &str) -> Result<String, JsError> {
    let pts: Vec<[f64; 2]> = serde_json::from_str(latlons).map_err(err)?;
    with_grid(name, |g| {
        json(
            &pts.iter()
                .map(|p| g.foot_at(p[0], p[1]))
                .collect::<Vec<_>>(),
        )
    })
}

/// Footing per cell for the map layer: 0 = firm (η at its firm value) … 255 = loose (η at its
/// loose value or more); empty when the grid has no footing.
#[wasm_bindgen(js_name = footingBadness)]
pub fn footing_badness(name: &str) -> Result<Vec<u8>, JsError> {
    let span = footing::ETA_LOOSE - footing::ETA_FIRM;
    with_grid(name, |g| {
        g.foot
            .iter()
            .map(|&e| {
                ((f64::from(e) - footing::ETA_FIRM) / span * 255.0)
                    .round()
                    .clamp(0.0, 255.0) as u8
            })
            .collect()
    })
}

/// Radiation dose for `hours` on the surface (Curiosity RAD rate, NASA limits): {dose_msv,
/// career_share, hours_to_career_limit}.
#[wasm_bindgen(js_name = radiationExposure)]
pub fn radiation_exposure(hours: f64) -> String {
    json(&radiation::exposure(hours))
}

/// Radiation constants for the evidence card and the helmet display.
#[wasm_bindgen(js_name = radiationModel)]
pub fn radiation_model() -> String {
    json(&serde_json::json!({
        "dose_eq_msv_per_day": radiation::DOSE_EQ_MSV_PER_DAY, "dose_eq_sigma": radiation::DOSE_EQ_SIGMA,
        "absorbed_mgy_per_day": radiation::ABSORBED_MGY_PER_DAY,
        "career_limit_msv": radiation::CAREER_LIMIT_MSV, "spe_limit_msv": radiation::SPE_LIMIT_MSV,
    }))
}

/// Plan a walk from the base to a destination on a stored grid (grid.rs plan_route): only cells
/// of the walk-home area, weighted cost; `weights` = {time, slope, footing, margin} (missing = 0,
/// time 1). Returns {path: [[lat, lon], …], status, goal_ratio}.
#[wasm_bindgen(js_name = planRoute)]
#[allow(clippy::too_many_arguments)]
pub fn plan_route(
    world: &str,
    name: &str,
    lat1: f64,
    lon1: f64,
    lat2: f64,
    lon2: f64,
    params: &str,
    max_slope_deg: f64,
    weights: &str,
) -> Result<String, JsError> {
    let w = parse_world(world)?;
    let p: route::EvaParams = serde_json::from_str(params).map_err(err)?;
    let wt: grid::RouteWeights = if weights.is_empty() {
        grid::RouteWeights::default()
    } else {
        serde_json::from_str(weights).map_err(err)?
    };
    with_grid(name, |g| {
        let mut r = grid::plan_route(w, g, (lat1, lon1), (lat2, lon2), &p, max_slope_deg, &wt);
        let out = json(&r);
        TRACE.with(|t| {
            *t.borrow_mut() = (
                std::mem::take(&mut r.settled),
                std::mem::take(&mut r.settled_cost),
                std::mem::take(&mut r.settled_side),
            )
        });
        out
    })
}

/// Cells (row-major indices) the last planRoute search settled, in order.
#[wasm_bindgen(js_name = planTraceOrder)]
pub fn plan_trace_order() -> Vec<u32> {
    TRACE.with(|t| t.borrow().0.clone())
}

/// Side of each settled cell: 0 = searched from the base, 1 = from the destination.
#[wasm_bindgen(js_name = planTraceSide)]
pub fn plan_trace_side() -> Vec<u8> {
    TRACE.with(|t| t.borrow().2.clone())
}

/// Weighted cost of each settled cell, in the same order.
#[wasm_bindgen(js_name = planTraceCost)]
pub fn plan_trace_cost() -> Vec<f32> {
    TRACE.with(|t| t.borrow().1.clone())
}

/// Store the Jezero hourly weather (jezero_weather.json, Perseverance MEDA).
#[wasm_bindgen(js_name = setWeather)]
pub fn set_weather(json_str: &str) -> Result<(), JsError> {
    let w: weather::Weather = serde_json::from_str(json_str).map_err(err)?;
    WEATHER.with(|x| *x.borrow_mut() = Some(w));
    Ok(())
}

/// Cooling-water factor for a walk from local solar hour `start_h` lasting `hours`, plus the air
/// temperature and pressure at the start: {water_factor, temp_k, pressure_pa}; factor 1 without data.
#[wasm_bindgen(js_name = weatherWalk)]
pub fn weather_walk(start_h: f64, hours: f64) -> String {
    WEATHER.with(|x| {
        let w = x.borrow();
        json(&match w.as_ref() {
            Some(w) => serde_json::json!({
                "water_factor": w.mean_water_factor(start_h, hours),
                "temp_k": w.temp_at(start_h), "pressure_pa": w.pressure_at(start_h),
            }),
            None => serde_json::json!({ "water_factor": 1.0, "temp_k": null, "pressure_pa": null }),
        })
    })
}

/// Weather model constants for the evidence text.
#[wasm_bindgen(js_name = weatherModel)]
pub fn weather_model() -> String {
    json(&serde_json::json!({
        "metabolic_w": weather::METABOLIC_W, "t_ref_k": weather::T_REF_K, "t_skin_k": weather::T_SKIN_K,
        "leak_w_per_k": weather::LEAK_W_PER_K, "sol_hours": weather::SOL_HOURS,
    }))
}

/// Footing constants and their sources, for the evidence card (all numbers from footing.rs).
#[wasm_bindgen(js_name = footingModel)]
pub fn footing_model() -> String {
    json(&serde_json::json!({
        "ti_loose": footing::TI_LOOSE, "ti_firm": footing::TI_FIRM,
        "eta_loose": footing::ETA_LOOSE, "eta_firm": footing::ETA_FIRM,
        "dci_dusty": footing::DCI_DUSTY, "dust_extra": footing::DUST_EXTRA,
    }))
}

/// Evaluate a route on a stored grid with its surface conditions (footing where set): same result
/// as evaluateRoute when the grid has none.
#[wasm_bindgen(js_name = evaluateRouteOn)]
pub fn evaluate_route_on(
    world: &str,
    name: &str,
    points: &str,
    params: &str,
) -> Result<String, JsError> {
    let w = parse_world(world)?;
    let pts: Vec<route::Waypoint> = serde_json::from_str(points).map_err(err)?;
    let p: route::EvaParams = serde_json::from_str(params).map_err(err)?;
    // "retrace": walk home along the route reversed instead of straight (a field next to EvaParams).
    let retrace = serde_json::from_str::<serde_json::Value>(params)
        .ok()
        .and_then(|v| v.get("retrace").and_then(|x| x.as_bool()))
        .unwrap_or(false);
    let surface = GRIDS.with(|m| {
        m.borrow()
            .get(name)
            .filter(|g| !g.foot.is_empty())
            .map(|g| {
                let base = pts.first().map(|b| (b.lat, b.lon));
                conditions::Surface {
                    foot: pts
                        .iter()
                        .map(|q| g.foot_at(q.lat, q.lon).unwrap_or(1.0))
                        .collect(),
                    home_foot: pts
                        .iter()
                        .map(|q| base.map_or(1.0, |b| g.foot_line((q.lat, q.lon), b)))
                        .collect(),
                    retrace,
                }
            })
    });
    Ok(json(&conditions::evaluate(
        w,
        &pts,
        p,
        &surface.unwrap_or(conditions::Surface {
            retrace,
            ..Default::default()
        }),
    )))
}

/// Bilinear elevations for `[[lat, lon], …]` from a stored grid (null outside or in holes).
#[wasm_bindgen(js_name = sampleGrid)]
pub fn sample_grid(name: &str, latlons: &str) -> Result<String, JsError> {
    let pts: Vec<[f64; 2]> = serde_json::from_str(latlons).map_err(err)?;
    with_grid(name, |g| {
        json(&pts.iter().map(|p| g.sample(p[0], p[1])).collect::<Vec<_>>())
    })
}

/// Walk-home area around a base on a stored grid.
#[wasm_bindgen(js_name = reach)]
pub fn reach(
    world: &str,
    name: &str,
    lat: f64,
    lon: f64,
    params: &str,
    max_slope_deg: f64,
) -> Result<String, JsError> {
    let w = parse_world(world)?;
    let p: route::EvaParams = serde_json::from_str(params).map_err(err)?;
    with_grid(name, |g| {
        json(&grid::reach(w, g, lat, lon, &p, max_slope_deg))
    })
}

/// Least-effort walking path between two points on a stored grid: `[[lat, lon], …]` or `null`.
#[wasm_bindgen(js_name = easyPath)]
#[allow(clippy::too_many_arguments)]
pub fn easy_path(
    world: &str,
    name: &str,
    lat1: f64,
    lon1: f64,
    lat2: f64,
    lon2: f64,
    params: &str,
    max_slope_deg: f64,
) -> Result<String, JsError> {
    let w = parse_world(world)?;
    let p: route::EvaParams = serde_json::from_str(params).map_err(err)?;
    with_grid(name, |g| {
        json(&grid::easy_path(
            w,
            g,
            (lat1, lon1),
            (lat2, lon2),
            &p,
            max_slope_deg,
        ))
    })
}

/// Store the simplified Perseverance traverse (`{drives: [{sol, c: [[lon, lat, z], …]}]}`).
#[wasm_bindgen(js_name = setTraverse)]
pub fn set_traverse(traverse_json: &str) -> Result<String, JsError> {
    let t: traverse::Traverse = serde_json::from_str(traverse_json).map_err(err)?;
    let s = traverse::stats(&t, 25.0);
    TRAVERSE.with(|c| *c.borrow_mut() = Some(t));
    Ok(json(&s))
}

/// #11 A: summary of a recorded walk (`[{lat, lon, elev, t}]`, elevation from a DEM) on Earth.
#[wasm_bindgen(js_name = walkSummary)]
pub fn walk_summary(points: &str) -> Result<String, JsError> {
    let pts: Vec<analog_core::walk::TimedPoint> = serde_json::from_str(points).map_err(err)?;
    Ok(json(&analog_core::walk::summary(world::World::Earth, &pts)))
}

/// #11 A: lay a walk recorded on Earth onto Mars from `base` (same east/north metres).
#[wasm_bindgen(js_name = transplantWalk)]
pub fn transplant_walk(points: &str, base_lat: f64, base_lon: f64) -> Result<String, JsError> {
    let pts: Vec<analog_core::walk::TimedPoint> = serde_json::from_str(points).map_err(err)?;
    let base = world::LatLon {
        lat: base_lat,
        lon: base_lon,
    };
    Ok(json(&analog_core::walk::transplant(
        world::World::Earth,
        &pts,
        world::World::Mars,
        base,
    )))
}

/// Crewed-rover breakdown check along the stored traverse: from each point, could the crew walk
/// back to the base (grid `name`, same EvaParams as the walk-home area)?
#[wasm_bindgen(js_name = roverWalkback)]
pub fn rover_walkback(
    world: &str,
    name: &str,
    lat: f64,
    lon: f64,
    params: &str,
    max_slope_deg: f64,
) -> Result<String, JsError> {
    let w = parse_world(world)?;
    let p: route::EvaParams = serde_json::from_str(params).map_err(err)?;
    with_grid(name, |g| {
        let home = grid::home_ratio(w, g, lat, lon, &p, max_slope_deg);
        TRAVERSE.with(|c| {
            c.borrow()
                .as_ref()
                .map(|t| json(&traverse::walkback(t, g, &home, p.budget())))
                .unwrap_or_else(|| "null".into())
        })
    })
}

/// Crewed-rover breakdown check on traverse rows read with SQL (`[{drive, seq, sol, lat, lon,
/// elev_m, km}]` in drive/seq order, from the rover_traverse parquet). Same calculation as
/// `roverWalkback`; only where the path comes from differs.
#[wasm_bindgen(js_name = roverWalkbackFrom)]
pub fn rover_walkback_from(
    world: &str,
    name: &str,
    lat: f64,
    lon: f64,
    params: &str,
    max_slope_deg: f64,
    rows: &str,
) -> Result<String, JsError> {
    let w = parse_world(world)?;
    let p: route::EvaParams = serde_json::from_str(params).map_err(err)?;
    let rows: Vec<traverse::TraversePoint> = serde_json::from_str(rows).map_err(err)?;
    let t = traverse::from_points(&rows);
    with_grid(name, |g| {
        let home = grid::home_ratio(w, g, lat, lon, &p, max_slope_deg);
        json(&traverse::walkback(&t, g, &home, p.budget()))
    })
}

/// Compare densified route points (with elevation) with the stored traverse.
#[wasm_bindgen(js_name = roverCheck)]
pub fn rover_check(points: &str, near_m: f64) -> Result<String, JsError> {
    let pts: Vec<route::Waypoint> = serde_json::from_str(points).map_err(err)?;
    TRAVERSE.with(|c| {
        c.borrow()
            .as_ref()
            .map(|t| json(&traverse::check(t, &pts, near_m)))
            .ok_or_else(|| JsError::new("traverse not loaded"))
    })
}

/// Parse the data.nasa.gov EVA CSV, keep its statistics and return them.
#[wasm_bindgen(js_name = setEvaCsv)]
pub fn set_eva_csv(csv: &str) -> String {
    let s = eva::stats(&eva::parse(csv));
    let out = json(&s);
    EVAS.with(|c| *c.borrow_mut() = Some(s));
    out
}

/// Share (0–1) of real EVAs longer than `hours`; -1 if the CSV is not loaded.
#[wasm_bindgen(js_name = evaLongerShare)]
pub fn eva_longer_share(hours: f64) -> f64 {
    EVAS.with(|c| {
        c.borrow()
            .as_ref()
            .map(|s| eva::longer_share(s, hours))
            .unwrap_or(-1.0)
    })
}

/// Find where the same walk can be rehearsed on a stored Earth grid.
/// `points`: densified Mars route with elevation. Returns the best `top` matches.
#[wasm_bindgen(js_name = rehearse)]
pub fn rehearse(
    from_world: &str,
    points: &str,
    grid_name: &str,
    stride: usize,
    rot_step_deg: f64,
    top: usize,
) -> Result<String, JsError> {
    let w = parse_world(from_world)?;
    let pts: Vec<route::Waypoint> = serde_json::from_str(points).map_err(err)?;
    let prof = rehearsal::profile(w, &pts);
    with_grid(grid_name, |g| {
        json(&rehearsal::search(
            g,
            &prof,
            stride,
            rot_step_deg,
            top,
            400.0,
        ))
    })
}

/// Every Hokkaido site ranked for one Moon/Mars target and rehearsal test (profile id).
#[wasm_bindgen(js_name = rankSites)]
pub fn rank_sites(body_id: &str, profile_id: &str) -> String {
    json(&analog_core::target::rank_sites(body_id, profile_id))
}

/// What Hokkaido cannot reproduce for this target, with numbers; critical-for-test first.
#[wasm_bindgen(js_name = gaps)]
pub fn gaps(earth_id: &str, body_id: &str, test: &str) -> String {
    json(&analog_core::target::gaps_by_id(earth_id, body_id, test))
}

// ---- #10 whole-Hokkaido scan ----

thread_local! {
    static SCAN: RefCell<Option<analog_core::scan::Scan>> = const { RefCell::new(None) };
}

fn find_body(id: &str) -> Result<&'static data::Body, JsError> {
    data::bodies()
        .iter()
        .find(|b| b.id == id)
        .ok_or_else(|| JsError::new(&format!("unknown target {id}")))
}

fn with_scan<T>(f: impl FnOnce(&analog_core::scan::Scan) -> T) -> Result<T, JsError> {
    SCAN.with(|s| {
        s.borrow()
            .as_ref()
            .map(f)
            .ok_or_else(|| JsError::new("scan not loaded"))
    })
}

/// Load the scan grid (web/public/data/scan/hokkaido-*.json). Returns its meta JSON.
#[wasm_bindgen(js_name = setScan)]
pub fn set_scan(json_str: &str) -> Result<String, JsError> {
    let s = analog_core::scan::Scan::from_json(json_str).map_err(err)?;
    let meta = json(&s.meta());
    SCAN.with(|x| *x.borrow_mut() = Some(s));
    Ok(meta)
}

/// Grid index (`row * cols + col`) of every land cell, in cell order.
#[wasm_bindgen(js_name = scanCells)]
pub fn scan_cells() -> Result<Vec<u32>, JsError> {
    with_scan(|s| s.cells.i.clone())
}

/// Match (0–1) of every land cell for a target and test, in cell order.
#[wasm_bindgen(js_name = scanScores)]
pub fn scan_scores(body_id: &str, profile_id: &str) -> Result<Vec<f32>, JsError> {
    let b = find_body(body_id)?;
    with_scan(|s| analog_core::scan::scores(s, b, profile_id))
}

/// Best cells at least `min_km` apart, plus how each known site's cell ranks.
#[wasm_bindgen(js_name = scanTop)]
pub fn scan_top(scores: &[f32], n: usize, min_km: f64) -> Result<String, JsError> {
    with_scan(|s| {
        if scores.len() != s.len() {
            return Err(JsError::new("scores do not match the loaded scan"));
        }
        #[derive(Serialize)]
        struct Out {
            top: Vec<analog_core::scan::Candidate>,
            sites: Vec<analog_core::scan::SiteCheck>,
        }
        Ok(json(&Out {
            top: analog_core::scan::top(s, scores, n, min_km),
            sites: analog_core::scan::site_checks(s, scores),
        }))
    })?
}

/// One cell in full: terrain, height-corrected climate and the 5-axis score.
#[wasm_bindgen(js_name = scanCell)]
pub fn scan_cell(k: usize, body_id: &str, profile_id: &str) -> Result<String, JsError> {
    let b = find_body(body_id)?;
    with_scan(|s| json(&analog_core::scan::detail(s, k, b, profile_id)))
}

/// Land cell index at a point, or -1.
#[wasm_bindgen(js_name = scanCellAt)]
pub fn scan_cell_at(lat: f64, lon: f64) -> Result<i32, JsError> {
    with_scan(|s| s.cell_at(lat, lon).map_or(-1, |k| k as i32))
}

/// What Hokkaido cannot reproduce, for a scan cell instead of a known site.
#[wasm_bindgen(js_name = scanGaps)]
pub fn scan_gaps(k: usize, body_id: &str, test: &str) -> Result<String, JsError> {
    let b = find_body(body_id)?;
    with_scan(|s| {
        if k >= s.len() {
            return json(&Vec::<analog_core::target::Gap>::new());
        }
        json(&analog_core::target::gaps(&s.site(k), b, test))
    })
}

/// Every land cell as columns (for the duckdb `cells` table in web/src/db.ts): terrain, MODIS
/// shares as fractions (null = no data), height-corrected NASA POWER climate and the land-cover
/// screen reason (null = open ground). Same units as `scanCell`.
#[wasm_bindgen(js_name = scanColumns)]
pub fn scan_columns() -> Result<String, JsError> {
    #[derive(Serialize, Default)]
    struct Cols {
        k: Vec<usize>,
        lat: Vec<f64>,
        lon: Vec<f64>,
        elev_m: Vec<f64>,
        relief_m: Vec<f64>,
        slope_deg: Vec<f64>,
        slope_p90_deg: Vec<f64>,
        shadow: Vec<f64>,
        ndvi: Vec<Option<f64>>,
        urban: Vec<Option<f64>>,
        crop: Vec<Option<f64>>,
        forest: Vec<Option<f64>>,
        water: Vec<Option<f64>>,
        barren: Vec<Option<f64>>,
        tmin_jan_c: Vec<Option<f64>>,
        tmax_aug_c: Vec<Option<f64>>,
        precip_mm: Vec<Option<f64>>,
        screened: Vec<Option<String>>,
    }
    fn opt(v: &[f64], k: usize, div: f64) -> Option<f64> {
        v.get(k).copied().filter(|x| *x >= 0.0).map(|x| x / div)
    }
    with_scan(|s| {
        let c = &s.cells;
        let mut o = Cols::default();
        for k in 0..s.len() {
            let (lat, lon) = s.latlon(k);
            let cl = s.climate(k);
            o.k.push(k);
            o.lat.push(lat);
            o.lon.push(lon);
            o.elev_m.push(c.elev[k]);
            o.relief_m.push(c.relief[k]);
            o.slope_deg.push(c.slope[k] / 10.0);
            o.slope_p90_deg.push(c.p90[k] / 10.0);
            o.shadow.push(c.shadow[k] / 1000.0);
            o.ndvi.push(opt(&c.ndvi, k, 1000.0));
            o.urban.push(opt(&c.urban, k, 100.0));
            o.crop.push(opt(&c.crop, k, 100.0));
            o.forest.push(opt(&c.forest, k, 100.0));
            o.water.push(opt(&c.water, k, 100.0));
            o.barren.push(opt(&c.barren, k, 100.0));
            o.tmin_jan_c.push(cl.map(|x| x.tmin[0]));
            o.tmax_aug_c.push(cl.map(|x| x.tmax[7]));
            o.precip_mm.push(cl.map(|x| x.precip));
            o.screened.push(analog_core::scan::screen_reason(s, k));
        }
        json(&o)
    })
}
