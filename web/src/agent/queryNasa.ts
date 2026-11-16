// query_nasa: read-only SQL over the NASA tables (DuckDB). For questions no fixed tool answers
// ("how many EVAs ran over 8 hours?", "how far had Perseverance driven by sol 1000?"). Guarded:
// one SELECT, a fixed list of tables, no file or network functions, a row cap and a time cap.
// The SQL and the sources come back with the rows so the panel can show them as evidence.
import type { Core } from '../core';
import type { Row } from '../db';
import { getLang } from '../i18n';
import { marsDb, marsManifest, withTimeout } from './marsDb';
import type { ToolDef, ToolResult } from './types';

export const TABLES: Record<string, string> = {
  rover_traverse: 'Perseverance drive record: mission, drive, seq, sol, lat, lon, elev_m, km (distance driven so far)',
  eva: 'Real EVAs (US and Russia): id, country, crew, vehicle, date, hours',
  mars_footing: 'Footing of the Jezero grid cells (~60 m): lat, lon, thermal_inertia (Mars Odyssey THEMIS, J m-2 K-1 s-1/2; ≤150 loose sand/dust, ≥400 rock/cemented), dust_cover_index (MGS TES; <0.94 dusty)',
  mars_radiation: 'Radiation figures used for EVA dose: quantity (surface_dose_equivalent_rate, surface_absorbed_dose_rate, career_effective_dose_limit, solar_particle_event_limit), value, sigma, unit, source',
  mars_weather: 'Jezero air temperature and pressure by local solar hour (Perseverance MEDA): sol, ltst_hour (0–23), air_temp_k, pressure_pa, samples',
  mars_names: "Mars gazetteer (IAU names, landing sites, crewed-landing candidates): name, kind ('feature' | 'landing' | 'crewed'), type (Crater, Vallis, Mons, Planitia, … or 'Landing site'), lat, lon (degrees east, -180..180), diameter_km, origin (what the name honours), year, agency, link",
  targets: 'Moon/Mars target sites: body_id, world, name_en, name_ja, lat, tmin_k, tmax_k, slope_deg',
  sites: '14 known Hokkaido analogue sites: earth_id, name_en, name_ja, lat, lon',
  tests: 'Rehearsal tests: id, name_en, name_ja, season_en, season_ja',
  cells: 'Hokkaido 1 km cells (NASA terrain/climate/vegetation): k, lat, lon, elev_m, relief_m, slope_deg, slope_p90_deg, ndvi, urban, crop, forest, water, barren, tmin_jan_c, tmax_aug_c, precip_mm, screened',
};
const SCAN_SOURCE = { label: 'Hokkaido 1 km scan: NASADEM, NASA POWER, MODIS' };
export const MAX_ROWS = 200;
export const TIME_MS = 8000;

