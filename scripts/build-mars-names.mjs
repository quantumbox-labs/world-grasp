// Mars gazetteer for DuckDB and the globe: web/public/data/mars/mars_names.parquet (+ a manifest
// entry) and web/public/data/globe/mars_names.json (compact, for drawing labels offline).
//   node scripts/build-mars-names.mjs [--zip MARS_nomenclature_center_pts.zip]
// Rows:
//   kind = 'feature'   every IAU-named Mars feature (USGS Gazetteer of Planetary Nomenclature)
//   kind = 'landing'   landers and rovers that reached the surface (data/missions.json)
//   kind = 'crewed'    crewed-landing candidate areas named in docs/data/analogs-moon-mars.md
//                      (NASA First Landing Site / Exploration Zone workshop, 2015); coordinates
//                      are the IAU feature centres
// Longitudes are east, −180..180 (the app's convention); the IAU file has 0..360 E.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ZIP = 'https://planetarynames.wr.usgs.gov/shapefiles/MARS_nomenclature_center_pts.zip';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-names-'));
let zip = arg('--zip');
if (!zip) {
  zip = path.join(tmp, 'n.zip');
  const r = await fetch(URL_ZIP);
  if (!r.ok) throw new Error(`${URL_ZIP}: HTTP ${r.status}`);
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
}
execFileSync('unzip', ['-o', '-q', zip, '-d', tmp]);
const dbf = fs.readdirSync(tmp).find((f) => f.endsWith('.dbf'));

/** dBASE III reader (the attribute table of the shapefile). */
function readDbf(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(4), hlen = b.readUInt16LE(8), rlen = b.readUInt16LE(10);
  const fields = [];
  for (let o = 32; b[o] !== 0x0d; o += 32) fields.push({ name: b.toString('latin1', o, o + 11).replace(/\0.*$/, ''), type: String.fromCharCode(b[o + 11]), len: b[o + 16] });
  const rows = [];
  for (let i = 0; i < n; i++) {
    const s = hlen + i * rlen;
    if (b[s] === 0x2a) continue; // deleted
    let o = s + 1; const r = {};
    for (const f of fields) {
      const v = b.toString('utf8', o, o + f.len).trim();
      r[f.name] = f.type === 'N' || f.type === 'F' ? (v === '' ? null : Number(v)) : v;
      o += f.len;
    }
    rows.push(r);
  }
  return rows;
}
const east = (lon) => Math.round((lon > 180 ? lon - 360 : lon) * 1e4) / 1e4;
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const iau = readDbf(path.join(tmp, dbf)).filter((r) => r.approval !== 'Dropped, disallowed');
const SRC_IAU = 'IAU/USGS Gazetteer of Planetary Nomenclature';
const rows = iau.map((r) => ({
  name: r.clean_name || r.name, kind: 'feature', type: r.type.split(',')[0].trim(),
  lat: r4(r.center_lat), lon: east(r.center_lon), diameter_km: r4(r.diameter),
  origin: r.origin, year: r.approvaldt ? Number(r.approvaldt.slice(0, 4)) : null, agency: null,
  link: r.link.replace(/^http:/, 'https:'), source: SRC_IAU,
}));

const missions = JSON.parse(fs.readFileSync(path.join(root, 'data/missions.json'), 'utf8'));
for (const m of missions.landings.mars) {
  rows.push({ name: m.name, kind: 'landing', type: 'Landing site', lat: m.lat, lon: m.lon, diameter_km: null,
    origin: `${m.agency} lander/rover, ${m.year}`, year: m.year, agency: m.agency, link: null, source: 'data/missions.json (NASA/CNSA mission pages)' });
}
// Crewed-landing candidate areas (docs/data/analogs-moon-mars.md §2), at their IAU centres.
const CREWED = ['Arcadia Planitia', 'Erebus Montes', 'Deuteronilus Mensae', 'Protonilus Mensae', 'Phlegra Montes', 'Hebrus Valles', 'Jezero', 'Gale'];
for (const nm of CREWED) {
  const f = rows.find((r) => r.kind === 'feature' && r.name === nm);
  if (!f) throw new Error(`crewed candidate ${nm} not in the IAU list`);
  rows.push({ ...f, kind: 'crewed', type: 'Crewed landing candidate', origin: 'NASA First Landing Site / Exploration Zone workshop (2015)',
    link: 'https://www.nasa.gov/journeytomars/mars-exploration-zones', source: `${SRC_IAU} (centre); NASA Exploration Zones` });
}

const require = createRequire(path.join(root, 'web/package.json'));
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
const db = await duckdb.createDuckDB({
  mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
  eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
}, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
await db.instantiate();
const conn = db.connect();
// CSV (built into DuckDB; JSON would need an extension download).
const COLS = ['name', 'kind', 'type', 'lat', 'lon', 'diameter_km', 'origin', 'year', 'agency', 'link', 'source'];
const cell = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
db.registerFileText('names.csv', [COLS.join(','), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(','))].join('\n'));
conn.query(`CREATE TABLE n AS SELECT * FROM read_csv('names.csv', header = true, quote = '"', escape = '"', columns = {name: 'VARCHAR', kind: 'VARCHAR', type: 'VARCHAR', lat: 'DOUBLE', lon: 'DOUBLE', diameter_km: 'DOUBLE', origin: 'VARCHAR', year: 'INTEGER', agency: 'VARCHAR', link: 'VARCHAR', source: 'VARCHAR'})`);
const OUT = path.join(root, 'web/public/data/mars');
const file = path.join(OUT, 'mars_names.parquet');
fs.rmSync(file, { force: true });
conn.query(`COPY (SELECT * FROM n ORDER BY kind, diameter_km DESC NULLS LAST, name) TO '${file}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 2048)`);
fs.chmodSync(file, 0o644);
const bytes = fs.statSync(file).size;

const mf = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
manifest.tables.mars_names = {
  files: ['mars_names.parquet'], rows: rows.length, bytes,
  columns: COLS,
  source: { label: 'IAU/USGS Gazetteer of Planetary Nomenclature (Mars); landing sites; NASA crewed-landing Exploration Zones', url: 'https://planetarynames.wr.usgs.gov/Page/MARS/target' },
  note: "kind: feature (IAU name), landing (lander/rover), crewed (crewed-landing candidate). lon: degrees east, -180..180. diameter_km: IAU feature size",
};
fs.writeFileSync(mf, JSON.stringify(manifest, null, 1));

// Compact copy for the globe labels: [name, kind, type, lat, lon, diameter_km, origin, link].
const globe = rows.map((r) => [r.name, r.kind, r.type, r.lat, r.lon, r.diameter_km, r.origin, r.link]);
fs.writeFileSync(path.join(root, 'web/public/data/globe/mars_names.json'), JSON.stringify(globe));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`mars_names: ${rows.length} rows (${iau.length} IAU, ${missions.landings.mars.length} landings, ${CREWED.length} crewed), parquet ${(bytes / 1024).toFixed(0)} KB`);
