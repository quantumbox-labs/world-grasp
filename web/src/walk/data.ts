// WALKBACK datasets bundled under web/public/data (built by scripts/build-walk-data.mjs), so the
// desktop app works without a network. Large JSON is handed to the Rust core once.
import type { Core, EvaStats, RoverStats, Waypoint } from '../core';

export const JEZERO = 'jezero';
/** Perseverance landing site ("Octavia E. Butler Landing"). */
export const LANDING: Waypoint = { lat: 18.4446, lon: 77.4509 };

export interface HokkaidoSite { id: string; name: string; lat: number; lon: number; rows: number; cols: number; nulls: number }

/** jezero_footing.json (scripts/build-jezero-footing.mjs). */
export interface Footing { rows: number; cols: number; ti: (number | null)[]; dci: (number | null)[]; src: string }
/** The footing JSON as text, handed to the Rust core when the footing is switched on. */
export let footingText = '';
let footingSet: string | null = null;
/**
 * Sand ripples and rocky ground judged from HiRISE images (jezero_surface.json, built from the
 * HiRISE orthomosaic tiles): ripple / rocky share per Jezero grid cell, in percent, for a window of
 * the grid. Off by default; the route-search checkbox switches it on for every walk number.
 */
export interface Surface { rows: number; cols: number; r0: number; c0: number; h: number; w: number;
  ripple: number[]; rocky: number[]; ripple_factor: number; rocky_factor: number; src: string }
export let surface: Surface | null = null;
let surfaceOn = false;
let surfaceFactors: (number | null)[] | null = null;
/** Count the HiRISE ripples / rocks in the walk numbers or not (takes effect at the next computation). */
export function setSurfaceOn(on: boolean) { surfaceOn = on; }
export const isSurfaceOn = () => surfaceOn;
/** Extra walking factor per full grid cell: 1 + (ripple_factor − 1)·ripple share + (rocky_factor − 1)·rocky share. */
function surfaceGrid(s: Surface): (number | null)[] {
  if (surfaceFactors) return surfaceFactors;
  const out: (number | null)[] = new Array(s.rows * s.cols).fill(null);
  for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
    const k = r * s.w + c;
    out[(s.r0 + r) * s.cols + s.c0 + c] = 1 + (s.ripple_factor - 1) * s.ripple[k] / 100 + (s.rocky_factor - 1) * s.rocky[k] / 100;
  }
  return (surfaceFactors = out);
}
/** Count the footing (and, when switched on, the HiRISE surface) in the Rust core's Jezero grid (only calls into WASM on a change). */
export function ensureFooting(core: Core, on: boolean) {
  const surf = surfaceOn && !!surface;
  const key = `${on && !!footingText}|${surf}`;
  if (footingSet === key) return;
  try {
    let text = on ? footingText : '';
    if (surf && surface) {
      const base = text ? JSON.parse(text) : { rows: surface.rows, cols: surface.cols };
      text = JSON.stringify({ ...base, surface: surfaceGrid(surface) });
    }
    core.setFooting(JEZERO, text); footingSet = key;
  } catch (e) { console.warn('footing', e); }
}

/** Elevation grid as stored in web/public/data (north-up, cell centres, metres or null). */
export interface GridData { lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number; z: (number | null)[]; src?: string }

export interface WalkData {
  dem: { lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number; src?: string } | null;
  /** The same Jezero grid with elevations, for the 3D view. */
  demGrid: GridData | null;
  rover: RoverStats | null;
  /** Rover path as [lat, lon] polylines for the map. */
  traverse: [number, number][][];
  /** The same path as [lon, lat, z] for building the example route. */
  traverseRaw: [number, number, number][][];
  eva: EvaStats | null;
  hokkaido: HokkaidoSite[];
  /** Footing per Jezero grid cell (THEMIS thermal inertia, TES dust cover index), for the map layer. */
  footing: Footing | null;
  /** Jezero hourly air temperature / pressure (Perseverance MEDA), loaded into the Rust core. */
  weather: { hours: { hour: number; air_temp_k: number | null; pressure_pa: number | null; sols: number }[]; sols: number[]; src: string } | null;
  /** Datasets that failed to load: 'dem' | 'traverse' | 'eva' | 'hokkaido' (details in the console). */
  errors: string[];
}

