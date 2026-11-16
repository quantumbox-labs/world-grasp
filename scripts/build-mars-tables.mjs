// Mars tables for DuckDB, as parquet in web/public/data/mars/ (bundled, so the desktop app reads
// them offline; the web build reads only the columns and row groups a query needs over HTTP).
//   node scripts/build-mars-tables.mjs                  (mise run mars-tables)
//   node scripts/build-mars-tables.mjs --scale 100 --out <dir>   synthetic ×N copies for load tests
// Rows come from the Rust core (cargo example export_tables: same km as the engine), written with
// duckdb-wasm, sorted by the columns queries filter on, in small row groups so DuckDB can skip the
// rest from the min/max statistics:
//   rover_traverse/mission=<id>/data.parquet   one file per mission, sorted by sol, drive, seq
//   eva.parquet                                sorted by hours
//   manifest.json                              table → files, row counts, sources
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SCALE = Number(arg('--scale', '1'));
const OUT = path.resolve(arg('--out', path.join(root, 'web/public/data/mars')));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-tables-'));
execFileSync('cargo', ['run', '-q', '-p', 'analog-core', '--example', 'export_tables', '--', tmp], { cwd: root, stdio: 'inherit' });

const require = createRequire(path.join(root, 'web/package.json'));
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
const db = await duckdb.createDuckDB({
  mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
  eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
}, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
await db.instantiate();
const conn = db.connect();
const q = (sql) => conn.query(sql);

db.registerFileText('rover.csv', fs.readFileSync(path.join(tmp, 'rover_traverse.csv'), 'utf8'));
db.registerFileText('eva.csv', fs.readFileSync(path.join(tmp, 'eva.csv'), 'utf8'));
q(`CREATE TABLE rover AS SELECT * FROM read_csv('rover.csv', header = true, columns = {'mission': 'VARCHAR', 'drive': 'INTEGER', 'seq': 'INTEGER', 'sol': 'INTEGER', 'lat': 'DOUBLE', 'lon': 'DOUBLE', 'elev_m': 'DOUBLE', 'km': 'DOUBLE'})`);
q(`CREATE TABLE eva AS SELECT * FROM read_csv('eva.csv', header = true, columns = {'id': 'VARCHAR', 'country': 'VARCHAR', 'crew': 'VARCHAR', 'vehicle': 'VARCHAR', 'date': 'VARCHAR', 'hours': 'DOUBLE'})`);
if (SCALE > 1) {
  // Synthetic copies for load tests only: more missions (rover) and more EVAs, clearly marked.
  q(`CREATE TABLE r2 AS SELECT CASE WHEN k = 0 THEN mission ELSE 'synthetic_' || lpad(k::VARCHAR, 3, '0') END AS mission,
       drive, seq, sol + k * 3000 AS sol, lat, lon, elev_m, km FROM rover, range(${SCALE}) t(k)`);
  q(`DROP TABLE rover; ALTER TABLE r2 RENAME TO rover`);
  q(`CREATE TABLE e2 AS SELECT CASE WHEN k = 0 THEN id ELSE 'S' || k || '-' || id END AS id, country, crew, vehicle, date, hours FROM eva, range(${SCALE}) t(k)`);
  q(`DROP TABLE eva; ALTER TABLE e2 RENAME TO eva`);
}

fs.rmSync(path.join(OUT, 'rover_traverse'), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const write = (name, sql) => {
  // The Node runtime writes straight to the real file system.
  const file = path.join(OUT, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true }); // DuckDB would leave tmp_<name> next to an existing file
  q(`COPY (${sql}) TO '${file.replace(/'/g, "''")}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 2048)`);
  fs.chmodSync(file, 0o644);
  return fs.statSync(file).size;
};
const missions = q(`SELECT DISTINCT mission FROM rover ORDER BY mission`).toArray().map((r) => r.mission);
const roverFiles = [];
let bytes = 0;
for (const m of missions) {
  const f = `rover_traverse/mission=${m}/data.parquet`;
  // mission lives in the path (hive partition), so DuckDB skips other missions' files unopened.
  bytes += write(f, `SELECT * EXCLUDE (mission) FROM rover WHERE mission = '${m}' ORDER BY sol, drive, seq`);
  roverFiles.push(f);
}
const evaBytes = write('eva.parquet', `SELECT * FROM eva ORDER BY hours`);
const count = (t) => Number(q(`SELECT count(*) AS n FROM ${t}`).toArray()[0].n);
const manifest = {
  scale: SCALE,
  tables: {
    rover_traverse: {
      files: roverFiles, rows: count('rover'), bytes, hive: true,
      columns: ['mission', 'drive', 'seq', 'sol', 'lat', 'lon', 'elev_m', 'km'],
      source: { label: 'Mars 2020 Perseverance traverse (NASA/JPL MMGIS)', url: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json' },
      note: 'km: distance driven since the start of the record, as computed by analog-core traverse::points',
    },
    eva: {
      files: ['eva.parquet'], rows: count('eva'), bytes: evaBytes,
      columns: ['id', 'country', 'crew', 'vehicle', 'date', 'hours'],
      source: { label: 'data.nasa.gov: Extra-vehicular Activity (EVA) - US and Russia', url: 'https://data.nasa.gov/docs/legacy/Extra-vehicular_Activity_EVA_-_US_and_Russia/Extra-vehicular_Activity_EVA_-_US_and_Russia_rows.csv' },
    },
  },
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${OUT}: rover_traverse ${manifest.tables.rover_traverse.rows} rows in ${roverFiles.length} file(s), ${(bytes / 1024).toFixed(0)} KB; eva ${manifest.tables.eva.rows} rows, ${(evaBytes / 1024).toFixed(0)} KB`);
