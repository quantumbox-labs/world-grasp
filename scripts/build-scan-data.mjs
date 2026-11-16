#!/usr/bin/env node
// #10 whole-Hokkaido scan: cut Hokkaido into square cells and measure every cell from open data.
//   node scripts/build-scan-data.mjs [--cell-km 1] [--offline]
// Writes web/public/data/scan/hokkaido-<cell>km.json. All input values are NASA data. Downloads
// are cached under data/raw/ so a rerun (or a finer cell size) needs no network:
// NASADEM tiles in data/raw/nasadem/<id>.tif, NASA POWER climatology in data/raw/power/<lat>_<lon>.json,
// NASA GIBS land-cover tiles in data/raw/gibs-landcover/<date>/<z>/<y>/<x>.png.
//
// Per cell (from NASADEM, 1 arc-second ≈ 30 m pixels):
//   elev     mean elevation [m]               relief  max − min [m]
//   slope    mean slope [0.1°]                p90     90th-percentile slope [0.1°]
//   shadow   share of pixels that get no sun at noon on the December solstice [‰]
//            (north-facing tilt steeper than the solstice noon sun, ≈ 23° at 43.5°N)
//   land     share of the cell that is land [%]
//   ndvi     mean summer-maximum NDVI [×1000]  bare   share of pixels whose summer max NDVI < 0.2 [‰]
//   urban / crop / barren / forest / water   share of MODIS land-cover pixels (NASA GIBS) that are
//            built-up (13) / cropland (12, 14) / barren (16) / forest (1–5) / water (17) [%]
// On the NASA POWER grid (0.5° × 0.625°, the app interpolates to cells and corrects for height):
//   elev, monthly mean daily min / max air temperature (T2M_MIN / T2M_MAX) [°C], precipitation [mm/yr]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fromArrayBuffer } from 'geotiff';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELL_KM = +arg('--cell-km', '1');
const OFFLINE = process.argv.includes('--offline');
const CONC = 8;

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rawDir = (...p) => path.join(root, 'data/raw', ...p);
const outFile = path.join(root, 'web/public/data/scan', `hokkaido-${CELL_KM}km.json`);

// Main island of Hokkaido (Rishiri/Rebun/Okushiri fall inside too; the Kurils are outside).
const BOX = { north: 45.56, south: 41.35, west: 139.3, east: 145.85 };
const LAT_MID = (BOX.north + BOX.south) / 2;
const dlat = CELL_KM / 111.32;
const dlon = CELL_KM / (111.32 * Math.cos((LAT_MID * Math.PI) / 180));
const rows = Math.ceil((BOX.north - BOX.south) / dlat);
const cols = Math.ceil((BOX.east - BOX.west) / dlon);
const lat0 = BOX.north - dlat / 2; // centre of row 0 (north)
const lon0 = BOX.west + dlon / 2; //  centre of col 0 (west)
const N = rows * cols;
console.log(`grid ${rows}×${cols} = ${N} cells of ${CELL_KM} km`);


