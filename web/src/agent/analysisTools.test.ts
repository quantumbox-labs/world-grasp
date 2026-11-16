import { describe, expect, it, vi } from 'vitest';

const queries: string[] = [];
vi.mock('./marsDb', () => {
  const db = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.startsWith('DESCRIBE')) return [{ column_name: 'sol', column_type: 'INTEGER' }, { column_name: 'km', column_type: 'DOUBLE' }];
      if (sql.includes('count(*) AS n FROM')) return [{ n: 3 }];
      if (sql.includes('LIMIT 3')) return [{ sol: 1, km: 0.1 }];
      if (sql.includes('FILTER')) return [{ n_a: 2, mean_a: 1.5, median_a: 1.5, n_b: 1, mean_b: 4, median_b: 4 }];
      if (sql.includes('GROUP BY "sol"')) return [{ sol: 1, n: 1, mean: 1 }, { sol: 2, n: 1, mean: 3.5 }];
      return [{ n: 3, mean: 2 }];
    },
  };
  const manifest = { tables: { rover_traverse: { rows: 3, source: { label: 'NASA PDS' } } } };
  return { marsDb: async () => ({ db, manifest }), marsManifest: async () => manifest, withTimeout: <T>(p: Promise<T>) => p };
});

import { compareSql, checkSql, makeCompareNasaTool, makeListNasaTablesTool, makeSummarizeNasaTool } from './queryNasa';
import type { Core } from '../core';

const core = {} as Core;

describe('NASA data analysis tools', () => {
  it('list_nasa_tables lists tables, and one table with columns and examples', async () => {
    const all = await makeListNasaTablesTool(core).run({});
    expect(all.text).toMatch(/rover_traverse \(3/);
    const one = await makeListNasaTablesTool(core).run({ table: 'rover_traverse' });
    expect(one.text).toMatch(/sol INTEGER, km DOUBLE/);
    expect(one.sources?.[0]).toMatchObject({ label: 'NASA PDS' });
  });

  it('summarize_nasa refuses unknown columns and returns SQL + sources', async () => {
    const tool = makeSummarizeNasaTool(core);
    await expect(tool.run({ table: 'rover_traverse', column: 'nope' })).rejects.toThrow(/nope/);
    const r = await tool.run({ table: 'rover_traverse', column: 'km', where: 'sol <= 2' });
    expect(r.sql).toMatch(/FROM rover_traverse WHERE sol <= 2$/);
    expect(r.sources?.length).toBe(1);
  });

  it('compare_nasa: two conditions give each side and B − A from the tool', async () => {
    const tool = makeCompareNasaTool(core);
    await expect(tool.run({ table: 'rover_traverse', column: 'km' })).rejects.toThrow(/group_by/);
    const r = await tool.run({ table: 'rover_traverse', column: 'km', where_a: 'sol <= 1', where_b: 'sol > 1' });
    expect(r.text).toMatch(/B−A: mean 2.5, median 2.5/);
    expect(r.sql).toMatch(/FILTER \(WHERE \(sol <= 1\)\)/);
    const g = await tool.run({ table: 'rover_traverse', column: 'km', group_by: 'sol' });
    expect(g.text).toMatch(/difference 2.5/);
  });

  it('compare SQL passes the read-only guard and blocks smuggled statements', () => {
    expect(checkSql(compareSql('eva', 'hours', { groupBy: 'country' })).ok).toBe(true);
    expect(checkSql(compareSql('eva', 'hours', { whereA: "country = 'US'", whereB: "country <> 'US'" })).ok).toBe(true);
    expect(checkSql(compareSql('eva', 'hours', { whereA: '1=1); DROP TABLE eva; --', whereB: '1=1' })).ok).toBe(false);
    expect(checkSql(compareSql('eva', 'hours', { whereA: "hours > (SELECT 1 FROM read_csv('x'))", whereB: '1=1' })).ok).toBe(false);
  });
});
