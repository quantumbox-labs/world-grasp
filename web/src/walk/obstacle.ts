// Obstacles reported on the way (astronaut view): a rectangle across the walking direction becomes
// blocked cells in the Rust Jezero grid (grid.rs `blocked`), and the route from where the astronaut
// stands is searched again with the same Rust planner (easy path: least effort, slope and footing).
// Every number returned comes from the Rust evaluation of the old and new routes.
import type { Core, Waypoint } from '../core';
import { JEZERO, type WalkData } from './data';
import { denseRoute, easyLeg, evaluate, evaParams, type PlanParams } from './plan';

const R_MARS_M = 3389.5e3;
const K = (Math.PI / 180) * R_MARS_M;

export interface Obstacle { id: number; corners: [number, number][]; widthM: number; depthM: number; aheadM: number; note?: string }

/** Where the astronaut stands in the astronaut view (set by SuitView while it is shown). */
export interface SuitPose {
  here: Waypoint;
  /** Walking direction, degrees clockwise from north. */
  heading: number;
  /** On the way back to the base. */
  back: boolean;
  /** Number of drawn waypoints already passed on the way out (route[0..passed) are behind). */
  passed: number;
  /** Position along the dense route (index into denseRoute(route).pts, fractional). */
  i: number;
  /** Hours still needed to walk home from here along the current route. */
  homeH: number;
  /** Route km still to walk home from here along the current route. */
  homeKm: number;
}
export interface SuitLink {
  pose(): SuitPose | null;
  /** Put the new route on screen and keep walking from waypoint index `at` (way out or way back). */
  continueOn(route: Waypoint[], at: number, back: boolean): void;
}

let suit: SuitLink | null = null;
export const setSuitLink = (s: SuitLink | null) => { suit = s; };
export const getSuitLink = () => suit;

let obstacles: Obstacle[] = [];
const subs = new Set<(o: Obstacle[], last: Reroute | null) => void>();
export const getObstacles = () => obstacles;
export function onObstacles(fn: (o: Obstacle[], last: Reroute | null) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** Rectangle `widthM` wide (across) and `depthM` deep (along), its near edge `aheadM` in front of `p`. */
function rect(p: Waypoint, headingDeg: number, aheadM: number, widthM: number, depthM: number): [number, number][] {
  const h = (headingDeg * Math.PI) / 180, cos = Math.cos((p.lat * Math.PI) / 180);
  const f = [Math.sin(h), Math.cos(h)], s = [Math.cos(h), -Math.sin(h)]; // forward / right, as [east, north]
  const at = (along: number, across: number): [number, number] => {
    const e = f[0] * along + s[0] * across, n = f[1] * along + s[1] * across;
    return [p.lat + n / K, p.lon + e / (K * cos)];
  };
  return [at(aheadM, -widthM / 2), at(aheadM, widthM / 2), at(aheadM + depthM, widthM / 2), at(aheadM + depthM, -widthM / 2)];
}

/** Grid cells under the obstacles. Each rectangle is grown by most of a cell, so even a thin wall is
 * at least two cells thick and the 8-neighbour search cannot slip through it diagonally. */
function cellsOf(g: NonNullable<WalkData['dem']>, list: Obstacle[], keep: Waypoint[]): number[] {
  const out = new Set<number>();
  const cellM = Math.min(g.dlat * K, g.dlon * K * Math.cos(((g.lat0 - (g.rows / 2) * g.dlat) * Math.PI) / 180));
  for (const o of list) {
    const [a, b, , d] = o.corners;
    const cos = Math.cos((a[0] * Math.PI) / 180);
    const xy = (q: [number, number]) => [(q[1] - a[1]) * K * cos, (q[0] - a[0]) * K];
    const u = xy(b), v = xy(d), lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    const grow = cellM * 0.9;
    const lats = o.corners.map((q) => q[0]), lons = o.corners.map((q) => q[1]);
    const pad = (grow * 2) / K;
    const r0 = Math.max(0, Math.floor((g.lat0 - Math.max(...lats) - pad) / g.dlat)), r1 = Math.min(g.rows - 1, Math.ceil((g.lat0 - Math.min(...lats) + pad) / g.dlat));
    const c0 = Math.max(0, Math.floor((Math.min(...lons) - pad / cos - g.lon0) / g.dlon)), c1 = Math.min(g.cols - 1, Math.ceil((Math.max(...lons) + pad / cos - g.lon0) / g.dlon));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const p = xy([g.lat0 - r * g.dlat, g.lon0 + c * g.dlon]);
      const su = (p[0] * u[0] + p[1] * u[1]) / lu, sv = (p[0] * v[0] + p[1] * v[1]) / lv;
      if (su >= -grow && su <= lu + grow && sv >= -grow && sv <= lv + grow) out.add(r * g.cols + c);
    }
  }
  // Never block the cells where the astronaut stands or where the search must end.
  for (const q of keep) {
    const r = Math.round((g.lat0 - q.lat) / g.dlat), c = Math.round((q.lon - g.lon0) / g.dlon);
    out.delete(r * g.cols + c);
  }
  return [...out];
}

function apply(core: Core, data: WalkData, list: Obstacle[], keep: Waypoint[]) {
  if (!data.dem) return;
  core.setBlocked(JEZERO, cellsOf(data.dem, list, keep));
}