async function pool(items, fn) {
  let i = 0, done = 0;
  const work = async () => {
    while (i < items.length) {
      const it = items[i++];
      await fn(it);
      if (++done % 200 === 0) console.log(`  ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, work));
}

async function cached(file, url, { json = false } = {}) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (fs.existsSync(file + '.none')) return null;
  if (OFFLINE) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.none', ''); return null; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (json) JSON.parse(buf.toString('utf8'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return buf;
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
}

// ---- 1. NASADEM (NASA, 1 arc-second ≈ 30 m) → per-cell terrain ----
// NASADEM_HGT v001 is read as cloud-optimised GeoTIFFs from the Microsoft Planetary Computer
// mirror (no Earthdata login needed). Sea is 0 m.
const BINS = 45; // 2° slope bins up to 90°
const cnt = new Uint32Array(N), land = new Uint32Array(N), shadow = new Uint32Array(N);
const sumZ = new Float64Array(N), sumS = new Float64Array(N);
const minZ = new Float32Array(N).fill(Infinity), maxZ = new Float32Array(N).fill(-Infinity);
const hist = new Uint32Array(N * BINS);
const DEG = 180 / Math.PI;
// Solstice noon sun elevation by latitude (Earth tilt 23.44°).
const solsticeSun = (lat) => 90 - lat - 23.44;

const PC = 'https://planetarycomputer.microsoft.com/api';
async function nasademItems() {
  const file = rawDir('nasadem/items.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (OFFLINE) return [];
  const r = await fetch(`${PC}/stac/v1/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collections: ['nasadem'], bbox: [BOX.west, BOX.south, BOX.east, BOX.north], limit: 200 }),
  });
  if (!r.ok) throw new Error(`NASADEM STAC search: HTTP ${r.status}`);
  const items = (await r.json()).features.map((f) => ({ id: f.id, href: f.assets.elevation.href }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(items, null, 1));
  return items;
}
// A SAS token covers one storage container, and MODIS assets live in a different container
// (modiseuwest) from the one the collection token endpoint covers: sign one URL per container and
// reuse its token (signing every URL runs into HTTP 429).
const sasTokens = {};
async function signed(href) {
  const u = new URL(href), container = `${u.host}/${u.pathname.split('/')[1]}`;
  if (!sasTokens[container]) {
    let r;
    for (let attempt = 1; ; attempt++) {
      r = await fetch(`${PC}/sas/v1/sign?href=${encodeURIComponent(href)}`);
      if (r.status !== 429 || attempt === 6) break;
      const wait = +(r.headers.get('retry-after') ?? 0) || 15 * attempt;
      console.warn(`sign: HTTP 429, retrying in ${wait} s`);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
    }
    if (!r.ok) throw new Error(`sign ${href}: HTTP ${r.status}`);
    sasTokens[container] = new URL((await r.json()).href).search;
  }
  return `${href}${sasTokens[container]}`;
}
async function stacItems(collection, extra = {}) {
  const file = rawDir(`modis/${collection}.items.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (OFFLINE) return [];
  const r = await fetch(`${PC}/stac/v1/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collections: [collection], bbox: [BOX.west, BOX.south, BOX.east, BOX.north], limit: 50, ...extra }),
  });
  if (!r.ok) { console.warn(`${collection}: STAC search HTTP ${r.status}`); return []; }
  const items = (await r.json()).features ?? [];
  if (!items.length) return []; // do not cache an empty search: a later fix would never refetch
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(items.map((f) => ({ id: f.id, datetime: f.properties.datetime ?? f.properties.start_datetime, assets: Object.fromEntries(Object.entries(f.assets).map(([k, a]) => [k, a.href])) })), null, 1));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const items = await nasademItems();
console.log(`NASADEM: ${items.length} tiles of 1°`);
let used = 0;
const CONC_DEM = 4; // tiles are ~10–25 MB each
const queue = [...items];
await Promise.all(Array.from({ length: CONC_DEM }, async () => {
  while (queue.length) {
    const it = queue.shift();
    const file = rawDir(`nasadem/${it.id}.tif`);
    let buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!buf && !OFFLINE) {
      buf = await cached(file, await signed(it.href));
    }
    if (!buf) continue;
    const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const img = await tiff.getImage();
    const [west, , , north] = img.getBoundingBox();
    const [rx, ry] = img.getResolution(); // degrees; ry is negative
    const W = img.getWidth(), H = img.getHeight();
    const z = (await img.readRasters({ interleave: true }));
    const nodata = img.getGDALNoData();
    used++;
    console.log(`  ${it.id}: ${W}×${H}`);
    for (let y = 1; y < H - 1; y++) {
      const lat = north + (y + 0.5) * ry;
      const r = Math.floor((BOX.north - lat) / dlat);
      if (r < 0 || r >= rows) continue;
      const dyM = Math.abs(ry) * 111320, dxM = rx * 111320 * Math.cos((lat * Math.PI) / 180);
      const sunTan = Math.tan((Math.max(1, solsticeSun(lat)) * Math.PI) / 180);
      for (let x = 1; x < W - 1; x++) {
        const lon = west + (x + 0.5) * rx;
        const c = Math.floor((lon - BOX.west) / dlon);
        if (c < 0 || c >= cols) continue;
        const k = r * cols + c, h = z[y * W + x];
        cnt[k]++;
        if (h <= 0 || h === nodata) continue; // sea / void
        land[k]++;
        sumZ[k] += h;
        if (h < minZ[k]) minZ[k] = h;
        if (h > maxZ[k]) maxZ[k] = h;
        const e = z[y * W + x + 1], w = z[y * W + x - 1], s = z[(y + 1) * W + x], n = z[(y - 1) * W + x];
        if (e === nodata || w === nodata || s === nodata || n === nodata) continue;
        const gx = (e - w) / (2 * dxM), gyS = (s - n) / (2 * dyM); // gyS: rise towards the south
        const slope = Math.atan(Math.hypot(gx, gyS)) * DEG;
        sumS[k] += slope;
        hist[k * BINS + Math.min(BINS - 1, Math.floor(slope / 2))]++;
        // Ground rising towards the south faces north; it is self-shadowed when steeper than the sun.
        if (gyS > sunTan) shadow[k]++;
      }
    }
  }
}));
console.log(`NASADEM tiles used: ${used}`);
if (!used) throw new Error('NASADEM: no tiles (network?)');


