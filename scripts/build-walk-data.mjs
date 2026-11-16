// Builds the WALKBACK data files the app loads from web/public/data/ (bundled, so the desktop
// app works offline).
//   node scripts/build-walk-data.mjs            (mise run walk-data)
//
// Inputs (downloaded into data/raw/, not committed):
//   M20_traverse.json  https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json
//   eva.csv            https://data.nasa.gov/docs/legacy/Extra-vehicular_Activity_EVA_-_US_and_Russia/Extra-vehicular_Activity_EVA_-_US_and_Russia_rows.csv
//   jezero_dem.json    Jezero elevation grid (HiRISE DTM filled with MOLA), see docs/walkback.md
// Outputs:
//   web/public/data/m20_traverse.json   drives [{sol, c: [[lon, lat, z], …]}], points ≥ 3 m apart
//   web/public/data/eva.csv             copy
//   web/public/data/jezero_dem.json     copy
//   web/public/data/hokkaido/<id>.json  elevation grid around each #10 Hokkaido site, from NASADEM
//                                       (NASA/JPL, 1 arc-second ≈ 30 m; Cloud-Optimized GeoTIFFs via
//                                       Microsoft Planetary Computer, no login), resampled to ≈ 83 m.
//   Pass --no-hokkaido to skip the download. --dem gsi uses 国土地理院 DEM PNG tiles instead
//   (old behaviour; the project rule is that numbers fed into calculations come from NASA data).
//   NASADEM reading needs the geotiff package (root devDependency).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = (f) => path.join(root, 'data/raw', f);
const outDir = path.join(root, 'web/public/data');
fs.mkdirSync(path.join(outDir, 'hokkaido'), { recursive: true });
const write = (f, s) => { fs.writeFileSync(path.join(outDir, f), s); console.log(`web/public/data/${f}: ${(s.length / 1024).toFixed(0)} KB`); };

// ---- Perseverance traverse ----
if (fs.existsSync(raw('M20_traverse.json'))) {
  const t = JSON.parse(fs.readFileSync(raw('M20_traverse.json'), 'utf8'));
  const R = 3389500, K = (Math.PI / 180) * R;
  const drives = [];
  for (const f of t.features) {
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of lines) {
      const c = [];
      for (const p of line) {
        if (p.length < 3 || !p.every(Number.isFinite)) continue;
        const last = c[c.length - 1];
        if (last) {
          const dx = (p[0] - last[0]) * K * Math.cos((p[1] * Math.PI) / 180), dy = (p[1] - last[1]) * K;
          if (Math.hypot(dx, dy) < 3) continue;
        }
        c.push([+p[0].toFixed(6), +p[1].toFixed(6), +p[2].toFixed(1)]);
      }
      if (c.length > 1) drives.push({ sol: f.properties?.sol ?? 0, c });
    }
  }
  write('m20_traverse.json', JSON.stringify({ src: 'NASA/JPL-Caltech Mars 2020 MMGIS M20_traverse.json', drives }));
} else console.warn('skip traverse: data/raw/M20_traverse.json missing');

if (fs.existsSync(raw('eva.csv'))) write('eva.csv', fs.readFileSync(raw('eva.csv'), 'utf8'));
else console.warn('skip eva: data/raw/eva.csv missing');

if (fs.existsSync(raw('jezero_dem.json'))) write('jezero_dem.json', JSON.stringify(JSON.parse(fs.readFileSync(raw('jezero_dem.json'), 'utf8'))));
else console.warn('skip jezero dem: data/raw/jezero_dem.json missing');

// ---- Hokkaido grids from GSI DEM PNG tiles (--dem gsi) ----
// PNG decoder for 8-bit RGB/RGBA, non-interlaced (what GSI serves).
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported png'); }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : (() => { throw new Error(`png color type ${ct}`); })();
  const inf = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp), stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = inf[y * (stride + 1)], src = inf.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

// GSI DEM PNG: h = (R·2¹⁶ + G·2⁸ + B) × 0.01 m; (128, 0, 0) = no data; ≥ 2²³ is negative.
function gsiHeight(r, g, b) {
  const x = r * 65536 + g * 256 + b;
  if (x === 8388608) return null;
  return (x < 8388608 ? x : x - 16777216) * 0.01;
}

