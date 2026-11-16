// Heat map image for the whole-Hokkaido scan, drawn in Web Mercator rows so a Leaflet
// imageOverlay (which stretches linearly in projected space) lands each cell in place.
import type { ScanMeta } from './core';

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

/** Rank of each score among all cells, 0 (worst) … 1 (best). */
export function percentiles(scores: Float32Array): Float32Array {
  const order = Array.from(scores.keys()).sort((a, b) => scores[a] - scores[b]);
  const out = new Float32Array(scores.length);
  const n = Math.max(1, scores.length - 1);
  order.forEach((k, i) => { out[k] = i / n; });
  return out;
}

/** Colour ramp: dark blue (poor) → teal → yellow → orange (best). */
function ramp(t: number): [number, number, number, number] {
  const stops: [number, number, number, number, number][] = [
    [0, 30, 50, 110, 70], [0.5, 40, 140, 170, 120], [0.85, 250, 210, 80, 190], [1, 255, 110, 50, 235],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [t1, ...c1] = stops[i];
    const [t0, ...c0] = stops[i - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f)) as [number, number, number, number];
    }
  }
  return stops[stops.length - 1].slice(1) as [number, number, number, number];
}

export interface HeatImage { url: string; bounds: [[number, number], [number, number]] }

export function heatImage(meta: ScanMeta, cells: Uint32Array, values: Float32Array): HeatImage {
  const { rows, cols, lat0, lon0, dlat, dlon } = meta;
  const grid = new Float32Array(rows * cols).fill(NaN);
  cells.forEach((g, k) => { grid[g] = values[k]; });
  const north = lat0 + dlat / 2, south = lat0 - (rows - 1) * dlat - dlat / 2;
  const west = lon0 - dlon / 2, east = lon0 + (cols - 1) * dlon + dlon / 2;
  const H = rows, W = cols;
  const yN = mercY(north), yS = mercY(south);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = invMercY(yN + ((y + 0.5) / H) * (yS - yN));
    const r = Math.floor((north - lat) / dlat);
    if (r < 0 || r >= rows) continue;
    for (let x = 0; x < W; x++) {
      const v = grid[r * cols + x];
      if (Number.isNaN(v)) continue;
      const [R, G, B, A] = ramp(v);
      const o = (y * W + x) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = A;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), bounds: [[south, west], [north, east]] };
}