const FORBIDDEN = /\b(insert|update|delete|create|drop|alter|attach|detach|copy|export|import|pragma|install|load|call|set|reset|checkpoint|vacuum|begin|commit|rollback|grant|revoke|use|truncate|merge)\b/i;
const FORBIDDEN_FN = /\b(read_\w+|glob|parquet_\w+|sniff_csv|http_\w+|getenv|current_setting|duckdb_\w+|pg_\w+|query|query_table|sql_auto_complete|which_secret)\s*\(/i;

export type Check = { ok: true; sql: string; tables: string[] } | { ok: false; error: string };

/** Accept one read-only SELECT over the allowed tables. */
export function checkSql(input: string): Check {
  const sql = input.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, error: 'empty SQL' };
  if (sql.includes(';')) return { ok: false, error: 'one statement only' };
  if (!/^(select|with)\b/i.test(sql)) return { ok: false, error: 'only SELECT (or WITH … SELECT) is allowed' };
  if (FORBIDDEN.test(sql)) return { ok: false, error: `not allowed: ${sql.match(FORBIDDEN)![0]}` };
  if (FORBIDDEN_FN.test(sql)) return { ok: false, error: `function not allowed: ${sql.match(FORBIDDEN_FN)![1]}` };
  if (/\b(from|join)\s+['"]/i.test(sql)) return { ok: false, error: 'read from the listed tables, not from files' };
  const ctes = new Set([...sql.matchAll(/(?:\bwith\b|,)\s*([a-z_]\w*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const used = [...sql.matchAll(/\b(?:from|join)\s+([a-z_][\w.]*)/gi)].map((m) => m[1].toLowerCase());
  const bad = used.filter((t) => !(t in TABLES) && !ctes.has(t));
  if (bad.length) return { ok: false, error: `unknown table ${bad.join(', ')} (tables: ${Object.keys(TABLES).join(', ')})` };
  return { ok: true, sql, tables: [...new Set(used.filter((t) => t in TABLES))] };
}

const fmt = (v: Row[string]) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(4))) : v === null ? 'null' : String(v));

export function makeQueryNasa(core: Core): ToolDef {
  return {
    name: 'query_nasa',
    kind: 'compute',
    description: `Run one read-only SQL SELECT (DuckDB dialect) over the NASA tables and get the rows back with the SQL and sources. Use it for counts, ranges, lists and comparisons no other tool answers. Tables: ${Object.entries(TABLES).map(([k, v]) => `${k} (${v})`).join('; ')}. At most ${MAX_ROWS} rows and ${TIME_MS / 1000} s: aggregate (count, min, max, avg) or filter with WHERE instead of listing everything.`,
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'One SELECT statement over the listed tables' },
        limit: { type: ['integer', 'string'], description: `Rows to return (1–${MAX_ROWS}, default 50)` },
      },
      required: ['sql'],
    },
    async run(a: { sql?: string; limit?: number | string } = {}): Promise<ToolResult> {
      const ja = getLang() === 'ja';
      const c = checkSql(String(a.sql ?? ''));
      if (!c.ok) throw new Error(ja ? `この SQL は実行できません: ${c.error}` : `This SQL cannot run: ${c.error}`);
      const limit = Math.max(1, Math.min(MAX_ROWS, Math.round(Number(a.limit ?? 50)) || 50));
      const { db, manifest } = await marsDb(core, c.tables);
      const wrapped = `SELECT * FROM (${c.sql}) AS q LIMIT ${limit + 1}`;
      const t0 = performance.now();
      let rows: Row[];
      try {
        rows = await withTimeout(db.query(wrapped), TIME_MS, 'query');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/no answer within/.test(msg)) throw new Error(ja ? `${TIME_MS / 1000} 秒で終わりませんでした。WHERE で絞るか、集計（count・max など）にしてください。` : `Did not finish in ${TIME_MS / 1000} s. Narrow it with WHERE or aggregate (count, max…).`);
        throw new Error(ja ? `SQL のエラー: ${msg}` : `SQL error: ${msg}`);
      }
      const ms = Math.round(performance.now() - t0);
      if (rows.length > limit) {
        throw new Error(ja ? `結果が ${limit} 行を超えました。WHERE で絞るか、集計（count・avg など）にしてください。` : `More than ${limit} rows. Narrow it with WHERE or aggregate (count, avg…).`);
      }
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const shown = rows.slice(0, 20).map((r) => cols.map((k) => `${k}=${fmt(r[k])}`).join(', '));
      const text = (ja ? `${rows.length} 行（${ms} ms）: ` : `${rows.length} rows (${ms} ms): `) +
        (shown.length ? shown.join(' | ') : ja ? '該当なし' : 'none') + (rows.length > 20 ? (ja ? ` …ほか ${rows.length - 20} 行` : ` … and ${rows.length - 20} more`) : '');
      const sources = c.tables.map((t) => manifest.tables[t]?.source ?? (t === 'cells' ? SCAN_SOURCE : { label: t }));
      return { text, data: { rows, ms, tables: c.tables }, sql: c.sql, sources };
    },
  };
}

// ---- Data analysis helpers: what is in the tables, and quick column statistics ----

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const tableSource = (manifest: { tables: Record<string, { source?: { label: string; url?: string } }> }, t: string) =>
  manifest.tables[t]?.source ?? (t === 'cells' ? SCAN_SOURCE : { label: t });