const get = async (path: string) => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
};

let cache: Promise<WalkData> | null = null;

export function loadWalkData(core: Core): Promise<WalkData> {
  cache ??= (async () => {
    const d: WalkData = { dem: null, demGrid: null, rover: null, traverse: [], traverseRaw: [], eva: null, hokkaido: [], footing: null, weather: null, errors: [] };
    await Promise.all([
      get('./data/jezero_dem.json').then((t) => {
        core.setGrid(JEZERO, t);
        const g = JSON.parse(t) as GridData;
        const { z: _z, ...meta } = g;
        d.dem = meta;
        d.demGrid = g;
      }).catch((e) => (console.warn('jezero dem', e), d.errors.push('dem'))),
      get('./data/jezero_weather.json').then((t) => { core.setWeather(t); d.weather = JSON.parse(t); })
        .catch((e) => (console.warn('weather', e), d.errors.push('weather'))),
      get('./data/jezero_footing.json').then((t) => { footingText = t; d.footing = JSON.parse(t); })
        .catch((e) => (console.warn('footing', e), d.errors.push('footing'))),
      get('./data/jezero_surface.json').then((t) => { surface = JSON.parse(t); })
        .catch((e) => (console.warn('surface', e), d.errors.push('surface'))),
      get('./data/m20_traverse.json').then((t) => {
        d.rover = core.setTraverse(t);
        const j = JSON.parse(t) as { drives: { sol: number; c: [number, number, number][] }[] };
        d.traverseRaw = j.drives.map((x) => x.c);
        d.traverse = j.drives.map((x) => x.c.map((p) => [p[1], p[0]] as [number, number]));
      }).catch((e) => (console.warn('traverse', e), d.errors.push('traverse'))),
      get('./data/eva.csv').then((t) => { d.eva = core.setEvaCsv(t); })
        .catch((e) => (console.warn('eva', e), d.errors.push('eva'))),
      get('./data/hokkaido/index.json').then((t) => { d.hokkaido = JSON.parse(t); })
        .catch((e) => (console.warn('hokkaido grids', e), d.errors.push('hokkaido'))),
    ]);
    // The grid is set first (above); footing counts by default.
    if (d.dem) ensureFooting(core, true);
    return d;
  })();
  return cache;
}

const loadedHk = new Map<string, Promise<GridData>>();
export function loadHokkaidoGrid(core: Core, id: string): Promise<GridData> {
  let p = loadedHk.get(id);
  if (!p) {
    p = get(`./data/hokkaido/${id}.json`).then((t) => { core.setGrid(`hk:${id}`, t); return JSON.parse(t) as GridData; });
    loadedHk.set(id, p);
  }
  return p;
}

/**
 * Example route: the first points where Perseverance's path got 0.6, 1.2, … `awayKm` km (straight
 * line) from the landing site. Gives a meaningful first screen before anyone clicks.
 */
export function exampleRoute(raw: [number, number, number][][], stepKm = 0.6, awayKm = 3.0): Waypoint[] {
  const R = 3389.5, k = (Math.PI / 180) * R;
  const pts: Waypoint[] = [LANDING];
  let next = stepKm;
  for (const line of raw) {
    for (const p of line) {
      const away = Math.hypot((p[0] - LANDING.lon) * k * Math.cos((p[1] * Math.PI) / 180), (p[1] - LANDING.lat) * k);
      if (away >= next) {
        pts.push({ lat: p[1], lon: p[0] });
        next += stepKm;
        if (next > awayKm + 1e-9) return pts;
      }
    }
  }
  return pts;
}
