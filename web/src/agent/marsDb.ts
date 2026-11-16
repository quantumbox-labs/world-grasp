// Mars tables in DuckDB (#11): the parquet files listed in web/public/data/mars/manifest.json
// (built by scripts/build-mars-tables.mjs), as views next to #10's Hokkaido tables in the same
// database. DuckDB loads only when a question needs SQL; the map and the verdict never wait for it.
import type { Core } from '../core';
import type { Row } from '../db';

export interface MarsTable { files: string[]; rows: number; bytes: number; columns: string[]; hive?: boolean; source: { label: string; url?: string }; note?: string }
export interface MarsManifest { scale: number; tables: Record<string, MarsTable> }

let manifest: Promise<MarsManifest> | null = null;
export function marsManifest(base = './data/mars/'): Promise<MarsManifest> {
  manifest ??= fetch(`${base}manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`Mars tables: HTTP ${r.status}`);
    return r.json() as Promise<MarsManifest>;
  });
  manifest.catch(() => { manifest = null; });
  return manifest;
}

/** Reject after ms with a message that says what to do (DuckDB can hang if its worker fails to load). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((ok, bad) => {
    const id = setTimeout(() => bad(new Error(`${what}: no answer within ${Math.round(ms / 1000)} s`)), ms);
    p.then((v) => { clearTimeout(id); ok(v); }, (e) => { clearTimeout(id); bad(e); });
  });
}

/** The shared DuckDB with the Mars views attached (only `tables`, when given: a query touches only what it names). */
export async function marsDb(core: Core, tables?: string[], base = './data/mars/') {
  const [{ openDb }, m] = await Promise.all([import('../db'), marsManifest(base)]);
  const db = await withTimeout(openDb(core), 30000, 'DuckDB');
  await Promise.all(Object.entries(m.tables).filter(([name]) => !tables || tables.includes(name))
    .map(([name, t]) => db.attachParquet(name, t.files, { hive: t.hive, base })));
  return { db, manifest: m };
}

export async function marsQuery(core: Core, sql: string, tables?: string[], timeoutMs = 15000): Promise<Row[]> {
  const { db } = await marsDb(core, tables);
  return withTimeout(db.query(sql), timeoutMs, 'query');
}

/** SQL the rover breakdown check reads its path with (kept here so the evidence can show it). */
export const ROVER_PATH_SQL = "SELECT drive, seq, sol, lat, lon, elev_m, km FROM rover_traverse WHERE mission = 'm20' ORDER BY drive, seq";