const known = (t: unknown): string => {
  const name = String(t ?? '').trim().toLowerCase();
  if (!(name in TABLES)) throw new Error(`unknown table ${name || '(none)'} (tables: ${Object.keys(TABLES).join(', ')})`);
  return name;
};

/** Build the read-only statistics SQL for one column (identifiers checked by the caller). */
export function summarySql(table: string, column: string, where?: string, groupBy?: string): string {
  const c = `"${column}"`;
  const g = groupBy ? `"${groupBy}"` : '';
  const sel = [g && `${g} AS ${groupBy}`, 'count(*) AS n', `count(${c}) AS non_null`, `count(*) - count(${c}) AS missing`,
    `min(${c}) AS min`, `max(${c}) AS max`, `avg(TRY_CAST(${c} AS DOUBLE)) AS mean`, `median(TRY_CAST(${c} AS DOUBLE)) AS median`,
    `stddev_samp(TRY_CAST(${c} AS DOUBLE)) AS stddev`, `count(DISTINCT ${c}) AS distinct_values`].filter(Boolean).join(', ');
  return `SELECT ${sel} FROM ${table}${where ? ` WHERE ${where}` : ''}${g ? ` GROUP BY ${g} ORDER BY ${g}` : ''}`;
}

export function makeListNasaTablesTool(core: Core): ToolDef {
  return {
    name: 'list_nasa_tables',
    kind: 'compute',
    description: 'List the NASA tables query_nasa / summarize_nasa can read: each table with its columns, row count and source (NASA dataset). Pass table to get that table in detail: column names and types plus 3 example rows. Use it first when unsure which table or column holds the data.',
    parameters: { type: 'object', properties: { table: { type: 'string', description: `Optional: one table (${Object.keys(TABLES).join(', ')})` } } },
    async run(a: { table?: string } = {}): Promise<ToolResult> {
      const ja = getLang() === 'ja';
      if (!a.table) {
        const manifest = await marsManifest();
        const lines = Object.entries(TABLES).map(([t, d]) => `${t}${manifest.tables[t] ? ` (${manifest.tables[t].rows} ${ja ? '行' : 'rows'})` : ''}: ${d}`);
        return { text: (ja ? `表は ${lines.length} 個: ` : `${lines.length} tables: `) + lines.join(' | '),
          data: { tables: Object.keys(TABLES) }, sources: Object.keys(TABLES).map((t) => tableSource(manifest, t)) };
      }
      const t = known(a.table);
      const { db, manifest } = await marsDb(core, [t]);
      const cols = await withTimeout(db.query(`DESCRIBE ${t}`), TIME_MS, 'describe');
      const [{ n }] = await withTimeout(db.query(`SELECT count(*) AS n FROM ${t}`), TIME_MS, 'count');
      const sample = await withTimeout(db.query(`SELECT * FROM ${t} LIMIT 3`), TIME_MS, 'sample');
      const colText = cols.map((r) => `${r.column_name} ${r.column_type}`).join(', ');
      const ex = sample.map((r) => Object.entries(r).map(([k, v]) => `${k}=${fmt(v)}`).join(', ')).join(' | ');
      const note = manifest.tables[t]?.note;
      return {
        text: ja ? `${t}: ${n} 行。列: ${colText}。例: ${ex}${note ? `。注: ${note}` : ''}` : `${t}: ${n} rows. Columns: ${colText}. Examples: ${ex}${note ? `. Note: ${note}` : ''}`,
        data: { table: t, rows: Number(n), columns: cols, sample }, sql: `DESCRIBE ${t}`, sources: [tableSource(manifest, t)],
      };
    },
  };
}