// ---- 1b. NASA MODIS → vegetation and land cover per cell ----
// MOD13A1 v061 NDVI (500 m, 16-day composites over the summer).
// NDVI is read from the Planetary Computer COG mirror (MODIS sinusoidal grid; each pixel centre is
// mapped back to latitude/longitude). Land cover comes from NASA GIBS (1c).
const R_SIN = 6371007.181;
const ndviSum = new Float64Array(N), ndviN = new Uint32Array(N), bareN = new Uint32Array(N);
const lcN = new Uint32Array(N), urbanN = new Uint32Array(N), cropN = new Uint32Array(N), barrenN = new Uint32Array(N);
async function modisRaster(collection, item, asset) {
  const href = item.assets[asset];
  if (!href) { console.warn(`${collection} ${item.id}: no asset ${asset} (has ${Object.keys(item.assets).join(', ')})`); return null; }
  const file = rawDir(`modis/${collection}/${item.id}.${asset}.tif`);
  let buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!buf && !OFFLINE) buf = await cached(file, await signed(href));
  if (!buf) return null;
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const img = await tiff.getImage();
  const [x0, , , y1] = img.getBoundingBox(); // sinusoidal metres
  const [rx, ry] = img.getResolution();
  return { W: img.getWidth(), H: img.getHeight(), x0, y1, rx, ry, v: await img.readRasters({ interleave: true }) };
}
function forEachCell(r, fn) {
  for (let y = 0; y < r.H; y++) {
    const yy = r.y1 + (y + 0.5) * r.ry;
    const lat = (yy / R_SIN) * DEG;
    const row = Math.floor((BOX.north - lat) / dlat);
    if (row < 0 || row >= rows) continue;
    const cosLat = Math.cos(yy / R_SIN);
    for (let x = 0; x < r.W; x++) {
      const lon = ((r.x0 + (x + 0.5) * r.rx) / (R_SIN * cosLat)) * DEG;
      const c = Math.floor((lon - BOX.west) / dlon);
      if (c < 0 || c >= cols) continue;
      fn(row * cols + c, r.v[y * r.W + x]);
    }
  }
}
// Summer maximum NDVI: every Terra MOD13A1 16-day composite that starts between NDVI_FROM and
// NDVI_TO (2024: Planetary Computer has no July/August 2025 composites), per pixel the highest
// value. Fields and meadows are green at some point of the summer (Tokachi wheat is already
// harvested by late July, so one composite would make farmland look bare); bare rock never is.
// The search also returns the overlapping Aqua (MYD13A1) composites; those are skipped.
// VI_Quality bits 11–13 are the land/water flag: keep land (1) and shorelines (2), drop the water
// classes. Sea and lake pixels have NDVI ≈ 0 and would otherwise make every coastal cell look like
// bare ground. Shoreline pixels (the flag also marks some cloudy inland ones, e.g. Tokachi-dake
// crater) stay, minus those with NDVI < 0: bare rock is above 0, open water and snow below.
const NDVI_FROM = arg('--ndvi-from', '2024-06-01'), NDVI_TO = arg('--ndvi-to', '2024-09-30');
const ndviItems = (await stacItems('modis-13A1-061', { datetime: `${NDVI_FROM}T00:00:00Z/${NDVI_TO}T23:59:59Z`, limit: 200 }))
  .filter((it) => it.id.startsWith('MOD13A1.') && String(it.datetime).slice(0, 10) >= NDVI_FROM && String(it.datetime).slice(0, 10) <= NDVI_TO);