const Z = 12, SPAN_TILES = 3, CELL_DEG = 0.00075; // ≈ 83 m N–S
const tileXY = (lat, lon, z) => {
  const n = 2 ** z, s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

async function siteGrid(site) {
  const [cx, cy] = tileXY(site.lat, site.lon, Z);
  const x0 = Math.floor(cx - SPAN_TILES / 2), y0 = Math.floor(cy - SPAN_TILES / 2);
  const tiles = new Map();
  for (let ty = y0; ty < y0 + SPAN_TILES; ty++) for (let tx = x0; tx < x0 + SPAN_TILES; tx++) {
    const url = `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${Z}/${tx}/${ty}.png`;
    const r = await fetch(url);
    if (r.ok) tiles.set(`${tx}/${ty}`, decodePng(Buffer.from(await r.arrayBuffer())));
  }
  // lat/lon bounds of the tile block
  const lon = (x) => (x / 2 ** Z) * 360 - 180;
  const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;
  const north = lat(y0), south = lat(y0 + SPAN_TILES), west = lon(x0), east = lon(x0 + SPAN_TILES);
  const dlat = CELL_DEG, dlon = CELL_DEG / Math.cos((site.lat * Math.PI) / 180);
  const rows = Math.floor((north - south) / dlat) - 1, cols = Math.floor((east - west) / dlon) - 1;
  const lat0 = north - dlat, lon0 = west + dlon;
  const z = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const [px, py] = tileXY(lat0 - r * dlat, lon0 + c * dlon, Z);
    const tx = Math.floor(px), ty = Math.floor(py), t = tiles.get(`${tx}/${ty}`);
    if (!t) { z.push(null); continue; }
    const ix = Math.min(255, Math.floor((px - tx) * 256)), iy = Math.min(255, Math.floor((py - ty) * 256));
    const o = (iy * t.w + ix) * t.bpp, hgt = gsiHeight(t.px[o], t.px[o + 1], t.px[o + 2]);
    z.push(hgt === null ? null : Math.round(hgt));
  }
  return { id: site.id, name: site.name, lat0, lon0, dlat, dlon, rows, cols, z, src: '国土地理院 標高タイル (DEM PNG, z12)' };
}

// ---- Hokkaido grids from NASADEM (default) ----
const PC = 'https://planetarycomputer.microsoft.com/api';
let pcToken = null;
const nasademTiles = new Map(); // item id -> { img, x0, y0, rx, ry, w, h }
// Tiles already downloaded by scripts/build-scan-data.mjs (#10) live in data/raw/nasadem/<id>.tif,
// with the STAC search result in items.json; use those before going to the network.
const nasademLocal = path.join(root, 'data/raw/nasadem');
const nasademItems = fs.existsSync(path.join(nasademLocal, 'items.json'))
  ? new Set(JSON.parse(fs.readFileSync(path.join(nasademLocal, 'items.json'), 'utf8')).map((it) => it.id))
  : null;
async function nasademTile(lat, lon) {
  const { fromUrl, fromFile } = await import('geotiff');
  const id = `NASADEM_HGT_n${String(Math.floor(lat)).padStart(2, '0')}e${String(Math.floor(lon)).padStart(3, '0')}`;
  if (nasademTiles.has(id)) return nasademTiles.get(id);
  const p = (async () => {
    const local = path.join(nasademLocal, `${id}.tif`);
    let tiff;
    if (fs.existsSync(local)) tiff = await fromFile(local);
    else {
      if (nasademItems && !nasademItems.has(id)) return null; // sea-only tile (not in the search result)
      pcToken ??= (await (await fetch(`${PC}/sas/v1/token/nasadem`)).json()).token;
      const item = await (await fetch(`${PC}/stac/v1/collections/nasadem/items/${id}`)).json();
      const href = item?.assets?.elevation?.href;
      if (!href) return null; // sea-only tile
      tiff = await fromUrl(`${href}?${pcToken}`);
    }
    const img = await tiff.getImage();
    const [x0, y0] = img.getOrigin(), [rx, ry] = img.getResolution();
    return { img, x0, y0, rx, ry, w: img.getWidth(), h: img.getHeight() };
  })();
  nasademTiles.set(id, p);
  return p;
}