export function makeSummarizeNasaTool(core: Core): ToolDef {
  return {
    name: 'summarize_nasa',
    kind: 'compute',
    description: 'Statistics of one column of a NASA table: count, missing, min, max, mean, median, standard deviation and distinct values, optionally filtered (where: a SQL condition) and per group (group_by: a column, at most 50 groups). Returns the SQL and sources. Use list_nasa_tables to see column names.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: `One of: ${Object.keys(TABLES).join(', ')}` },
        column: { type: 'string', description: 'Column to summarise' },
        where: { type: 'string', description: "Optional SQL condition, e.g. \"sol <= 1000\" or \"country = 'US'\"" },
        group_by: { type: 'string', description: 'Optional column to group by' },
      },
      required: ['table', 'column'],
    },
    async run(a: { table?: string; column?: string; where?: string; group_by?: string } = {}): Promise<ToolResult> {
      const ja = getLang() === 'ja';
      const t = known(a.table);
      const column = String(a.column ?? '').trim();
      const groupBy = a.group_by ? String(a.group_by).trim() : '';
      const where = a.where ? String(a.where).trim() : '';
      const { db, manifest } = await marsDb(core, [t]);
      const names = (await withTimeout(db.query(`DESCRIBE ${t}`), TIME_MS, 'describe')).map((r) => String(r.column_name));
      for (const c of [column, groupBy].filter(Boolean)) {
        if (!IDENT.test(c) || !names.includes(c)) throw new Error(ja ? `${t} に列 ${c} はありません（列: ${names.join(', ')}）` : `${t} has no column ${c} (columns: ${names.join(', ')})`);
      }
      const sql = summarySql(t, column, where || undefined, groupBy || undefined);
      const c = checkSql(sql);
      if (!c.ok) throw new Error(ja ? `この条件は使えません: ${c.error}` : `This condition cannot be used: ${c.error}`);
      let rows: Row[];
      try {
        rows = await withTimeout(db.query(`SELECT * FROM (${c.sql}) AS q LIMIT 51`), TIME_MS, 'query');
      } catch (e) {
        throw new Error(ja ? `SQL のエラー: ${e instanceof Error ? e.message : String(e)}` : `SQL error: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (rows.length > 50) throw new Error(ja ? 'グループが 50 を超えました。where で絞ってください。' : 'More than 50 groups. Narrow it with where.');
      const line = (r: Row) => Object.entries(r).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
      return {
        text: `${t}.${column}${where ? ` (${where})` : ''}: ` + rows.map(line).join(' | '),
        data: { rows }, sql: c.sql, sources: [tableSource(manifest, t)],
      };
    },
  };
}

/** Build the read-only comparison SQL: per group (group_by) or two conditions A / B (FILTER). */
export function compareSql(table: string, column: string, opt: { groupBy?: string; whereA?: string; whereB?: string }): string {
  const x = `TRY_CAST("${column}" AS DOUBLE)`;
  if (opt.groupBy) {
    const g = `"${opt.groupBy}"`;
    return `SELECT ${g} AS ${opt.groupBy}, count(${x}) AS n, avg(${x}) AS mean, median(${x}) AS median FROM ${table} GROUP BY ${g} ORDER BY ${g}`;
  }
  const part = (k: string, w: string) => `count(${x}) FILTER (WHERE ${w}) AS n_${k}, avg(${x}) FILTER (WHERE ${w}) AS mean_${k}, median(${x}) FILTER (WHERE ${w}) AS median_${k}`;
  return `SELECT ${part('a', `(${opt.whereA})`)}, ${part('b', `(${opt.whereB})`)} FROM ${table}`;
}

const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const diff = (b: unknown, a: unknown): number | null => { const x = num(b), y = num(a); return x === null || y === null ? null : +(x - y).toFixed(4); };

export function makeCompareNasaTool(core: Core): ToolDef {
  return {
    name: 'compare_nasa',
    kind: 'compute',
    description: 'Compare one numeric column of a NASA table between groups (group_by: a column, at most 50 groups) or between two SQL conditions (where_a, where_b): count, mean and median of each, and the difference (B − A, or highest − lowest group mean). Returns the SQL and sources.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: `One of: ${Object.keys(TABLES).join(', ')}` },
        column: { type: 'string', description: 'Numeric column to compare' },
        group_by: { type: 'string', description: 'Column whose values form the groups' },
        where_a: { type: 'string', description: 'SQL condition for group A, e.g. "sol <= 500"' },
        where_b: { type: 'string', description: 'SQL condition for group B, e.g. "sol > 500"' },
      },
      required: ['table', 'column'],
    },
    async run(a: { table?: string; column?: string; group_by?: string; where_a?: string; where_b?: string } = {}): Promise<ToolResult> {
      const ja = getLang() === 'ja';
      const t = known(a.table);
      const column = String(a.column ?? '').trim();
      const groupBy = a.group_by ? String(a.group_by).trim() : '';
      const whereA = a.where_a ? String(a.where_a).trim() : '';
      const whereB = a.where_b ? String(a.where_b).trim() : '';
      if (!groupBy && !(whereA && whereB)) throw new Error(ja ? 'group_by か、where_a と where_b の両方を渡してください。' : 'Pass group_by, or both where_a and where_b.');
      const { db, manifest } = await marsDb(core, [t]);
      const names = (await withTimeout(db.query(`DESCRIBE ${t}`), TIME_MS, 'describe')).map((r) => String(r.column_name));
      for (const c of [column, groupBy].filter(Boolean)) {
        if (!IDENT.test(c) || !names.includes(c)) throw new Error(ja ? `${t} に列 ${c} はありません（列: ${names.join(', ')}）` : `${t} has no column ${c} (columns: ${names.join(', ')})`);
      }
      const sql = compareSql(t, column, groupBy ? { groupBy } : { whereA, whereB });
      const c = checkSql(sql);
      if (!c.ok) throw new Error(ja ? `この条件は使えません: ${c.error}` : `This condition cannot be used: ${c.error}`);
      let rows: Row[];
      try {
        rows = await withTimeout(db.query(`SELECT * FROM (${c.sql}) AS q LIMIT 51`), TIME_MS, 'query');
      } catch (e) {
        throw new Error(ja ? `SQL のエラー: ${e instanceof Error ? e.message : String(e)}` : `SQL error: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (rows.length > 50) throw new Error(ja ? 'グループが 50 を超えました。' : 'More than 50 groups.');
      const sources = [tableSource(manifest, t)];
      if (groupBy) {
        const withMean = rows.filter((r) => num(r.mean) !== null);
        const hi = withMean.reduce<Row | null>((m, r) => (!m || Number(r.mean) > Number(m.mean) ? r : m), null);
        const lo = withMean.reduce<Row | null>((m, r) => (!m || Number(r.mean) < Number(m.mean) ? r : m), null);
        const d = hi && lo ? diff(hi.mean, lo.mean) : null;
        const groups = rows.map((r) => `${groupBy}=${fmt(r[groupBy])}: n=${fmt(r.n)}, mean=${fmt(r.mean)}, median=${fmt(r.median)}`).join(' | ');
        const tail = hi && lo && d !== null ? (ja ? `。平均が最大 ${fmt(hi[groupBy])}、最小 ${fmt(lo[groupBy])}、差 ${fmt(d)}` : `. Highest mean ${fmt(hi[groupBy])}, lowest ${fmt(lo[groupBy])}, difference ${fmt(d)}`) : '';
        return { text: `${t}.${column} by ${groupBy}: ${groups}${tail}`, data: { rows, difference: d }, sql: c.sql, sources };
      }
      const r = rows[0] ?? {};
      const dMean = diff(r.mean_b, r.mean_a), dMed = diff(r.median_b, r.median_a);
      const text = `${t}.${column}: A (${whereA}) n=${fmt(r.n_a)}, mean=${fmt(r.mean_a)}, median=${fmt(r.median_a)} | B (${whereB}) n=${fmt(r.n_b)}, mean=${fmt(r.mean_b)}, median=${fmt(r.median_b)} | B−A: mean ${dMean === null ? 'null' : fmt(dMean)}, median ${dMed === null ? 'null' : fmt(dMed)}`;
      return { text, data: { ...r, diff_mean: dMean, diff_median: dMed }, sql: c.sql, sources };
    },
  };
}
