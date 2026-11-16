// Jezero air temperature and pressure by local solar hour, from Perseverance MEDA (NASA PDS):
//   web/public/data/mars/mars_weather.parquet   DuckDB table mars_weather (+ manifest entry):
//                                               one row per sampled sol and local true solar hour
//   web/public/data/jezero_weather.json         hourly means over the sampled sols (the Rust core
//                                               uses them for the cooling water, weather.rs)
// Source: Mars 2020 MEDA calibrated data (PDS Atmospheres node, mars2020_meda bundle):
//   CAL_ATS  air temperature sensors (5 thermocouples on two masts, K) → median of the five
//   CAL_PS   pressure (BAROCAP3, Pa; the derived product is based on barocap 3)
// About 15 sols spread over one Mars year (669 sols) are sampled.
//   node scripts/build-mars-weather.mjs [--cache dir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CACHE = arg('--cache', fs.mkdtempSync(path.join(os.tmpdir(), 'meda-')));
fs.mkdirSync(CACHE, { recursive: true });
const BASE = 'https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env';
const links = async (url) => [...(await (await fetch(url)).text()).matchAll(/href="([^"?#/]+)\/?"/g)].map((m) => m[1]);
const ranges = (await links(`${BASE}/`)).filter((d) => /^sol_\d{4}_\d{4}$/.test(d));
const solDir = new Map();
for (const r of ranges) {
  const [a, b] = r.slice(4).split('_').map(Number);
  for (let s = a; s <= b; s++) solDir.set(s, r);
}
// Targets every ~45 sols over the first Mars year; take the nearest sol that has both files.
const targets = Array.from({ length: 15 }, (_, i) => 20 + i * 45);
const pad = (s) => String(s).padStart(4, '0');
async function get(s, kind) {
  const f = path.join(CACHE, `${pad(s)}_${kind}.csv`);
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) return fs.readFileSync(f, 'utf8');
  // File versions differ by sol (P01, P02, …): take the newest one listed for this sensor.
  const dir = `${BASE}/${solDir.get(s)}/sol_${pad(s)}/`;
  const names = (await (await fetch(dir)).text()).match(new RegExp(`WE__${pad(s)}_+CAL_${kind}_+P\\d+\\.CSV`, 'g'));
  if (!names?.length) return null;
  const r = await fetch(dir + names.sort().at(-1));
  if (!r.ok) return null;
  const t = await r.text();
  fs.writeFileSync(f, t);
  return t;
}
const rows = [];
const median = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
for (const target of targets) {
  let sol = null, ats = null, ps = null;
  for (const d of [0, 1, -1, 2, -2, 3, -3, 5, -5]) {
    const s = target + d;
    if (!solDir.has(s)) continue;
    ats = await get(s, 'ATS'); ps = ats && await get(s, 'PS');
    if (ats && ps) { sol = s; break; }
  }
  if (sol == null) { console.warn('no data near sol', target); continue; }
  // Bin by local true solar hour (LTST "SSSS HH:MM:SS").
  const bins = Array.from({ length: 24 }, () => ({ t: [], p: [] }));
  const hourOf = (ltst) => Number(ltst.split(' ')[1]?.slice(0, 2));
  for (const line of ats.split('\n').slice(1)) {
    const c = line.split(',');
    if (c.length < 8) continue;
    const h = hourOf(c[2]), v = median(c.slice(3, 8).map((x) => (x === '' ? NaN : Number(x))));
    if (h >= 0 && h < 24 && v > 120 && v < 320) bins[h].t.push(v);
  }
  const hdr = ps.split('\n')[0].split(',');
  const pi = hdr.indexOf('BAROCAP3_PRESSURE');
  for (const line of ps.split('\n').slice(1)) {
    const c = line.split(',');
    const h = hourOf(c[2] ?? ''), v = Number(c[pi]);
    if (h >= 0 && h < 24 && v > 300 && v < 1300) bins[h].p.push(v);
  }
  bins.forEach((b, h) => {
    if (!b.t.length && !b.p.length) return;
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    rows.push({ sol, ltst_hour: h, air_temp_k: mean(b.t), pressure_pa: mean(b.p), samples: b.t.length });
  });
  console.log(`sol ${sol}: ${bins.filter((b) => b.t.length).length} hours with temperature`);
}

// Hourly climatology over the sampled sols (mean of the per-sol means), for the Rust core.
const hours = Array.from({ length: 24 }, (_, h) => {
  const t = rows.filter((r) => r.ltst_hour === h && r.air_temp_k != null).map((r) => r.air_temp_k);
  const p = rows.filter((r) => r.ltst_hour === h && r.pressure_pa != null).map((r) => r.pressure_pa);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { hour: h, air_temp_k: mean(t) && Math.round(mean(t) * 10) / 10, pressure_pa: mean(p) && Math.round(mean(p) * 10) / 10, sols: t.length };
});
const sols = [...new Set(rows.map((r) => r.sol))];
const src = `Mars 2020 MEDA calibrated air temperature (ATS, median of 5 sensors) and pressure (BAROCAP3), NASA PDS Atmospheres node mars2020_meda; ${sols.length} sols over one Mars year (sols ${sols.join(', ')}), hourly means by local true solar time`;
fs.writeFileSync(path.join(root, 'web/public/data/jezero_weather.json'), JSON.stringify({ hours, sols, src }, null, 1));

const require = createRequire(path.join(root, 'web/package.json'));
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
const db = await duckdb.createDuckDB({
  mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
  eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
}, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
await db.instantiate();
const conn = db.connect();
db.registerFileText('w.csv', ['sol,ltst_hour,air_temp_k,pressure_pa,samples', ...rows.map((r) => `${r.sol},${r.ltst_hour},${r.air_temp_k?.toFixed(2) ?? ''},${r.pressure_pa?.toFixed(2) ?? ''},${r.samples}`)].join('\n'));
conn.query(`CREATE TABLE w AS SELECT * FROM read_csv('w.csv', header = true, columns = {sol: 'INTEGER', ltst_hour: 'INTEGER', air_temp_k: 'DOUBLE', pressure_pa: 'DOUBLE', samples: 'INTEGER'})`);
const out = path.join(root, 'web/public/data/mars/mars_weather.parquet');
fs.rmSync(out, { force: true });
conn.query(`COPY (SELECT * FROM w ORDER BY sol, ltst_hour) TO '${out}' (FORMAT parquet)`);
fs.chmodSync(out, 0o644);
const mf = path.join(root, 'web/public/data/mars/manifest.json');
const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
m.tables.mars_weather = {
  files: ['mars_weather.parquet'], rows: rows.length, bytes: fs.statSync(out).size,
  columns: ['sol', 'ltst_hour', 'air_temp_k', 'pressure_pa', 'samples'],
  source: { label: 'Mars 2020 MEDA calibrated air temperature (ATS) and pressure (BAROCAP3), NASA PDS', url: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html' },
  note: `Jezero crater, hourly means by local true solar time for ${sols.length} sols over one Mars year. air_temp_k: median of the 5 ATS sensors; pressure_pa: BAROCAP3`,
};
fs.writeFileSync(mf, JSON.stringify(m, null, 1));
console.log(`mars_weather: ${rows.length} rows from ${sols.length} sols`);
console.log(hours.map((h) => `${h.hour}h ${h.air_temp_k}K ${h.pressure_pa}Pa`).join(' | '));
