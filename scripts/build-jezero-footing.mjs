// Footing data for the Jezero elevation grid (web/public/data/jezero_dem.json, same rows / cols):
//   web/public/data/jezero_footing.json    thermal inertia + dust cover index per cell (the Rust
//                                          core turns them into the footing factor, footing.rs)
//   web/public/data/mars/mars_footing.parquet   DuckDB table mars_footing (+ manifest entry)
// Sources:
//   THEMIS quantitative thermal inertia 100 m global mosaic (Mars Odyssey THEMIS, ASU), read as
//   raw 32-bit values from the ASU map server for exactly the grid's bounds
//   TES Dust Cover Index (Ruff & Christensen 2002, JGR 107(E12) 5127), 16 px/°, ASU
//   node scripts/build-jezero-footing.mjs [--dci dci_lo_ice_dust_16ppd_shifted.pds]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dem = JSON.parse(fs.readFileSync(path.join(root, 'web/public/data/jezero_dem.json'), 'utf8'));
const { rows, cols, lat0, lon0, dlat, dlon } = dem;
const north = lat0 + dlat / 2, west = lon0 - dlon / 2, south = north - rows * dlat, east = west + cols * dlon;

// THEMIS thermal inertia: WMS GetMap in VICAR (raw REAL, little-endian), one pixel per grid cell.
const TI_URL = `http://ms-mars.mars.asu.edu/thm_ti_100m_32bit?SERVICE=WMS&REQUEST=GetMap&FORMAT=image/vicar&WIDTH=${cols}&HEIGHT=${rows}&SRS=JMARS:4&BBOX=${west},${south},${east},${north}&STYLES=&VERSION=1.1.1&LAYERS=thm_ti_100m_32bit`;
const vic = Buffer.from(await (await fetch(TI_URL)).arrayBuffer());
const lbl = Number(vic.toString('latin1', 0, 40).match(/LBLSIZE=(\d+)/)[1]);
const head = vic.toString('latin1', 0, lbl);
if (!/FORMAT='REAL'/.test(head) || !/INTFMT='LOW'/.test(head) || !head.includes(`NL=${rows}`) || !head.includes(`NS=${cols}`)) throw new Error(`unexpected VICAR label: ${head.slice(0, 300)}`);
const ti = [];
for (let i = 0; i < rows * cols; i++) {
  const v = vic.readFloatLE(lbl + 4 * i);
  ti.push(Number.isFinite(v) && v > 0 && v < 5000 ? Math.round(v) : null);
}

// TES Dust Cover Index: PDS qube 5760 × 2880 float32 (LE), 16 px/°, lines from 90°N, samples
// from 180°W ("shifted"), data after 2 label records of 512 bytes. Nearest DCI pixel per cell.
let dciFile = arg('--dci');
if (!dciFile) {
  dciFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dci-')), 'dci.pds');
  const r = await fetch('https://www.mars.asu.edu/~ruff/DCI/dci_lo_ice_dust_16ppd_shifted.pds');
  if (!r.ok) throw new Error(`DCI: HTTP ${r.status}`);
  fs.writeFileSync(dciFile, Buffer.from(await r.arrayBuffer()));
}
const fd = fs.openSync(dciFile, 'r');
const label = Buffer.alloc(1024); fs.readSync(fd, label, 0, 1024, 0);
if (!/CORE_ITEMS\s*=\s*\(1,5760,2880\)/.test(label.toString('latin1')) || !/PC_REAL/.test(label.toString('latin1'))) throw new Error('unexpected DCI label');
const W = 5760, PPD = 16, OFF = 1024, cache = new Map();
const dciAt = (lat, lon) => {
  const r = Math.min(2879, Math.floor((90 - lat) * PPD)), c = Math.min(W - 1, Math.floor((lon + 180) * PPD));
  const k = r * W + c;
  if (!cache.has(k)) { const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, OFF + 4 * k); cache.set(k, b.readFloatLE(0)); }
  const v = cache.get(k);
  return Number.isFinite(v) && v > 0.5 && v < 1.1 ? Math.round(v * 1000) / 1000 : null;
};
const dci = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) dci.push(dciAt(lat0 - r * dlat, lon0 + c * dlon));

const src = 'Thermal inertia: Mars Odyssey THEMIS quantitative thermal inertia 100 m global mosaic (NASA/ASU, ms-mars.mars.asu.edu thm_ti_100m_32bit), J m-2 K-1 s-1/2. Dust: MGS TES Dust Cover Index 16 ppd (Ruff & Christensen 2002, JGR 107(E12) 5127).';
fs.writeFileSync(path.join(root, 'web/public/data/jezero_footing.json'), JSON.stringify({ rows, cols, ti, dci, src }));

// DuckDB table: one row per cell with its centre, thermal inertia and dust cover index.
const require = createRequire(path.join(root, 'web/package.json'));
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
const db = await duckdb.createDuckDB({
  mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
  eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
}, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
await db.instantiate();
const conn = db.connect();
const lines = ['lat,lon,thermal_inertia,dust_cover_index'];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const i = r * cols + c;
  lines.push(`${(lat0 - r * dlat).toFixed(5)},${(lon0 + c * dlon).toFixed(5)},${ti[i] ?? ''},${dci[i] ?? ''}`);
}
db.registerFileText('foot.csv', lines.join('\n'));
conn.query(`CREATE TABLE f AS SELECT * FROM read_csv('foot.csv', header = true, columns = {lat: 'DOUBLE', lon: 'DOUBLE', thermal_inertia: 'SMALLINT', dust_cover_index: 'FLOAT'})`);
const out = path.join(root, 'web/public/data/mars/mars_footing.parquet');
fs.rmSync(out, { force: true });
conn.query(`COPY (SELECT * FROM f ORDER BY lat, lon) TO '${out}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 16384)`);
fs.chmodSync(out, 0o644);
const mf = path.join(root, 'web/public/data/mars/manifest.json');
const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
manifest.tables.mars_footing = {
  files: ['mars_footing.parquet'], rows: rows * cols, bytes: fs.statSync(out).size,
  columns: ['lat', 'lon', 'thermal_inertia', 'dust_cover_index'],
  source: { label: 'Mars Odyssey THEMIS thermal inertia 100 m (NASA/ASU); MGS TES Dust Cover Index (Ruff & Christensen 2002)', url: 'https://www.mars.asu.edu/data/' },
  note: 'Jezero elevation-grid cells (0.0006°). thermal_inertia in J m-2 K-1 s-1/2: ≤150 loose fines/sand, ≥400 rock/duricrust/bedrock (Putzig & Mellon 2007). dust_cover_index < 0.94 dust-mantled (Ruff & Christensen 2002)',
};
fs.writeFileSync(mf, JSON.stringify(manifest, null, 1));
const nTi = ti.filter((x) => x != null).length, nD = dci.filter((x) => x != null).length;
console.log(`footing: ${rows}×${cols}, thermal inertia ${nTi} cells, DCI ${nD} cells; parquet ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
