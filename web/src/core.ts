// Typed wrapper around the Rust core (crates/analog-core) compiled to WASM.
// The same module runs in the browser build and inside the Tauri window.
import init, * as wasm from './wasm/analog_wasm.js';

export type World = 'earth' | 'moon' | 'mars';

export interface WorldInfo {
  id: World; label: string; icon: string;
  radius_km: number; gravity: number; axial_tilt_deg: number;
  view: [number, number, number];
}
export interface EarthSite {
  id: string; name: string; en?: string; lat: number; lon: number;
  elev_m?: number | null; slope_mean_deg: number; relief_m?: number | null;
  landcover_center?: string | null; lithology_ja?: string | null; lithology_en?: string | null; age_ja?: string | null;
}
export interface Body {
  id: string; world: World; name: string; ja: string; lat: number; lon: number;
  kind: string; task: string[]; tmin: number; tmax: number; slope_mean_deg: number;
  oxides: string; approx: boolean; src: string;
}
export interface Landing { name: string; year: number; agency: string; lat: number; lon: number }
export interface Preset { id: string; name: string; lat: number; lon: number; z: number }
export interface Profile { id: string; label: string; en: string; test: boolean; season: string; season_en: string; w: Record<string, number> }
export interface DimScore { key: string; label: string; label_en: string; s: number; why: string; why_en: string; formula: string }
export interface PairScore { body_id: string; total: number; raw: number; excluded: string | null; dims: DimScore[] }
export interface SiteRanking { earth_id: string; ranks: PairScore[] }
export interface SiteScore extends PairScore { earth_id: string }
export interface Gap {
  key: 'gravity' | 'vacuum' | 'cold' | 'hot' | 'sun' | 'radiation';
  label: string; label_en: string; value: string; detail: string; detail_en: string; critical: boolean;
}
export interface Waypoint { lat: number; lon: number; elev?: number | null }
export interface EvaParams {
  speed_kmh: number; o2_h: number; reserve: number;
  water_h?: number; min_reserve_h?: number; unknown_slope?: number;
  /** Count the footing (THEMIS thermal inertia, TES dust) where the grid has it; default on. */
  footing?: boolean;
  /** Local solar hour of departure at Jezero (MEDA air temperature → cooling water); none = not counted. */
  start_h?: number;
  /** Walk home along the route reversed instead of in a straight line. */
  retrace?: boolean;
  /** Hours of work at the destination, at the nominal O₂ / water rate (estimate). */
  work_h?: number;
}
/** Route-planner weights (grid.rs RouteWeights): penalties added to the walking time of a step. */
export interface RouteWeights { time?: number; slope?: number; footing?: number; margin?: number; distance?: boolean }
/** Side of each cell in the last planTrace(): 0 = searched from the base, 1 = from the destination. */
let lastSide: Uint8Array = new Uint8Array();
export const lastPlanSide = () => lastSide;
export interface PlannedRoute { path: [number, number][]; status: 'ok' | 'outside_grid' | 'outside_reach' | 'no_path'; goal_ratio: number | null }
export interface FootingModel { ti_loose: number; ti_firm: number; eta_loose: number; eta_firm: number; dci_dusty: number; dust_extra: number }
export interface Leg { km: number; slope_deg: number; hours: number; effort_h: number; known: boolean }
export interface Tick { idx: number; t_h: number; km: number; o2_left: number; water_left: number; home_h: number; margin_h: number }
export interface RouteEval {
  out_km: number; out_h: number; back_km: number; back_h: number; total_h: number; work_h?: number;
  total_effort_h: number; usable_h: number; usable_o2_h: number; usable_water_h: number;
  limiting: 'o2' | 'water';
  limit_km: number; max_slope_deg: number; unknown_segments: number;
  ok: boolean; point_of_no_return: number | null;
  legs: Leg[]; ticks: Tick[];
}
export interface Grid { lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number; z: (number | null)[] }
export interface Reach { rows: number; cols: number; ratio: (number | null)[]; budget_h: number; area_km2: number; max_km: number }
export interface RoverStats { km: number; first_sol: number; last_sol: number; slope_p50: number; slope_p90: number; slope_max: number; window_m: number }
export interface RouteCheck {
  dist_m: number[]; near_share: number; near_m: number; route_max_slope: number;
  within_rover_share: number; rover: RoverStats;
}
export interface EvaRecord { id: string; country: string; crew: string; vehicle: string; date: string; hours: number }
export interface EvaStats { count: number; median_h: number; p90_h: number; max_h: number; longest: EvaRecord | null; hours: number[]; apollo_hours: number[] }
export interface WalkbackPoint { lat: number; lon: number; km: number; sol: number; ratio: number | null; inside: boolean }
/** Crewed-rover breakdown check along Perseverance's path (analog-core traverse::walkback). */
export interface RoverWalkback { points: WalkbackPoint[]; first_stranded: number | null; ok_share: number; inside_km: number; budget_h: number }
/** #11 A: a recorded walk point; elevation from NASADEM, never from the GPS. t in seconds. */
export interface TimedPoint { lat: number; lon: number; elev: number | null; t: number }
export interface WalkSummary { km: number; elapsed_h: number; moving_h: number; climb_m: number; descent_m: number; flat_kmh: number; moving_kmh: number }
export interface RehearsalMatch {
  pts: [number, number, number][]; rms_deg: number; score: number; rotation_deg: number; mirrored: boolean;
  climb_mars_m: number; climb_earth_m: number;
}

