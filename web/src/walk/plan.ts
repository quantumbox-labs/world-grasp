// One plan → all its numbers. The WALKBACK screen and the agent tools both call this, so what a
// tool reports is exactly what the screen shows. Every number comes from the Rust core.
import type { Core, EvaParams, PlannedRoute, RouteWeights, Reach, RouteCheck, RouteEval, RoverWalkback, Waypoint, World } from '../core';
import { JEZERO, LANDING, ensureFooting, type WalkData } from './data';
import { densify, type Dense } from './geo';

export const WORLD: World = 'mars';
/** Same constant as analog-core route.rs (Gernhardt 2010): cooling water per unit of O₂ when walking hard. */
export const WATER_PER_O2 = 3.1 / 2.7;
/**
 * Steepest walkable slope, degrees, up or down: the dynamic angle of repose of Martian sand dunes,
 * where loose material avalanches — 30–31° measured with HiRISE elevation models at Gale and
 * Herschel craters, 33–34° at Nili Patera (Atwood-Stone & McEwen 2013, Geophys. Res. Lett. 40,
 * doi:10.1002/grl.50586); the lower value is used. Steeper cells are not walkable in the walk-home
 * area, the route planner and the rover check, and a drawn route with such a leg is impassable.
 * (Was 25° without a source.) No published separate limit for walking downhill was found.
 */
export const MAX_SLOPE = 30;
/** First leg of an evaluated route steeper than MAX_SLOPE (slope from the Rust legs), or null. */
export const steepLeg = (ev: RouteEval) => {
  const i = ev.legs.findIndex((l) => l.known && Math.abs(l.slope_deg) > MAX_SLOPE);
  return i < 0 ? null : i;
};

/** The sliders on the screen. reserve is in percent. */
export interface PlanParams { speed: number; o2: number; water: number; reserve: number; footing?: boolean;
  /** Departure, local solar hour at Jezero (MEDA temperatures change the cooling water); default 9. */
  start?: number;
  /** Walk home along the route reversed (true) or straight (false, default). */
  retrace?: boolean;
  /** Hours of work at the destination (O₂ / water at the nominal rate, estimate); default 0. */
  work?: number }
export const DEFAULT_START = 9;
export const DEFAULT_PARAMS: PlanParams = { speed: 2, o2: 8, water: 8, reserve: 20 };

export const evaParams = (q: PlanParams): EvaParams =>
  ({ speed_kmh: q.speed, o2_h: q.o2, water_h: q.water, reserve: q.reserve / 100, min_reserve_h: 0.5, footing: q.footing ?? true, start_h: q.start ?? DEFAULT_START, retrace: q.retrace ?? false, work_h: q.work ?? 0 });
/**
 * Surface conditions before a computation: the footing switch into the Rust core's grid, and the
 * cooling water scaled by the air temperature over the walk (Rust weather.rs; from the departure
 * hour over the oxygen time). The water budget in hours goes up when colder air means less water use.
 */
export function waterFactor(core: Core, p: EvaParams): number {
  if (p.start_h == null) return 1;
  try { return core.weatherWalk(p.start_h, p.o2_h).water_factor; } catch { return 1; }
}
const foot = (core: Core, p: EvaParams): EvaParams => {
  ensureFooting(core, p.footing ?? true);
  const f = waterFactor(core, p);
  return f === 1 ? p : { ...p, water_h: (p.water_h ?? 8) / f };
};

export function denseRoute(core: Core, data: WalkData | null, route: Waypoint[]): Dense {
  return data ? densify(core, WORLD, route, 40) : { pts: route, wp: route.map((_, i) => i) };
}

export function evaluate(core: Core, dense: Dense, p: EvaParams): RouteEval {
  return core.evaluateRouteOn(WORLD, JEZERO, dense.pts, foot(core, p));
}

export function roverCheck(core: Core, data: WalkData | null, dense: Dense): RouteCheck | null {
  if (!data?.rover || dense.pts.length < 2) return null;
  try { return core.roverCheck(dense.pts, 100); } catch { return null; }
}

export function reachFrom(core: Core, data: WalkData | null, base: Waypoint | undefined, p: EvaParams): Reach | null {
  if (!data?.dem || !base) return null;
  try { return core.reach(WORLD, JEZERO, base.lat, base.lon, foot(core, p), MAX_SLOPE); } catch { return null; }
}

/** The Mars route resampled for the Hokkaido rehearsal search (points with known elevation). */
export function rehearsalPoints(core: Core, data: WalkData | null, route: Waypoint[]): Waypoint[] {
  return data ? densify(core, WORLD, route, 80).pts.filter((x) => x.elev != null) : [];
}