const tiles = new Map(); // h..v.. → { r, max }
for (const it of ndviItems) {
  const r = await modisRaster('modis-13A1-061', it, '500m_16_days_NDVI');
  const q = await modisRaster('modis-13A1-061', it, '500m_16_days_VI_Quality');
  if (!r || !q) continue;
  const tile = it.id.split('.')[2];
  if (!tiles.has(tile)) tiles.set(tile, { r, max: new Int16Array(r.v.length).fill(-3000) });
  const max = tiles.get(tile).max;
  for (let j = 0; j < max.length; j++) {
    const lw = (q.v[j] >> 11) & 7, v = r.v[j];
    if ((lw === 1 || lw === 2) && v >= 0 && v > max[j]) max[j] = v;
  }
}
const composites = [...new Set(ndviItems.map((it) => it.id.split('.')[1]))].sort();
console.log(`MODIS NDVI: ${ndviItems.length} tiles, ${composites.length} composites (${composites.join(' ')})`);
for (const { r, max } of tiles.values()) {
  forEachCell({ ...r, v: max }, (k, v) => {
    if (v < 0) return; // fill, water or never NDVI ≥ 0
    const ndvi = v / 10000;
    ndviSum[k] += ndvi; ndviN[k]++;
    if (ndvi < 0.2) bareN[k]++;
  });
}
// ---- 1c. NASA GIBS → MODIS land cover per cell ----
// MCD12Q1 is not on Planetary Computer, and LP DAAC wants an Earthdata login. NASA GIBS serves the
// same product (MCD12Q1 IGBP, Aqua+Terra, 500 m) as colour-mapped PNG tiles on the EPSG:4326 grid
// without a login: read the layer's tile matrix set, finest level, latest year and colormap from
// the WMTS GetCapabilities, decode each pixel's colour back to its IGBP class (exact RGB match;
// transparent or unknown colours are no data) and count classes per 1 km cell.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';
const LC_LAYER = 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual';
const FOREST = new Set([1, 2, 3, 4, 5]); // IGBP evergreen/deciduous needleleaf/broadleaf, mixed forests
const lcForestN = new Uint32Array(N), lcWaterN = new Uint32Array(N);
function decodePalettePng(buf) { // 8-bit indexed colour (what GIBS serves), non-interlaced
  let pos = 8, w = 0, h = 0, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 3 || data[12] !== 0) throw new Error(`png: depth ${data[8]} colour type ${data[9]} interlace ${data[12]} not supported`);
    }
    if (type === 'PLTE') plte = data;
    if (type === 'tRNS') trns = data;
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const inf = zlib.inflateSync(Buffer.concat(idat));
  const idx = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const f = inf[y * (w + 1)], src = inf.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x ? idx[y * w + x - 1] : 0, b = y ? idx[(y - 1) * w + x] : 0, c = x && y ? idx[(y - 1) * w + x - 1] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      idx[y * w + x] = v & 255;
    }
  }
  return { w, h, idx, plte, trns };
}
async function gibsLandCover() {
  const capsBuf = await cached(rawDir('gibs-landcover/capabilities.xml'), `${GIBS}/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities`);
  if (!capsBuf) return null;
  const caps = capsBuf.toString('utf8');
  const at = caps.indexOf(`<ows:Identifier>${LC_LAYER}</ows:Identifier>`);
  if (at < 0) { console.warn(`GIBS: no layer ${LC_LAYER}`); return null; }
  const layer = caps.slice(caps.lastIndexOf('<Layer>', at), caps.indexOf('</Layer>', at));
  const tms = layer.match(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/)[1];
  const date = layer.match(/<Value>[^<]*?\/([0-9-]+)\/P1Y<\/Value>/)?.[1] ?? layer.match(/<Default>([^<]+)<\/Default>/)[1];
  const cmapUrl = layer.match(/xlink:href='([^']+\/colormaps\/v1\.3\/[^']+\.xml)'/)[1]; // attribute order varies
  const setXml = caps.match(new RegExp(`<TileMatrixSet><ows:Identifier>${tms}</ows:Identifier>[\\s\\S]*?</TileMatrixSet>`))[0];
  const levels = [...setXml.matchAll(/<TileMatrix><ows:Identifier>(\d+)<\/ows:Identifier>[\s\S]*?<TopLeftCorner>([-\d.]+) ([-\d.]+)<\/TopLeftCorner><TileWidth>(\d+)<\/TileWidth><TileHeight>(\d+)<\/TileHeight><MatrixWidth>(\d+)<\/MatrixWidth><MatrixHeight>(\d+)<\/MatrixHeight>/g)]
    .map((m) => ({ z: +m[1], left: +m[2], top: +m[3], tw: +m[4], th: +m[5], mw: +m[6], mh: +m[7] }));
  const L = levels.reduce((a, b) => (b.z > a.z ? b : a));
  // Matrix width × tile width pixels span 360°; the matrix is padded past 90°S on the bottom.
  const pxDeg = 360 / (L.mw * L.tw);
  const cmapBuf = await cached(rawDir('gibs-landcover', path.basename(cmapUrl)), cmapUrl);
  const rgbClass = new Map();
  for (const m of cmapBuf.toString('utf8').matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)" transparent="false" sourceValue="([\d,]+)"/g)) {
    const vals = m[4].split(',').map(Number);
    rgbClass.set((+m[1] << 16) | (+m[2] << 8) | +m[3], vals.includes(17) ? 17 : vals[0]); // "0,17" = water
  }
  const tileDeg = pxDeg * L.tw;
  const r0 = Math.floor((L.top - BOX.north) / tileDeg), r1 = Math.floor((L.top - BOX.south) / tileDeg);
  const c0 = Math.floor((BOX.west - L.left) / tileDeg), c1 = Math.floor((BOX.east - L.left) / tileDeg);
  console.log(`GIBS ${LC_LAYER} ${date}: matrix set ${tms}, level ${L.z} (${(pxDeg * 3600).toFixed(1)}″ pixels), tiles rows ${r0}–${r1} cols ${c0}–${c1}`);
  let nTiles = 0;
  for (let tr = r0; tr <= r1; tr++) for (let tc = c0; tc <= c1; tc++) {
    const buf = await cached(rawDir('gibs-landcover', date, String(L.z), String(tr), `${tc}.png`),
      `${GIBS}/${LC_LAYER}/default/${date}/${tms}/${L.z}/${tr}/${tc}.png`);
    if (!buf) continue;
    nTiles++;
    const png = decodePalettePng(buf);
    const cls = new Int16Array(256).fill(-1); // palette index → IGBP class, -1 = no data
    for (let i = 0; i < png.plte.length / 3; i++) {
      if (png.trns && i < png.trns.length && png.trns[i] === 0) continue;
      cls[i] = rgbClass.get((png.plte[3 * i] << 16) | (png.plte[3 * i + 1] << 8) | png.plte[3 * i + 2]) ?? -1;
    }
    for (let y = 0; y < png.h; y++) {
      const lat = L.top - (tr * L.th + y + 0.5) * pxDeg;
      const row = Math.floor((BOX.north - lat) / dlat);
      if (row < 0 || row >= rows) continue;
      for (let x = 0; x < png.w; x++) {
        const lon = L.left + (tc * L.tw + x + 0.5) * pxDeg;
        const c = Math.floor((lon - BOX.west) / dlon);
        if (c < 0 || c >= cols) continue;
        const v = cls[png.idx[y * png.w + x]];
        if (v < 0 || v === 255) continue; // no data / unclassified
        const k = row * cols + c;
        lcN[k]++;
        if (v === 13) urbanN[k]++;
        if (v === 12 || v === 14) cropN[k]++;
        if (v === 16) barrenN[k]++;
        if (FOREST.has(v)) lcForestN[k]++;
        if (v === 17) lcWaterN[k]++;
      }
    }
  }
  console.log(`GIBS land cover: ${nTiles} tiles`);
  return nTiles ? `NASA MODIS MCD12Q1 land cover (IGBP, 500 m), ${date} — NASA GIBS layer ${LC_LAYER}` : null;
}
const lcSource = await gibsLandCover();
const haveNdvi = ndviN.some((x) => x > 0), haveLc = lcN.some((x) => x > 0);
console.log(`MODIS: NDVI ${haveNdvi ? 'ok' : 'missing'}, land cover ${haveLc ? 'ok' : 'missing'}`);

