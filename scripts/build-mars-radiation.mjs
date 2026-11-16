// DuckDB table mars_radiation: the radiation figures the Rust core uses (radiation.rs), printed by
// the cargo example radiation_table, as web/public/data/mars/mars_radiation.parquet (+ manifest).
//   node scripts/build-mars-radiation.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const csv = execFileSync('cargo', ['run', '-q', '-p', 'analog-core', '--example', 'radiation_table'], { cwd: root, encoding: 'utf8' });
const require = createRequire(path.join(root, 'web/package.json'));
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
const db = await duckdb.createDuckDB({
  mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
  eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
}, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
await db.instantiate();
const conn = db.connect();
db.registerFileText('rad.csv', csv);
conn.query(`CREATE TABLE r AS SELECT * FROM read_csv('rad.csv', header = true, quote = '"', columns = {quantity: 'VARCHAR', value: 'DOUBLE', sigma: 'DOUBLE', unit: 'VARCHAR', source: 'VARCHAR'})`);
const out = path.join(root, 'web/public/data/mars/mars_radiation.parquet');
fs.rmSync(out, { force: true });
conn.query(`COPY r TO '${out}' (FORMAT parquet)`);
fs.chmodSync(out, 0o644);
const mf = path.join(root, 'web/public/data/mars/manifest.json');
const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
m.tables.mars_radiation = {
  files: ['mars_radiation.parquet'], rows: Number(conn.query('SELECT count(*) AS n FROM r').toArray()[0].n), bytes: fs.statSync(out).size,
  columns: ['quantity', 'value', 'sigma', 'unit', 'source'],
  source: { label: 'Curiosity RAD surface dose rates (Hassler et al. 2014, Science); NASA-STD-3001 limits', url: 'https://doi.org/10.1126/science.1244797' },
  note: 'The figures analog-core radiation.rs uses: EVA dose = surface_dose_equivalent_rate × hours / 24',
};
fs.writeFileSync(mf, JSON.stringify(m, null, 1));
console.log(`mars_radiation: ${m.tables.mars_radiation.rows} rows`);
