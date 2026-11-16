// DuckDB-WASM over the whole-Hokkaido scan, for data exploration and agent tools.
// Engine files: Tauri (and e2e) bundle the "eh" build from node_modules (Vite `?url`) so the app
// works offline; the web build fetches the engine from jsDelivr, because the 33 MB wasm is over
// Cloudflare Pages' 25 MiB per-file limit. __DUCKDB_LOCAL__ is a build-time constant (vite.config.ts),
// so the web build drops the local imports and the wasm never lands in web/dist. Every number in these tables comes from the Rust core: cell
// values from `scanColumns()`, match scores from `scan.scores()` (the same formula as the map).
//   cells   (k, lat, lon, elev_m, relief_m, slope_deg, slope_p90_deg, shadow, ndvi, urban, crop,
//            forest, water, barren, tmin_jan_c, tmax_aug_c, precip_mm, screened)
//   sites   (earth_id, name_en, name_ja, lat, lon)            the 14 known sites
//   targets (body_id, world, name_en, name_ja, lat, tmin_k, tmax_k, slope_deg)
//   tests   (id, name_en, name_ja, season_en, season_ja)
//   score_<body>_<test> (k, score, excluded)                  created by ensureScores
//   scan    view: cells ⨝ the score table of the last ensureScores pair
import * as duckdb from '@duckdb/duckdb-wasm';
import type { Core, Scan } from './core';
import { scanColumns } from './wasm/analog_wasm.js';

export type Row = Record<string, string | number | boolean | null>;

export interface Db {
  scan: Scan;
  query: (sql: string) => Promise<Row[]>;
  /** Create score_<body>_<test> once and point the `scan` view at it. Returns the table name. */
  ensureScores: (body: string, test: string) => Promise<string>;
  /**
   * (#11) A view over bundled parquet files (paths relative to the page). The web build reads
   * them over HTTP with range requests (only the columns and row groups a query needs); the
   * desktop app reads the bundled files whole.
   */
  attachParquet: (view: string, files: string[], opts?: { hive?: boolean; base?: string }) => Promise<void>;
}

const CELL_COLS: [string, string][] = [
  ['k', 'INTEGER'], ['lat', 'DOUBLE'], ['lon', 'DOUBLE'], ['elev_m', 'DOUBLE'], ['relief_m', 'DOUBLE'],
  ['slope_deg', 'DOUBLE'], ['slope_p90_deg', 'DOUBLE'], ['shadow', 'DOUBLE'], ['ndvi', 'DOUBLE'],
  ['urban', 'DOUBLE'], ['crop', 'DOUBLE'], ['forest', 'DOUBLE'], ['water', 'DOUBLE'], ['barren', 'DOUBLE'],
  ['tmin_jan_c', 'DOUBLE'], ['tmax_aug_c', 'DOUBLE'], ['precip_mm', 'DOUBLE'], ['screened', 'VARCHAR'],
];
export const CELL_COLUMNS = CELL_COLS.map(([c]) => c);