/** Index of the dense point where the walker turns back, or null when the whole route is walkable. */
export const turnIndex = (ev: RouteEval) => (ev.point_of_no_return != null ? Math.max(1, ev.point_of_no_return - 1) : null);

/** Waypoint number (WP n) the turn-back point lies before. */
export const turnWaypoint = (ev: RouteEval, dense: Dense) =>
  dense.wp.findIndex((w) => w >= (ev.point_of_no_return ?? 0));

export interface Plan {
  route: Waypoint[]; params: PlanParams; dense: Dense; ev: RouteEval;
  check: RouteCheck | null; longer: number; reach: Reach | null;
}

/** Everything the left panel shows for a route and slider settings. */
export function computePlan(core: Core, data: WalkData | null, route: Waypoint[], params: PlanParams): Plan {
  const p = evaParams(params);
  const dense = denseRoute(core, data, route);
  const ev = evaluate(core, dense, p);
  return {
    route, params, dense, ev,
    check: roverCheck(core, data, dense),
    longer: data?.eva ? core.evaLongerShare(ev.total_h) : 0,
    reach: reachFrom(core, data, route[0], p),
  };
}

/** Share of the budget above which the walk home is "tight" (same edge as the walk-home area map). */
export const TIGHT = 0.85;

/**
 * B: a crewed rover drives Perseverance's path from the landing site (the base) and breaks down.
 * From each point, could the crew walk home with these consumables? (Rust: home_ratio + walkback)
 */
export function roverWalkback(core: Core, data: WalkData | null, p: EvaParams): RoverWalkback | null {
  if (!data?.dem || !data.rover) return null;
  try { return core.roverWalkback(WORLD, JEZERO, LANDING.lat, LANDING.lon, foot(core, p), MAX_SLOPE); } catch { return null; }
}

export type WalkbackState = 'ok' | 'tight' | 'no' | 'out';
export const walkbackState = (pt: { ratio: number | null; inside: boolean }): WalkbackState =>
  !pt.inside ? 'out' : pt.ratio == null || pt.ratio > 1 ? 'no' : pt.ratio > TIGHT ? 'tight' : 'ok';
export const WALKBACK_COLOR: Record<WalkbackState, string> = { ok: '#52c41a', tight: '#fadb14', no: '#ff4d4f', out: '#8c8c8c' };

/**
 * The same check with the path read from the rover_traverse table (DuckDB, parquet) instead of
 * the bundled JSON: SQL fetches the rows, the Rust core does the walking maths.
 */
export async function roverWalkbackSql(core: Core, data: WalkData | null, p: EvaParams): Promise<{ r: RoverWalkback; sql: string } | null> {
  if (!data?.dem) return null;
  const { marsQuery, ROVER_PATH_SQL } = await import('../agent/marsDb');
  const rows = await marsQuery(core, ROVER_PATH_SQL, ['rover_traverse']);
  return { r: core.roverWalkbackFrom(WORLD, JEZERO, LANDING.lat, LANDING.lon, foot(core, p), MAX_SLOPE, rows), sql: ROVER_PATH_SQL };
}