const cells = { i: [], elev: [], relief: [], slope: [], p90: [], shadow: [], land: [], ndvi: [], bare: [], urban: [], crop: [], barren: [], forest: [], water: [] };
for (let k = 0; k < N; k++) {
  if (!cnt[k] || land[k] / cnt[k] < 0.5) continue;
  let nS = 0;
  for (let b = 0; b < BINS; b++) nS += hist[k * BINS + b];
  if (!nS) continue;
  let acc = 0, p90 = 0;
  for (let b = 0; b < BINS; b++) { acc += hist[k * BINS + b]; if (acc >= 0.9 * nS) { p90 = (b + 1) * 2; break; } }
  cells.i.push(k);
  cells.elev.push(Math.round(sumZ[k] / land[k]));
  cells.relief.push(Math.round(maxZ[k] - minZ[k]));
  cells.slope.push(Math.round((sumS[k] / nS) * 10));
  cells.p90.push(p90 * 10);
  cells.shadow.push(Math.round((shadow[k] / nS) * 1000));
  cells.land.push(Math.round((land[k] / cnt[k]) * 100));
  // -1 = no MODIS value for this cell
  cells.ndvi.push(ndviN[k] ? Math.round((ndviSum[k] / ndviN[k]) * 1000) : -1);
  cells.bare.push(ndviN[k] ? Math.round((bareN[k] / ndviN[k]) * 1000) : -1);
  cells.urban.push(lcN[k] ? Math.round((urbanN[k] / lcN[k]) * 100) : -1);
  cells.crop.push(lcN[k] ? Math.round((cropN[k] / lcN[k]) * 100) : -1);
  cells.barren.push(lcN[k] ? Math.round((barrenN[k] / lcN[k]) * 100) : -1);
  cells.forest.push(lcN[k] ? Math.round((lcForestN[k] / lcN[k]) * 100) : -1);
  cells.water.push(lcN[k] ? Math.round((lcWaterN[k] / lcN[k]) * 100) : -1);
}
console.log(`land cells: ${cells.i.length}`);