const cell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
  return String(v);
};
const toCsv = (cols: string[], rows: unknown[][]) =>
  [cols.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');

/** Identifier-safe body/test id (ids come from the core's own lists). */
const ident = (s: string) => {
  if (!/^[a-z0-9_]+$/.test(s)) throw new Error(`bad id: ${s}`);
  return s;
};

declare const __DUCKDB_LOCAL__: boolean;

async function engine(): Promise<{ worker: Worker; wasm: string }> {
  if (__DUCKDB_LOCAL__) {
    const [{ default: wasm }, { default: workerUrl }] = await Promise.all([
      import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'),
    ]);
    return { worker: new Worker(workerUrl), wasm };
  }
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // A cross-origin script can't be a Worker directly; a same-origin Blob that importScripts it can.
  const blob = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
  const worker = new Worker(blob);
  URL.revokeObjectURL(blob);
  return { worker, wasm: bundle.mainModule };
}

let dbPromise: Promise<Db> | null = null;

export function openDb(core: Core): Promise<Db> {
  dbPromise ??= open(core);
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function open(core: Core): Promise<Db> {
  const scan = await core.loadScan(1);
  const { worker, wasm } = await engine();
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(wasm);
  const conn = await db.connect();

  const query = async (sql: string): Promise<Row[]> => {
    const t = await conn.query(sql);
    return t.toArray().map((r) => {
      const o = r.toJSON() as Record<string, unknown>;
      for (const key in o) if (typeof o[key] === 'bigint') o[key] = Number(o[key]);
      return o as Row;
    });
  };
  const load = async (table: string, cols: [string, string][], rows: unknown[][]) => {
    const file = `${table}.csv`;
    await db.registerFileText(file, toCsv(cols.map(([c]) => c), rows));
    const types = cols.map(([c, ty]) => `'${c}': '${ty}'`).join(', ');
    await conn.query(`CREATE OR REPLACE TABLE ${table} AS SELECT * FROM read_csv('${file}', header = true, columns = {${types}})`);
    await db.dropFile(file);
  };

  const c = JSON.parse(scanColumns()) as Record<string, unknown[]>;
  await load('cells', CELL_COLS, c.k.map((_, i) => CELL_COLUMNS.map((name) => c[name][i])));
  await load('sites', [['earth_id', 'VARCHAR'], ['name_en', 'VARCHAR'], ['name_ja', 'VARCHAR'], ['lat', 'DOUBLE'], ['lon', 'DOUBLE']],
    core.earthSites.map((e) => [e.id, e.en ?? e.name, e.name, e.lat, e.lon]));
  await load('targets', [['body_id', 'VARCHAR'], ['world', 'VARCHAR'], ['name_en', 'VARCHAR'], ['name_ja', 'VARCHAR'],
    ['lat', 'DOUBLE'], ['tmin_k', 'DOUBLE'], ['tmax_k', 'DOUBLE'], ['slope_deg', 'DOUBLE']],
    core.bodies.map((b) => [b.id, b.world, b.name, b.ja, b.lat, b.tmin, b.tmax, b.slope_mean_deg]));
  await load('tests', [['id', 'VARCHAR'], ['name_en', 'VARCHAR'], ['name_ja', 'VARCHAR'], ['season_en', 'VARCHAR'], ['season_ja', 'VARCHAR']],
    core.profiles.filter((p) => p.test).map((p) => [p.id, p.en, p.label, p.season_en, p.season]));

  const screened = c.screened as (string | null)[];
  const made = new Map<string, Promise<void>>();
  let current = '';
  const ensureScores = async (body: string, test: string) => {
    if (!core.bodies.some((b) => b.id === body)) throw new Error(`unknown target ${body}`);
    if (!core.profiles.some((p) => p.test && p.id === test)) throw new Error(`unknown test ${test}`);
    const table = `score_${ident(body)}_${ident(test)}`;
    if (!made.has(table)) {
      made.set(table, (async () => {
        const s = scan.scores(body, test);
        await load(table, [['k', 'INTEGER'], ['score', 'DOUBLE'], ['excluded', 'BOOLEAN']],
          Array.from(s, (v, k) => [k, v, screened[k] !== null]));
      })());
    }
    await made.get(table);
    if (current !== table) {
      await conn.query(`CREATE OR REPLACE VIEW scan AS SELECT c.*, s.score, s.excluded FROM cells c JOIN ${table} s USING (k)`);
      current = table;
    }
    return table;
  };

  // DuckDB-wasm autoloads its parquet extension from extensions.duckdb.org; serve the bundled copy
  // (web/public/duckdb-ext/<version>/wasm_eh/) instead, so it also works offline in the desktop app.
  let parquet: Promise<void> | null = null;
  const parquetReady = () => (parquet ??= conn.query(`SET custom_extension_repository = '${new URL('./duckdb-ext', location.href).href}'`).then(() => undefined));
  const attached = new Map<string, Promise<void>>();
  const attachParquet = (view: string, files: string[], opts: { hive?: boolean; base?: string } = {}) => {
    const name = ident(view);
    if (!attached.has(name)) {
      attached.set(name, (async () => {
        await parquetReady();
        const local = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
        const names: string[] = [];
        for (const f of files) {
          const url = new URL((opts.base ?? '') + f, location.href).href;
          // With hive partitioning the registered name keeps the key=value path, so DuckDB reads the
          // partition column from it and skips non-matching files without opening them.
          const fname = opts.hive ? f : `${name}__${names.length}.parquet`;
          if (local) {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
            await db.registerFileBuffer(fname, new Uint8Array(await r.arrayBuffer()));
          } else {
            await db.registerFileURL(fname, url, duckdb.DuckDBDataProtocol.HTTP, false);
          }
          names.push(fname);
        }
        const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
        await conn.query(`CREATE OR REPLACE VIEW ${name} AS SELECT * FROM read_parquet([${list}]${opts.hive ? ', hive_partitioning = true' : ''})`);
      })());
      attached.get(name)!.catch(() => attached.delete(name));
    }
    return attached.get(name)!;
  };

  return { scan, query, ensureScores, attachParquet };
}