export interface ScanMeta {
  cell_km: number; lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number; n: number;
  src: { dem?: string; climate?: string; vegetation?: string; landcover?: string; built?: string };
}
export interface ScanCandidate {
  k: number; lat: number; lon: number; score: number; elev_m: number; slope_deg: number; shadow: number;
  near: [string, number] | null;
}
export interface ScanSiteCheck { earth_id: string; k: number | null; score: number | null; rank: number | null; percentile: number | null; excluded: string | null }
export interface ScanCell {
  k: number; lat: number; lon: number; elev_m: number; relief_m: number; slope_deg: number; slope_p90_deg: number;
  shadow: number; land: number; ndvi: number | null; urban: number | null; crop: number | null; barren: number | null;
  forest: number | null; water: number | null;
  climate: { tmin: number[]; tmax: number[]; precip: number } | null; score: PairScore;
}
export interface Scan {
  meta: ScanMeta;
  /** Grid index (row * cols + col) of each land cell. */
  cells: Uint32Array;
  scores: (bodyId: string, profileId: string) => Float32Array;
  top: (scores: Float32Array, n: number, minKm: number) => { top: ScanCandidate[]; sites: ScanSiteCheck[] };
  cell: (k: number, bodyId: string, profileId: string) => ScanCell;
  cellAt: (lat: number, lon: number) => number | null;
  gaps: (k: number, bodyId: string, test: string) => Gap[];
}

export interface Boot {
  worlds: WorldInfo[];
  earthSites: EarthSite[];
  bodies: Body[];
  missions: { landings: Record<World, Landing[]>; presets: Record<World, Preset[]> };
  profiles: Profile[];
  dims: [string, string][];
}