async function siteGridNasadem(site, { halfLat = 0.095, halfLon = 0.13, cell = CELL_DEG, src = 'bilinear to ~83 m', lakes = true } = {}) {
  // Default footprint is the old GSI version's: about 0.26° (lon) × 0.19° (lat) around the site.
  const dlat = cell, dlon = cell / Math.cos((site.lat * Math.PI) / 180);
  const north = site.lat + halfLat, south = site.lat - halfLat, west = site.lon - halfLon, east = site.lon + halfLon;
  const rows = Math.floor((north - south) / dlat), cols = Math.floor((east - west) / dlon);
  const lat0 = north - dlat / 2, lon0 = west + dlon / 2;
  // Read the window of each 1°×1° NASADEM tile the grid touches.
  const wins = [];
  for (let la = Math.floor(south); la <= Math.floor(north); la++) for (let lo = Math.floor(west); lo <= Math.floor(east); lo++) {
    const t = await nasademTile(la + 0.5, lo + 0.5);
    if (!t) continue;
    const px = (x) => Math.max(0, Math.min(t.w, x));
    const c0 = px(Math.floor((Math.max(west, lo) - t.x0) / t.rx) - 2), c1 = px(Math.ceil((Math.min(east, lo + 1) - t.x0) / t.rx) + 2);
    const r0 = px(Math.floor((Math.min(north, la + 1) - t.y0) / t.ry) - 2), r1 = px(Math.ceil((Math.max(south, la) - t.y0) / t.ry) + 2);
    if (c1 <= c0 || r1 <= r0) continue;
    const [band] = await t.img.readRasters({ window: [c0, r0, c1, r1] });
    wins.push({ t, c0, r0, w: c1 - c0, h: r1 - r0, band, nodata: t.img.getGDALNoData() });
  }
  const z = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const la = lat0 - r * dlat, lo = lon0 + c * dlon;
    let v = null;
    for (const w of wins) {
      // pixel-is-area: centre of pixel (i, j) is origin + (i + 0.5) * res
      const fx = (lo - w.t.x0) / w.t.rx - 0.5 - w.c0, fy = (la - w.t.y0) / w.t.ry - 0.5 - w.r0;
      const i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i + 1 >= w.w || j + 1 >= w.h) continue;
      const at = (a, b) => { const x = w.band[b * w.w + a]; return x === w.nodata || x < -1000 ? null : x; };
      const q = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
      if (q.some((x) => x == null)) { v = q.find((x) => x != null) ?? null; break; }
      const u = fx - i, t = fy - j;
      v = q[0] * (1 - u) * (1 - t) + q[1] * u * (1 - t) + q[2] * (1 - u) * t + q[3] * u * t;
      break;
    }
    // NASADEM fills the sea with 0 (a little below in places). Store it as null, like GSI's no-data,
    // because the rehearsal search skips placements that touch null; as 0 the flat sea would be a
    // perfect match for flat Mars stretches. (Hokkaido has no dry land at or below sea level.)
    z.push(v == null || v <= 0 ? null : Math.round(v * 10) / 10);
  }
  if (lakes) maskLakes(z, rows, cols);
  return { id: site.id, name: site.name, lat0, lon0, dlat, dlon, rows, cols, z, src: `NASADEM (NASA/JPL, 1 arc-second; via Microsoft Planetary Computer), ${src}` };
}

// Lakes (支笏湖, 洞爺湖, 摩周湖 …) are one flat elevation in both NASADEM and the GSI DEM, so a flat
// Mars stretch would be "rehearsed" on the water. A value covering ≥ 1% of the grid is a lake surface;
// null its cells whose four neighbours share it (the shoreline keeps its interpolated values).
function maskLakes(z, rows, cols) {
  const count = new Map();
  for (const v of z) if (v != null) count.set(v, (count.get(v) ?? 0) + 1);
  const lake = new Set([...count].filter(([, n]) => n >= z.length / 100).map(([v]) => v));
  if (!lake.size) return;
  const flat = z.map((v, i) => {
    if (!lake.has(v)) return false;
    const r = Math.floor(i / cols), c = i % cols;
    return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].every(([rr, cc]) => rr < 0 || cc < 0 || rr >= rows || cc >= cols || z[rr * cols + cc] === v);
  });
  flat.forEach((f, i) => { if (f) z[i] = null; });
}

// ---- Walk areas for imported GPX walks (#11 A): NASADEM at ~2 arc-seconds, no lake masking ----
// Sapporo city: the team records its walks here. Elevation of a GPX walk is taken from this grid,
// never from the GPS.
const WALK_AREAS = [{ id: 'sapporo', name: '札幌市街', lat: 43.05, lon: 141.33, halfLat: 0.09, halfLon: 0.14 }];
if (!process.argv.includes('--no-walks')) {
  fs.mkdirSync(path.join(outDir, 'walks'), { recursive: true });
  const index = [];
  for (const a of WALK_AREAS) {
    try {
      const g = await siteGridNasadem(a, { halfLat: a.halfLat, halfLon: a.halfLon, cell: 1 / 1800, src: 'bilinear to ~62 m', lakes: false });
      write(`walks/${a.id}_dem.json`, JSON.stringify(g));
      index.push({ id: a.id, name: a.name, lat0: g.lat0, lon0: g.lon0, dlat: g.dlat, dlon: g.dlon, rows: g.rows, cols: g.cols });
    } catch (e) { console.warn(`skip walk area ${a.id}: ${e.message}`); }
  }
  write('walks/index.json', JSON.stringify(index, null, 1));
}
if (process.argv.includes('--only-walks')) process.exit(0);

const demArg = process.argv.indexOf('--dem');
const DEM = demArg > 0 ? process.argv[demArg + 1] : 'nasadem';
if (!process.argv.includes('--no-hokkaido')) {
  const sites = JSON.parse(fs.readFileSync(path.join(root, 'data/earth-metrics.json'), 'utf8')).filter((s) => s.id !== 'sapporo');
  const index = [];
  for (const s of sites) {
    try {
      const g = DEM === 'gsi' ? await siteGrid(s) : await siteGridNasadem(s);
      const nulls = g.z.filter((v) => v === null).length / g.z.length;
      write(`hokkaido/${s.id}.json`, JSON.stringify(g));
      index.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, rows: g.rows, cols: g.cols, nulls: +nulls.toFixed(3) });
    } catch (e) { console.warn(`skip ${s.id}: ${e.message}`); }
  }
  write('hokkaido/index.json', JSON.stringify(index, null, 1));
}