/** Drop points that lie within `tol` degrees of the line between their neighbours (Douglas–Peucker). */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[1] - a[1], dy = b[0] - a[0], len = Math.hypot(dx, dy) || 1e-12;
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dx * (a[0] - pts[i][0]) - dy * (a[1] - pts[i][1])) / len;
    if (d > far) { far = d; at = i; }
  }
  if (far <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/**
 * "Easy path" leg: the least-effort walk from `a` to `b` over the Jezero grid (Dijkstra in Rust),
 * simplified to a few waypoints. Returns the points after `a` (ending at `b`), or null outside the
 * grid or where no walkable path exists (the caller then draws a straight leg).
 */
export function easyLeg(core: Core, data: WalkData | null, a: Waypoint, b: Waypoint, p: EvaParams): Waypoint[] | null {
  if (!data?.dem) return null;
  try {
    const path = core.easyPath(WORLD, JEZERO, [a.lat, a.lon], [b.lat, b.lon], foot(core, p), MAX_SLOPE);
    if (!path || path.length < 2) return null;
    return simplify(path, data.dem.dlat * 1.5).slice(1).map(([lat, lon]) => ({ lat, lon, elev: undefined }));
  } catch { return null; }
}

/**
 * Route to a destination: Dijkstra over the walk-home area (Rust grid.rs plan_route) with the same
 * costs as the verdict (slope, footing, and the departure-time water budget), then the points as a
 * route from the base. `ms` is how long the search took.
 */
export function planRoute(core: Core, data: WalkData | null, base: Waypoint, goal: Waypoint, p: EvaParams, w?: RouteWeights):
  { route: Waypoint[] | null; plan: PlannedRoute | null; ms: number } {
  if (!data?.dem) return { route: null, plan: null, ms: 0 };
  const t0 = performance.now();
  try {
    const plan = core.planRoute(WORLD, JEZERO, [base.lat, base.lon], [goal.lat, goal.lon], foot(core, p), MAX_SLOPE, w);
    const route = plan.status === 'ok' ? [base, ...plan.path.slice(1).map(([lat, lon]) => ({ lat, lon, elev: undefined }))] : null;
    return { route, plan, ms: performance.now() - t0 };
  } catch { return { route: null, plan: null, ms: performance.now() - t0 }; }
}

/** Numbers to compare planned routes by (all from the Rust core: evaluation and footing). */
export interface RouteMetrics { km: number; total_h: number; o2_left: number; max_slope: number; poor_footing: number; ok: boolean;
  /** Cost breakdown: hours of the round trip on flat firm ground, extra hours from slopes, extra
   * hours from footing, and the cooling-water factor from the air temperature (all from Rust). */
  flat_h: number; slope_h: number; footing_h: number; water_factor: number }
export function routeMetrics(core: Core, data: WalkData | null, route: Waypoint[], p: EvaParams): RouteMetrics | null {
  if (!data?.dem || route.length < 2) return null;
  const dense = denseRoute(core, data, route);
  const ev = evaluate(core, dense, p);
  // Poor footing: η at or above the midpoint between firm and loose ground (footing.rs constants).
  let poor = 0;
  try {
    const m = core.footingModel(), cut = (m.eta_firm + m.eta_loose) / 2;
    const f = core.sampleFooting(JEZERO, dense.pts.map((w) => [w.lat, w.lon] as [number, number]));
    const known = f.filter((x): x is number => x != null);
    poor = known.length ? known.filter((x) => x >= cut).length / known.length : 0;
  } catch { /* no footing */ }
  const firm = evaluate(core, dense, { ...p, footing: false });
  const flat = (ev.out_km + ev.back_km) / p.speed_kmh;
  return { km: ev.out_km, total_h: ev.total_h, o2_left: ev.usable_o2_h > 0 ? 1 - ev.total_effort_h / ev.usable_o2_h : 0, max_slope: ev.max_slope_deg, poor_footing: poor, ok: ev.ok,
    flat_h: flat, slope_h: Math.max(0, firm.total_h - flat), footing_h: Math.max(0, ev.total_h - firm.total_h), water_factor: waterFactor(core, p) };
}

/**
 * Evaluation material for one route: the numbers the app already computes, gathered per segment
 * (between the drawn waypoints, the same cuts as the route profile) and in total, each with where
 * it comes from. Nothing new is modelled here: the Rust evaluation (RouteEval legs / ticks), the
 * footing grid, the weather factor, the radiation rate and the rover-path check are combined.
 */
export interface Segment { from_wp: number; to_wp: number; km: number; hours: number; climb_m: number; descent_m: number; max_slope_deg: number; over_limit: boolean; poor_footing: number }
export interface RouteEvaluation {
  totals: {
    out_km: number; back_km: number; round_trip_h: number; climb_m: number; descent_m: number;
    max_slope_deg: number; mean_slope_deg: number; over_limit_legs: number; poor_footing: number;
    verdict: 'ok' | 'turn_back' | 'impassable'; margin_h: number | null; turn_back_km: number | null;
    radiation_msv: number | null; near_rover_path: number | null;
  };
  by_departure: { start_h: number; temp_c: number | null; water_factor: number; o2_left: number; water_left: number; ok: boolean }[];
  segments: Segment[];
  sources: Record<string, string>;
}
export function evaluateRouteMaterial(core: Core, data: WalkData | null, route: Waypoint[], p: EvaParams): RouteEvaluation | null {
  if (!data?.dem || route.length < 2) return null;
  const dense = denseRoute(core, data, route);
  const ev = evaluate(core, dense, p);
  const pts = dense.pts;
  let cut = 1.35;
  let foot: (number | null)[] = [];
  try {
    const m = core.footingModel(); cut = (m.eta_firm + m.eta_loose) / 2;
    ensureFooting(core, true);
    foot = core.sampleFooting(JEZERO, pts.map((w) => [w.lat, w.lon] as [number, number]));
  } catch { /* no footing */ } finally { ensureFooting(core, p.footing ?? true); }
  const dz = (i: number) => (pts[i].elev != null && pts[i - 1].elev != null ? (pts[i].elev as number) - (pts[i - 1].elev as number) : 0);
  const legStats = (a: number, b: number) => {
    let km = 0, h = 0, up = 0, down = 0, mx = 0, poor = 0, known = 0, over = false;
    for (let i = a + 1; i <= b && i < pts.length; i++) {
      const l = ev.legs[i - 1];
      if (!l) continue;
      km += l.km; h += l.hours;
      const d = dz(i); if (d > 0) up += d; else down -= d;
      if (l.known) { mx = Math.max(mx, Math.abs(l.slope_deg)); if (Math.abs(l.slope_deg) > MAX_SLOPE) over = true; }
      const f = foot[i]; if (f != null) { known++; if (f >= cut) poor++; }
    }
    return { km, h, up, down, mx, over, poor: known ? poor / known : 0 };
  };
  const segments: Segment[] = [];
  for (let k = 0; k + 1 < dense.wp.length; k++) {
    const s = legStats(dense.wp[k], dense.wp[k + 1]);
    segments.push({ from_wp: k, to_wp: k + 1, km: s.km, hours: s.h, climb_m: s.up, descent_m: s.down, max_slope_deg: s.mx, over_limit: s.over, poor_footing: s.poor });
  }
  const all = legStats(0, pts.length - 1);
  const knownLegs = ev.legs.filter((l) => l.known);
  const kmKnown = knownLegs.reduce((x, l) => x + l.km, 0);
  const mean = kmKnown ? knownLegs.reduce((x, l) => x + Math.abs(l.slope_deg) * l.km, 0) / kmKnown : 0;
  const steep = steepLeg(ev), ti = turnIndex(ev);
  const by_departure = [6, 9, 12, 15, 18].map((h) => {
    const q = { ...p, start_h: h };
    const e = evaluate(core, dense, q);
    const f = waterFactor(core, q);
    let temp: number | null = null;
    try { const w = core.weatherWalk(h, p.o2_h); temp = w.temp_k != null ? w.temp_k - 273.15 : null; } catch { /* no weather */ }
    return { start_h: h, temp_c: temp, water_factor: f, o2_left: e.usable_o2_h > 0 ? Math.max(0, 1 - e.total_effort_h / e.usable_o2_h) : 0, water_left: e.usable_water_h > 0 ? Math.max(0, 1 - (e.total_effort_h * WATER_PER_O2) / e.usable_water_h) : 0, ok: e.ok };
  });
  let rad: number | null = null;
  try { rad = core.radiationExposure(ev.total_h).dose_msv; } catch { /* none */ }
  const chk = roverCheck(core, data, dense);
  return {
    totals: {
      out_km: ev.out_km, back_km: ev.back_km, round_trip_h: ev.total_h, climb_m: all.up, descent_m: all.down,
      max_slope_deg: ev.max_slope_deg, mean_slope_deg: mean, over_limit_legs: ev.legs.filter((l) => l.known && Math.abs(l.slope_deg) > MAX_SLOPE).length,
      poor_footing: all.poor, verdict: steep != null ? 'impassable' : ev.ok ? 'ok' : 'turn_back',
      margin_h: ev.ok ? ev.usable_h - ev.total_effort_h : null, turn_back_km: ti != null ? ev.ticks[ti]?.km ?? null : null,
      radiation_msv: rad, near_rover_path: chk ? chk.near_share : null,
    },
    by_departure, segments,
    sources: {
      distance_time: 'Rust route evaluation on the Jezero elevation grid (HiRISE DTMs + MGS MOLA): Tobler walking speed on each 40 m leg',
      climb_slope: 'Elevations of the route points from the Jezero grid (HiRISE DTMs + MGS MOLA)',
      slope_limit: `${MAX_SLOPE}° = Martian dune angle of repose (Atwood-Stone & McEwen 2013)`,
      footing: 'Mars Odyssey THEMIS thermal inertia + MGS TES dust cover index → footing factor (footing.rs); "poor" = at or above the midpoint of firm and loose',
      consumables: 'O₂ / cooling-water budgets from the settings, water 1.15× O₂ (Gernhardt 2010), water scaled by the air temperature over the walk (Perseverance MEDA, weather.rs)',
      radiation: 'Curiosity RAD surface dose rate 0.64 mSv/day (Hassler et al. 2014) × hours',
      margin: 'Usable effort-hours minus those used out and back (route evaluation)',
      rover_path: 'Share of the route within 100 m of Perseverance\'s drive path (Mars 2020 MMGIS traverse)',
    },
  };
}