// ---- 2. NASA POWER climatology on its native grid ----
const P = { dlat: 0.5, dlon: 0.625 };
P.lat0 = Math.ceil(BOX.north / P.dlat) * P.dlat; // north row centre
P.lon0 = Math.floor(BOX.west / P.dlon) * P.dlon; //  west col centre
P.rows = Math.round((P.lat0 - Math.floor(BOX.south / P.dlat) * P.dlat) / P.dlat) + 1;
P.cols = Math.round((Math.ceil(BOX.east / P.dlon) * P.dlon - P.lon0) / P.dlon) + 1;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pts = [];
for (let r = 0; r < P.rows; r++) for (let c = 0; c < P.cols; c++) pts.push([r, c, +(P.lat0 - r * P.dlat).toFixed(3), +(P.lon0 + c * P.dlon).toFixed(3)]);
console.log(`POWER: ${pts.length} grid points`);
const power = { ...P, elev: [], tmin: [], tmax: [], precip: [] };
const res = new Array(pts.length);
await pool(pts.map((p, k) => [k, p]), async ([k, [, , lat, lon]]) => {
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M_MIN,T2M_MAX,PRECTOTCORR&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;
  const buf = await cached(rawDir(`power/${lat}_${lon}.json`), url, { json: true });
  res[k] = buf ? JSON.parse(buf.toString('utf8')) : null;
});
for (const j of res) {
  const p = j?.properties?.parameter;
  const ok = p && p.T2M_MIN && p.T2M_MIN.JAN > -900;
  power.elev.push(ok ? Math.round(j.geometry.coordinates[2] ?? 0) : null);
  power.tmin.push(ok ? MONTHS.map((m) => +p.T2M_MIN[m].toFixed(1)) : null);
  power.tmax.push(ok ? MONTHS.map((m) => +p.T2M_MAX[m].toFixed(1)) : null);
  power.precip.push(ok ? Math.round(p.PRECTOTCORR.ANN * 365.25) : null);
}
const missing = power.tmin.filter((v) => v === null).length;
if (missing === pts.length) throw new Error('NASA POWER: no data (network?)');
console.log(`POWER points with data: ${pts.length - missing}`);

// ---- 3. write ----
const out = {
  version: 2, cell_km: CELL_KM, lat0, lon0, dlat, dlon, rows, cols,
  src: {
    dem: 'NASA NASADEM_HGT v001, 1 arc-second (via Microsoft Planetary Computer)',
    vegetation: `NASA MODIS MOD13A1 v061 NDVI 500 m, per-pixel maximum of the 16-day composites starting ${NDVI_FROM}…${NDVI_TO} (via Microsoft Planetary Computer)`,
    landcover: haveLc ? lcSource : null,
    climate: 'NASA POWER climatology T2M_MIN / T2M_MAX / PRECTOTCORR, MERRA-2 (https://power.larc.nasa.gov)',
    built: new Date().toISOString().slice(0, 10),
  },
  cells, power,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const s = JSON.stringify(out);
fs.writeFileSync(outFile, s);
console.log(`${path.relative(root, outFile)}: ${(s.length / 1024 / 1024).toFixed(1)} MB`);