export interface Core extends Boot {
  world: (w: World) => WorldInfo;
  rankAll: (profileId: string) => SiteRanking[];
  rankSites: (bodyId: string, profileId: string) => SiteScore[];
  gaps: (earthId: string, bodyId: string, test: string) => Gap[];
  /** Load the whole-Hokkaido scan grid (once). */
  loadScan: (cellKm?: number) => Promise<Scan>;
  evaluateRoute: (world: World, pts: Waypoint[], p: EvaParams) => RouteEval;
  /** evaluateRoute with the surface conditions stored on a grid (footing). */
  evaluateRouteOn: (world: World, grid: string, pts: Waypoint[], p: EvaParams) => RouteEval;
  /** Footing data (jezero_footing.json text) for a grid, or '' to stop counting it. */
  setFooting: (grid: string, json: string) => void;
  /** Cells reported blocked (row-major indices); every route search steps around them. [] clears. */
  setBlocked: (grid: string, cells: number[]) => void;
  sampleFooting: (grid: string, latlons: [number, number][]) => (number | null)[];
  footingModel: () => FootingModel;
  setWeather: (json: string) => void;
  /** The last planRoute search: settled cells in order and their costs (search animation). */
  planTrace: () => { order: Uint32Array; cost: Float32Array };
  /** Route from the base to a destination inside the walk-home area (Rust grid.rs plan_route). */
  planRoute: (world: World, grid: string, from: [number, number], to: [number, number], p: EvaParams, maxSlopeDeg: number, w?: RouteWeights) => PlannedRoute;
  /** Cooling-water factor for a walk from local solar hour `startH` lasting `hours` (Rust weather.rs). */
  weatherWalk: (startH: number, hours: number) => { water_factor: number; temp_k: number | null; pressure_pa: number | null };
  weatherModel: () => { metabolic_w: number; t_ref_k: number; t_skin_k: number; leak_w_per_k: number; sol_hours: number };
  radiationExposure: (hours: number) => { dose_msv: number; career_share: number; hours_to_career_limit: number };
  radiationModel: () => { dose_eq_msv_per_day: number; dose_eq_sigma: number; absorbed_mgy_per_day: number; career_limit_msv: number; spe_limit_msv: number };
  /** Per cell 0 (firm) … 255 (loose), for the map layer; empty without footing. */
  footingBadness: (grid: string) => Uint8Array;
  distanceKm: (world: World, a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number;
  setGrid: (name: string, g: Grid | string) => void;
  sampleGrid: (name: string, latlons: [number, number][]) => (number | null)[];
  reach: (world: World, grid: string, lat: number, lon: number, p: EvaParams, maxSlopeDeg: number) => Reach;
  /** Least-effort walking path between two points on a grid, or null when none. */
  easyPath: (world: World, grid: string, a: [number, number], b: [number, number], p: EvaParams, maxSlopeDeg: number) => [number, number][] | null;
  setTraverse: (json: string) => RoverStats;
  roverCheck: (pts: Waypoint[], nearM: number) => RouteCheck;
  walkSummary: (pts: TimedPoint[]) => WalkSummary;
  transplantWalk: (pts: TimedPoint[], baseLat: number, baseLon: number) => [number, number][];
  roverWalkback: (world: World, grid: string, lat: number, lon: number, p: EvaParams, maxSlopeDeg: number) => RoverWalkback | null;
  /** Same check on traverse rows read with SQL ([{drive, seq, sol, lat, lon, elev_m, km}]). */
  roverWalkbackFrom: (world: World, grid: string, lat: number, lon: number, p: EvaParams, maxSlopeDeg: number, rows: unknown[]) => RoverWalkback;
  setEvaCsv: (csv: string) => EvaStats;
  evaLongerShare: (hours: number) => number;
  rehearse: (from: World, pts: Waypoint[], grid: string, stride: number, rotStepDeg: number, top: number) => RehearsalMatch[];
}

let corePromise: Promise<Core> | null = null;
// The WASM side holds one scan grid at a time, so only the last requested size is kept.
let scanPromise: { km: number; p: Promise<Scan> } | null = null;

function loadScan(cellKm = 1): Promise<Scan> {
  let p = scanPromise?.km === cellKm ? scanPromise.p : undefined;
  if (!p) {
    p = fetch(`data/scan/hokkaido-${cellKm}km.json`)
      .then((r) => { if (!r.ok) throw new Error(`scan data: HTTP ${r.status}`); return r.text(); })
      .then((text) => {
        const meta = JSON.parse(wasm.setScan(text)) as ScanMeta;
        return {
          meta,
          cells: wasm.scanCells(),
          scores: (b, prof) => wasm.scanScores(b, prof),
          top: (s, n, km) => JSON.parse(wasm.scanTop(s, n, km)),
          cell: (k, b, prof) => JSON.parse(wasm.scanCell(k, b, prof)),
          cellAt: (lat, lon) => { const k = wasm.scanCellAt(lat, lon); return k < 0 ? null : k; },
          gaps: (k, b, t) => JSON.parse(wasm.scanGaps(k, b, t)),
        } satisfies Scan;
      });
    const mine = p;
    p.catch(() => { if (scanPromise?.p === mine) scanPromise = null; });
    scanPromise = { km: cellKm, p };
  }
  return p;
}

export function loadCore(): Promise<Core> {
  corePromise ??= init().then(() => {
    const boot = JSON.parse(wasm.bootstrap()) as Boot;
    const worlds = Object.fromEntries(boot.worlds.map((w) => [w.id, w])) as Record<World, WorldInfo>;
    return {
      ...boot,
      world: (w) => worlds[w],
      rankAll: (id) => JSON.parse(wasm.rankAll(id)),
      rankSites: (b, p) => JSON.parse(wasm.rankSites(b, p)),
      gaps: (e, b, t) => JSON.parse(wasm.gaps(e, b, t)),
      loadScan,
      evaluateRoute: (world, pts, p) => JSON.parse(wasm.evaluateRoute(world, JSON.stringify(pts), JSON.stringify(p))),
      evaluateRouteOn: (world, grid, pts, p) => JSON.parse(wasm.evaluateRouteOn(world, grid, JSON.stringify(pts), JSON.stringify(p))),
      setFooting: (grid, json) => wasm.setFooting(grid, json),
      setBlocked: (grid, cells) => wasm.setBlocked(grid, JSON.stringify(cells)),
      sampleFooting: (grid, latlons) => JSON.parse(wasm.sampleFooting(grid, JSON.stringify(latlons))),
      footingModel: () => JSON.parse(wasm.footingModel()),
      radiationExposure: (h) => JSON.parse(wasm.radiationExposure(h)),
      setWeather: (j) => wasm.setWeather(j),
      planTrace: () => { lastSide = wasm.planTraceSide(); return { order: wasm.planTraceOrder(), cost: wasm.planTraceCost() }; },
      planRoute: (world, grid, a, b, p, max, w) => JSON.parse(wasm.planRoute(world, grid, a[0], a[1], b[0], b[1], JSON.stringify(p), max, w ? JSON.stringify(w) : '')),
      weatherWalk: (a, h) => JSON.parse(wasm.weatherWalk(a, h)),
      weatherModel: () => JSON.parse(wasm.weatherModel()),
      radiationModel: () => JSON.parse(wasm.radiationModel()),
      footingBadness: (grid) => wasm.footingBadness(grid),
      distanceKm: (world, a, b) => wasm.distanceKm(world, a.lat, a.lng, b.lat, b.lng),
      setGrid: (name, g) => wasm.setGrid(name, typeof g === 'string' ? g : JSON.stringify(g)),
      sampleGrid: (name, ll) => JSON.parse(wasm.sampleGrid(name, JSON.stringify(ll))),
      reach: (world, grid, lat, lon, p, max) => JSON.parse(wasm.reach(world, grid, lat, lon, JSON.stringify(p), max)),
      easyPath: (world, grid, a, b, p, max) => JSON.parse(wasm.easyPath(world, grid, a[0], a[1], b[0], b[1], JSON.stringify(p), max)),
      setTraverse: (json) => JSON.parse(wasm.setTraverse(json)),
      roverCheck: (pts, near) => JSON.parse(wasm.roverCheck(JSON.stringify(pts), near)),
      walkSummary: (pts) => JSON.parse(wasm.walkSummary(JSON.stringify(pts))),
      transplantWalk: (pts, lat, lon) => JSON.parse(wasm.transplantWalk(JSON.stringify(pts), lat, lon)),
      roverWalkback: (world, grid, lat, lon, p, max) => JSON.parse(wasm.roverWalkback(world, grid, lat, lon, JSON.stringify(p), max)),
      roverWalkbackFrom: (world, grid, lat, lon, p, max, rows) => JSON.parse(wasm.roverWalkbackFrom(world, grid, lat, lon, JSON.stringify(p), max, JSON.stringify(rows))),
      setEvaCsv: (csv) => JSON.parse(wasm.setEvaCsv(csv)),
      evaLongerShare: (h) => wasm.evaLongerShare(h),
      rehearse: (from, pts, grid, stride, rot, top) => JSON.parse(wasm.rehearse(from, JSON.stringify(pts), grid, stride, rot, top)),
    };
  });
  return corePromise;
}