export function clearObstacles(core: Core, data: WalkData | null) {
  obstacles = [];
  if (data?.dem) { try { core.setBlocked(JEZERO, []); } catch { /* grid not loaded */ } }
  subs.forEach((fn) => fn(obstacles, null));
}

export interface Reroute {
  ok: true;
  obstacle: Obstacle;
  back: boolean;
  /** Old and new figures for what is left to compare: the whole walk on the way out, the walk home on the way back. */
  before: { km: number; hours: number };
  after: { km: number; hours: number };
  /** Whole walk still within the oxygen / water budget (new route, Rust verdict). */
  walkable: boolean;
  margin_h: number;
  o2_left: number;
  route: Waypoint[];
}
export type RerouteResult = Reroute | { ok: false; reason: 'no_view' | 'no_terrain' | 'no_path'; obstacle?: Obstacle };

/**
 * Report an obstacle in front of the astronaut and search the route again from where they stand.
 * Way out: to the route's original destination. Way back: to the base.
 */
export function reportObstacle(core: Core, data: WalkData, route: Waypoint[], params: PlanParams,
  a: { ahead_m?: number; width_m?: number; depth_m?: number; note?: string }): RerouteResult {
  const pose = suit?.pose();
  if (!pose || route.length < 2) return { ok: false, reason: 'no_view' };
  if (!data.dem) return { ok: false, reason: 'no_terrain' };
  const aheadM = clamp(a.ahead_m, 2, 500, 20), widthM = clamp(a.width_m, 2, 1000, 50), depthM = clamp(a.depth_m, 1, 300, 10);
  const obstacle: Obstacle = { id: Date.now(), corners: rect(pose.here, pose.heading, aheadM, widthM, depthM), widthM, depthM, aheadM, note: a.note };
  obstacles = [...obstacles, obstacle];
  const p = evaParams(params);
  const here: Waypoint = { lat: pose.here.lat, lon: pose.here.lon, elev: undefined };
  const base = route[0], goal = route[route.length - 1];
  const dense = denseRoute(core, data, route);
  // Rejoin the route a little past the obstacle (along the way the astronaut is walking).
  const i0 = Math.max(0, Math.min(dense.pts.length - 1, Math.floor(pose.i)));
  const need = aheadM + depthM + 60, step = pose.back ? -1 : 1;
  let j = i0, d = 0;
  while (j + step >= 0 && j + step < dense.pts.length && d < need) { d += dist(dense.pts[j], dense.pts[j + step]); j += step; }
  if (j === i0) j = pose.back ? 0 : dense.pts.length - 1;
  const rejoin: Waypoint = { lat: dense.pts[j].lat, lon: dense.pts[j].lon, elev: undefined };
  apply(core, data, obstacles, [here, base, goal, rejoin]);
  const detour = easyLeg(core, data, here, rejoin, p);
  if (!detour) { subs.forEach((fn) => fn(obstacles, null)); return { ok: false, reason: 'no_path', obstacle }; }
  // Way out: waypoints passed → here → detour → rejoin → the rest of the route, walked on from `here`.
  // Way back: base → route up to the rejoin point → detour reversed → here, walked from its far end.
  const next = pose.back
    ? [...route.filter((_, k) => dense.wp[k] < j), ...detour.slice().reverse(), here]
    : [...route.slice(0, Math.max(1, pose.passed)), here, ...detour, ...route.filter((_, k) => dense.wp[k] > j)];
  const evNew = evaluate(core, denseRoute(core, data, next), p);
  // Way back: compare the walk home from here on the old route (base … here) with the new one, both as Rust back_h.
  const evOld = evaluate(core, pose.back ? denseRoute(core, data, [...route.filter((_, k) => dense.wp[k] < i0), here]) : dense, p);
  const before = pose.back ? { km: evOld.out_km, hours: evOld.back_h } : { km: evOld.out_km, hours: evOld.total_h };
  const after = pose.back ? { km: evNew.out_km, hours: evNew.back_h } : { km: evNew.out_km, hours: evNew.total_h };
  const at = pose.back ? next.length - 1 : Math.max(1, pose.passed);
  const res = { ok: true as const, obstacle, back: pose.back, before, after, route: next, ...finish(evNew) };
  suit?.continueOn(next, at, pose.back);
  return done(res);
}

const dist = (a: Waypoint, b: Waypoint) => Math.hypot((b.lat - a.lat) * K, (b.lon - a.lon) * K * Math.cos((a.lat * Math.PI) / 180));

function finish(ev: ReturnType<typeof evaluate>) {
  return {
    walkable: ev.ok,
    margin_h: ev.ticks.length ? Math.min(...ev.ticks.map((x) => x.margin_h)) : 0,
    o2_left: ev.usable_o2_h > 0 ? Math.max(0, 1 - ev.total_effort_h / ev.usable_o2_h) : 0,
  };
}

function done(r: Reroute): Reroute {
  subs.forEach((fn) => fn(obstacles, r));
  return r;
}

function clamp(v: unknown, lo: number, hi: number, d: number) {
  const x = Number(v);
  return v == null || !Number.isFinite(x) ? d : Math.max(lo, Math.min(hi, x));
}
