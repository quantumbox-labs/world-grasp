// #11 A "walk in Hokkaido, move on Mars": read a GPX walk, take its elevation from NASADEM (never
// the GPS), work out the team's measured flat-ground speed (Rust walk::summary), and lay the same
// shape onto Jezero from the base (Rust walk::transplant), with Mars elevation from the Jezero DEM.
import type { Core, TimedPoint, Waypoint, WalkSummary } from '../core';
import { JEZERO, LANDING } from './data';

export interface WalkArea { id: string; name: string; lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number }
export interface GpxTrack { name: string; desc: string; pts: { lat: number; lon: number; t: number }[] }
export interface WalkImport {
  name: string;
  file: string;
  /** Made-up sample, not the team's recording. */
  synthetic: boolean;
  earth: TimedPoint[];
  /** Walk area whose NASADEM grid gave the elevations (null: outside every area). */
  area: WalkArea | null;
  summary: WalkSummary;
  /** Same shape on Mars from the base, with Jezero elevations. */
  mars: Waypoint[];
  /** Waypoints for the planner (every ~150 m, first = base). */
  route: Waypoint[];
}

export const SAMPLE_GPX = './data/walks/sample-sapporo-maruyama-SYNTHETIC.gpx';

export class GpxError extends Error {}

/** trkpt (or rtept) positions and times. GPS elevation is ignored on purpose. */
export function parseGpx(text: string): GpxTrack {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new GpxError('not-gpx');
  const nodes = [...doc.getElementsByTagName('trkpt')];
  const use = nodes.length ? nodes : [...doc.getElementsByTagName('rtept')];
  const pts = use.map((n) => ({
    lat: n.hasAttribute('lat') ? Number(n.getAttribute('lat')) : NaN, lon: n.hasAttribute('lon') ? Number(n.getAttribute('lon')) : NaN,
    t: Date.parse(n.getElementsByTagName('time')[0]?.textContent ?? '') / 1000,
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2) throw new GpxError('no-points');
  if (pts.some((p) => !Number.isFinite(p.t))) throw new GpxError('no-time');
  const text1 = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  return { name: text1('name'), desc: text1('desc'), pts };
}

let areas: Promise<WalkArea[]> | null = null;
function loadAreas(core: Core): Promise<WalkArea[]> {
  areas ??= fetch('./data/walks/index.json').then((r) => (r.ok ? r.json() : [])).then(async (list: WalkArea[]) => {
    const ok: WalkArea[] = [];
    for (const a of list) {
      try {
        const r = await fetch(`./data/walks/${a.id}_dem.json`);
        if (!r.ok) continue;
        core.setGrid(`walk:${a.id}`, await r.text());
        ok.push(a);
      } catch { /* area missing: walks there get no elevation */ }
    }
    return ok;
  }).catch(() => []);
  return areas;
}

const inside = (a: WalkArea, lat: number, lon: number) => {
  const r = (a.lat0 - lat) / a.dlat, c = (lon - a.lon0) / a.dlon;
  return r >= 0 && c >= 0 && r <= a.rows - 1 && c <= a.cols - 1;
};

/** Thin a dense track to points about `stepM` apart (keeps the first and last). */
function thin(core: Core, pts: Waypoint[], stepM: number): Waypoint[] {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += core.distanceKm('mars', { lat: pts[i - 1].lat, lng: pts[i - 1].lon }, { lat: pts[i].lat, lng: pts[i].lon }) * 1000;
    if (acc >= stepM || i === pts.length - 1) { out.push(pts[i]); acc = 0; }
  }
  return out;
}

export async function importWalk(core: Core, text: string, file: string): Promise<WalkImport> {
  const g = parseGpx(text);
  const list = await loadAreas(core);
  const area = list.find((a) => g.pts.every((p) => inside(a, p.lat, p.lon))) ?? null;
  const z = area ? core.sampleGrid(`walk:${area.id}`, g.pts.map((p) => [p.lat, p.lon])) : g.pts.map(() => null);
  const earth: TimedPoint[] = g.pts.map((p, i) => ({ lat: p.lat, lon: p.lon, elev: z[i] ?? null, t: p.t }));
  const summary = core.walkSummary(earth);
  const ll = core.transplantWalk(earth, LANDING.lat, LANDING.lon);
  let mz: (number | null)[] = ll.map(() => null);
  try { mz = core.sampleGrid(JEZERO, ll); } catch { /* Jezero grid not loaded */ }
  const mars: Waypoint[] = ll.map(([lat, lon], i) => ({ lat, lon, elev: mz[i] }));
  const synthetic = /synthetic/i.test(file) || /synthetic|自作/i.test(`${g.name} ${g.desc}`);
  return { name: g.name || file, file, synthetic, earth, area, summary, mars, route: thin(core, mars, 150) };
}

/** Index along `pts` at `km` from the start (straight segments). */
export function atDistance(core: Core, world: 'earth' | 'mars', pts: { lat: number; lon: number }[], km: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = core.distanceKm(world, { lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon });
    if (acc + d >= km) { const u = d > 0 ? (km - acc) / d : 0; return [a.lat + (b.lat - a.lat) * u, a.lon + (b.lon - a.lon) * u]; }
    acc += d;
  }
  const last = pts[pts.length - 1];
  return [last.lat, last.lon];
}
