// Destination ideas for the 🎯 mode: places that are in NASA data, kept only when they lie inside
// the walk-home area. Nothing is invented: the names come from the IAU/USGS gazetteer (the same
// file the globe draws) and the stops are where Perseverance ended each drive (NASA/JPL MMGIS).
import type { Reach, Waypoint } from '../core';

type Lang = 'ja' | 'en';
type NameRow = [string, string, string, number, number, number | null, string | null, string | null];
interface Stop { sol: number; lat: number; lon: number }
export interface SpotSources { names: NameRow[]; stops: Stop[] }
export interface Spot {
  id: string; kind: 'name' | 'rover';
  name: { ja: string; en: string };
  lat: number; lon: number;
  /** Straight distance from the base (km). */
  km: number;
  /** Share of the out-and-back budget used to reach it (walk-home area value). */
  ratio: number;
  sol?: number; link?: string;
  /** Height above (+) or below (-) the base in metres, from the Jezero DEM (absent off the grid). */
  dz?: number;
  /** Feature type and diameter (km) for gazetteer names. */
  type?: string; diamKm?: number;
  src: string;
}
interface Grid { lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number; z?: (number | null)[] }

export const SPOT_SRC = {
  names: { label: 'IAU Gazetteer of Planetary Nomenclature (USGS Astrogeology / NASA)', url: 'https://planetarynames.wr.usgs.gov/' },
  rover: { label: 'Mars 2020 Perseverance traverse (NASA/JPL MMGIS)', url: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json' },
};

let srcP: Promise<SpotSources> | null = null;
/** The two files are already shipped with the app (and usually cached), so this is one quick read. */
export function loadSpotSources(): Promise<SpotSources> {
  return (srcP ??= Promise.all([
    fetch('./data/globe/mars_names.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch('./data/m20_traverse.json').then((r) => (r.ok ? r.json() : { drives: [] })).catch(() => ({ drives: [] })),
  ]).then(([names, trav]) => ({
    names: names as NameRow[],
    stops: ((trav as { drives?: { sol: number; c: [number, number, number][] }[] }).drives ?? [])
      .filter((d) => d.c.length)
      .map((d) => { const p = d.c[d.c.length - 1]; return { sol: d.sol, lat: p[1], lon: p[0] }; }),
  })));
}

const R_MARS = 3389.5;
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MARS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Walk-home value at a point (null outside the map or out of reach). */
export function reachAt(reach: Reach, g: Grid, lat: number, lon: number): number | null {
  const north = g.lat0 + g.dlat / 2, west = g.lon0 - g.dlon / 2;
  const fr = (north - lat) / (g.rows * g.dlat), fc = (lon - west) / (g.cols * g.dlon);
  if (fr < 0 || fr >= 1 || fc < 0 || fc >= 1) return null;
  const v = reach.ratio[Math.floor(fr * reach.rows) * reach.cols + Math.floor(fc * reach.cols)];
  return v == null || v > 1 ? null : v;
}

/** Elevation (m) at a point, nearest DEM cell; null without elevations or off the grid. */
export function elevAt(g: Grid, lat: number, lon: number): number | null {
  if (!g.z) return null;
  const north = g.lat0 + g.dlat / 2, west = g.lon0 - g.dlon / 2;
  const r = Math.floor((north - lat) / g.dlat), c = Math.floor((lon - west) / g.dlon);
  if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) return null;
  const v = g.z[r * g.cols + c];
  return v == null || !Number.isFinite(v) ? null : v;
}

/** How much of the out-and-back budget a trip takes, in words. */
export function budgetWord(ratio: number, l: Lang): string {
  if (ratio < 0.5) return l === 'ja' ? '余裕あり' : 'plenty to spare';
  if (ratio < 0.8) return l === 'ja' ? '半分以上使う' : 'uses over half';
  return l === 'ja' ? 'ぎりぎり' : 'cutting it close';
}

/** One line about a spot, only from numbers already in the data. */
export function spotNote(s: Pick<Spot, 'kind' | 'ratio' | 'dz' | 'type' | 'diamKm'>, l: Lang): string {
  const parts: string[] = [];
  if (s.kind === 'rover') parts.push(l === 'ja' ? '探査車が実際に通った場所' : 'where the rover really drove');
  else if (s.type) {
    const ty = l === 'ja' ? TYPE_JA[s.type] ?? s.type : s.type.toLowerCase();
    parts.push(s.diamKm ? (l === 'ja' ? `直径 ${s.diamKm.toFixed(1)} km の${ty}` : `${ty} ${s.diamKm.toFixed(1)} km across`) : ty);
  }
  if (s.dz != null) {
    const m = Math.round(Math.abs(s.dz));
    parts.push(m < 5 ? (l === 'ja' ? '基地とほぼ同じ高さ' : 'about level with the base')
      : l === 'ja' ? `基地より ${m} m ${s.dz > 0 ? '高い' : '低い'}` : `${m} m ${s.dz > 0 ? 'above' : 'below'} the base`);
  }
  parts.push(`${budgetWord(s.ratio, l)}${l === 'ja' ? `（往復で使う分 ${Math.round(s.ratio * 100)}%）` : ` (${Math.round(s.ratio * 100)}% of the budget)`}`);
  return parts.join(l === 'ja' ? '・' : ' · ');
}

const TYPE_JA: Record<string, string> = { Crater: 'クレーター', Vallis: '谷', Mons: '山', Planum: '台地', 'Landing site': '着陸地点' };

/**
 * Up to `max` destinations inside the walk-home area: every named place first, then Perseverance's
 * stops spread out (each next stop is the one farthest from those already picked), nearest first.
 */
export function pickSpots(src: SpotSources, reach: Reach, g: Grid, base: Waypoint, max = 8, limit = 0.95): Spot[] {
  const ok = (lat: number, lon: number) => {
    const v = reachAt(reach, g, lat, lon);
    const km = kmBetween(base, { lat, lon });
    return v != null && v <= limit && km >= 0.3 ? { v, km } : null;
  };
  const z0 = elevAt(g, base.lat, base.lon);
  const dzAt = (lat: number, lon: number) => { const z = elevAt(g, lat, lon); return z != null && z0 != null ? z - z0 : undefined; };
  const out: Spot[] = [];
  for (const n of src.names) {
    const [name, , type, lat, lon, diam, , link] = n;
    const q = ok(lat, lon);
    if (!q) continue;
    out.push({ id: `n:${name}`, kind: 'name', name: { ja: `${name}（${TYPE_JA[type] ?? type}）`, en: `${name} (${type})` }, lat, lon, km: q.km, ratio: q.v, link: link ?? undefined, dz: dzAt(lat, lon), type, diamKm: diam ?? undefined, src: SPOT_SRC.names.label });
  }
  const cand = src.stops.map((s) => ({ s, q: ok(s.lat, s.lon) })).filter((x) => x.q) as { s: Stop; q: { v: number; km: number } }[];
  const picked: typeof cand = [];
  const MIN_GAP = 0.5;
  while (out.length + picked.length < max && cand.length) {
    let best = -1, bestD = -1;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i].s;
      const d = Math.min(kmBetween(c, base), ...picked.map((p) => kmBetween(c, p.s)), ...out.map((o) => kmBetween(c, o)));
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD < MIN_GAP) break;
    picked.push(cand.splice(best, 1)[0]);
  }
  for (const { s, q } of picked) {
    out.push({ id: `r:${s.sol}`, kind: 'rover', name: { ja: `Perseverance が sol ${s.sol} に止まった地点`, en: `Where Perseverance stopped on sol ${s.sol}` }, lat: s.lat, lon: s.lon, km: q.km, ratio: q.v, sol: s.sol, dz: dzAt(s.lat, s.lon), src: SPOT_SRC.rover.label });
  }
  return out.sort((a, b) => a.km - b.km);
}

export const spotLabel = (s: Spot, l: Lang) => s.name[l];
