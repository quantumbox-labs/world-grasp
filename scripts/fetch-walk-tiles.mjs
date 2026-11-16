// Downloads the map tiles WALKBACK needs into web/public/tiles/ so the desktop app works offline.
//   node scripts/fetch-walk-tiles.mjs [--dry]     (mise run walk-tiles)
// The app's tile layers try ./tiles/<id>/{z}/{y}/{x}.<ext> first and fall back to the network
// (web/src/layers.ts). Re-running skips tiles that are already on disk.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'web/public/tiles');
const dry = process.argv.includes('--dry');

// Equirectangular (Trek EQ, Leaflet EPSG4326): level z has 2^(z+1) × 2^z tiles of 180/2^z degrees.
const eqRange = (z, s, w, n, e) => {
  const d = 180 / 2 ** z;
  return { x0: Math.floor((w + 180) / d), x1: Math.floor((e + 180) / d), y0: Math.floor((90 - n) / d), y1: Math.floor((90 - s) / d) };
};
// Web Mercator (GSI): level z has 2^z × 2^z tiles.
const mercRange = (z, s, w, n, e) => {
  const t = (lat, lon) => {
    const k = 2 ** z, sn = Math.sin((lat * Math.PI) / 180);
    return [Math.floor(((lon + 180) / 360) * k), Math.floor((0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * k)];
  };
  const [x0, y0] = t(n, w), [x1, y1] = t(s, e);
  return { x0, x1, y0, y1 };
};

const JEZ = [18.30, 77.20, 18.58, 77.62];        // whole Jezero grid
const NEAR = [18.39, 77.36, 18.50, 77.48];       // landing site + example route
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
const jobs = [];
const eq = (id, url, ext, zs, box) => { for (const z of zs) jobs.push({ id, z, r: eqRange(z, ...box), url, ext }); };
eq('mars-hirise', `${TREK}/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm`, 'png', [9, 10, 11, 12, 13], JEZ);
eq('mars-hirise', `${TREK}/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm`, 'png', [14, 15], NEAR);
eq('mars-viking', `${TREK}/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm`, 'jpg', [3, 4, 5, 6, 7], JEZ);
eq('mars-themis', `${TREK}/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm`, 'png', [6, 7, 8, 9], JEZ);
eq('mars-mola', `${TREK}/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm`, 'jpg', [3, 4, 5, 6, 7], JEZ);

// Hokkaido: GSI aerial photo around each #10 candidate site (for the rehearsal map).
const sites = JSON.parse(fs.readFileSync(path.join(root, 'data/earth-metrics.json'), 'utf8')).filter((s) => s.id !== 'sapporo');
for (const s of sites) {
  const box = [s.lat - 0.09, s.lon - 0.12, s.lat + 0.09, s.lon + 0.12];
  for (const z of [10, 11, 12, 13, 14]) jobs.push({ id: 'earth-gsiphoto', z, r: mercRange(z, ...box), url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto', ext: 'jpg', xy: true });
}

// Walk areas for imported GPX walks (#11 A, web/public/data/walks/index.json): aerial photo for the
// Hokkaido side of the replay. z16 only near the centre to keep the download small.
const walkIndex = path.join(root, 'web/public/data/walks/index.json');
if (fs.existsSync(walkIndex)) {
  for (const a of JSON.parse(fs.readFileSync(walkIndex, 'utf8'))) {
    const n = a.lat0 + a.dlat / 2, w = a.lon0 - a.dlon / 2, south = n - a.rows * a.dlat, east = w + a.cols * a.dlon;
    for (const z of [11, 12, 13, 14, 15]) jobs.push({ id: 'earth-gsiphoto', z, r: mercRange(z, south, w, n, east), url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto', ext: 'jpg', xy: true });
    const cy = (n + south) / 2, cx = (w + east) / 2;
    jobs.push({ id: 'earth-gsiphoto', z: 16, r: mercRange(16, cy - 0.03, cx - 0.04, cy + 0.03, cx + 0.04), url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto', ext: 'jpg', xy: true });
  }
}

const tiles = [];
const seen = new Set();
for (const j of jobs) for (let y = j.r.y0; y <= j.r.y1; y++) for (let x = j.r.x0; x <= j.r.x1; x++) {
  const rel = `${j.id}/${j.z}/${y}/${x}.${j.ext}`;
  if (seen.has(rel)) continue;
  seen.add(rel);
  tiles.push({ rel, src: j.xy ? `${j.url}/${j.z}/${x}/${y}.${j.ext}` : `${j.url}/${j.z}/${y}/${x}.${j.ext}` });
}
const byLayer = {};
for (const t of tiles) byLayer[t.rel.split('/')[0]] = (byLayer[t.rel.split('/')[0]] ?? 0) + 1;
console.log('tiles to have:', byLayer, 'total', tiles.length);
if (dry) process.exit(0);

let done = 0, got = 0, missing = 0, bytes = 0;
const queue = tiles.filter((t) => !fs.existsSync(path.join(out, t.rel)));
async function worker() {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    try {
      const r = await fetch(t.src);
      if (r.ok) {
        const b = Buffer.from(await r.arrayBuffer());
        fs.mkdirSync(path.dirname(path.join(out, t.rel)), { recursive: true });
        fs.writeFileSync(path.join(out, t.rel), b);
        got++; bytes += b.length;
      } else missing++;
    } catch { missing++; }
    if (++done % 200 === 0) console.log(`${done}/${tiles.length} …`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`downloaded ${got} (${(bytes / 1e6).toFixed(1)} MB), not available ${missing}, already had ${tiles.length - done}`);
