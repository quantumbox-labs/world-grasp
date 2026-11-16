// Small geometry helpers for the WALKBACK view (planar approximations at a few km scale).
import type { Core, Reach, Waypoint, World } from '../core';
import { JEZERO } from './data';

export interface Dense {
  /** Route resampled every ~stepM, with elevations from the grid (or the waypoint's own). */
  pts: Waypoint[];
  /** Index in `pts` of each original waypoint. */
  wp: number[];
}

/** Resample a route every `stepM` metres and fill elevations from the Jezero grid. */
export function densify(core: Core, world: World, route: Waypoint[], stepM = 40): Dense {
  if (route.length === 0) return { pts: [], wp: [] };
  const R = core.world(world).radius_km * 1000, k = (Math.PI / 180) * R;
  const pts: Waypoint[] = [], wp: number[] = [];
  for (let i = 0; i < route.length; i++) {
    const a = route[i];
    wp.push(pts.length);
    pts.push(a);
    const b = route[i + 1];
    if (!b) break;
    const d = Math.hypot((b.lon - a.lon) * k * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * k);
    const n = Math.floor(d / stepM);
    for (let j = 1; j < n; j++) {
      const f = j / n;
      pts.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, elev: undefined });
    }
  }
  if (world === 'mars') {
    try {
      const z = core.sampleGrid(JEZERO, pts.map((p) => [p.lat, p.lon]));
      pts.forEach((p, i) => { if (z[i] != null) p.elev = z[i]; else if (p.elev === undefined) p.elev = null; });
    } catch {
      pts.forEach((p) => { if (p.elev === undefined) p.elev = null; });
    }
  } else pts.forEach((p) => { if (p.elev === undefined) p.elev = null; });
  return { pts: pts.map((p) => ({ ...p })), wp };
}

/** Paint the walk-home area as a PNG data URL plus its lat/lon bounds. */
export function reachImage(r: Reach, g: { lat0: number; lon0: number; dlat: number; dlon: number }) {
  const c = document.createElement('canvas');
  c.width = r.cols; c.height = r.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(r.cols, r.rows);
  for (let i = 0; i < r.ratio.length; i++) {
    const v = r.ratio[i];
    if (v == null || v > 1) continue;
    const o = i * 4;
    // Near the limit (0.85–1) is drawn warmer so the edge reads as a line.
    if (v > 0.85) { img.data[o] = 255; img.data[o + 1] = 214; img.data[o + 2] = 102; img.data[o + 3] = 200; }
    else { img.data[o] = 82; img.data[o + 1] = 196; img.data[o + 2] = 26; img.data[o + 3] = Math.round(60 + 80 * v); }
  }
  ctx.putImageData(img, 0, 0);
  const north = g.lat0 + g.dlat / 2, west = g.lon0 - g.dlon / 2;
  const south = north - r.rows * g.dlat, east = west + r.cols * g.dlon;
  return { url: c.toDataURL(), bounds: [[south, west], [north, east]] as [[number, number], [number, number]] };
}

export const slopeColor = (deg: number | null) =>
  deg == null ? '#8c8c8c' : Math.abs(deg) < 8 ? '#73d13d' : Math.abs(deg) < 15 ? '#ffd666' : '#ff4d4f';

export const fmtH = (h: number) => {
  const m = Math.round(Math.max(0, h) * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

/** Footing layer as a PNG data URL: firm ground clear, loose ground orange → red (0–255 per cell). */
export function footingImage(bad: Uint8Array, g: { lat0: number; lon0: number; dlat: number; dlon: number; rows: number; cols: number }) {
  const c = document.createElement('canvas');
  c.width = g.cols; c.height = g.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.cols, g.rows);
  for (let i = 0; i < bad.length; i++) {
    const v = bad[i] / 255, o = i * 4;
    img.data[o] = 255; img.data[o + 1] = Math.round(200 - 160 * v); img.data[o + 2] = 40; img.data[o + 3] = Math.round(220 * v);
  }
  ctx.putImageData(img, 0, 0);
  const north = g.lat0 + g.dlat / 2, west = g.lon0 - g.dlon / 2;
  return { url: c.toDataURL(), bounds: [[north - g.rows * g.dlat, west], [north, west + g.cols * g.dlon]] as [[number, number], [number, number]] };
}

/**
 * Sand ripples (blue) and rocky ground (orange) judged from HiRISE images, as an image over the
 * judged window of the Jezero grid (walk/data.ts Surface; shares in percent per cell).
 */
export function surfaceImage(s: { r0: number; c0: number; h: number; w: number; ripple: number[]; rocky: number[] },
  g: { lat0: number; lon0: number; dlat: number; dlon: number }) {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s.w, s.h);
  for (let i = 0; i < s.w * s.h; i++) {
    const rp = s.ripple[i] / 100, rk = s.rocky[i] / 100, o = i * 4;
    if (rp >= rk && rp > 0.05) { img.data[o] = 60; img.data[o + 1] = 170; img.data[o + 2] = 255; img.data[o + 3] = Math.round(60 + 170 * rp); }
    else if (rk > 0.05) { img.data[o] = 255; img.data[o + 1] = 90; img.data[o + 2] = 40; img.data[o + 3] = Math.round(60 + 170 * rk); }
  }
  ctx.putImageData(img, 0, 0);
  const north = g.lat0 + g.dlat / 2 - s.r0 * g.dlat, west = g.lon0 - g.dlon / 2 + s.c0 * g.dlon;
  return { url: c.toDataURL(), bounds: [[north - s.h * g.dlat, west], [north, west + s.w * g.dlon]] as [[number, number], [number, number]] };
}
