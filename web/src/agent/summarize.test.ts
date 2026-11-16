import { describe, expect, it } from 'vitest';
import { checkSql, summarySql } from './queryNasa';

describe('summarize_nasa SQL', () => {
  it('builds one read-only SELECT that passes the query_nasa guard', () => {
    const sql = summarySql('rover_traverse', 'km', 'sol <= 1000');
    expect(sql).toMatch(/^SELECT count\(\*\) AS n, .*median\(TRY_CAST\("km" AS DOUBLE\)\).* FROM rover_traverse WHERE sol <= 1000$/);
    expect(checkSql(sql)).toMatchObject({ ok: true, tables: ['rover_traverse'] });
    const grouped = summarySql('eva', 'hours', undefined, 'country');
    expect(grouped).toMatch(/GROUP BY "country" ORDER BY "country"$/);
    expect(checkSql(grouped).ok).toBe(true);
  });
  it('a where clause cannot smuggle in writes, files or other statements', () => {
    expect(checkSql(summarySql('eva', 'hours', "1=1; DROP TABLE eva")).ok).toBe(false);
    expect(checkSql(summarySql('eva', 'hours', "hours > (SELECT count(*) FROM read_csv('x'))")).ok).toBe(false);
    expect(checkSql(summarySql('eva', 'hours', 'id IN (SELECT 1 FROM secrets)')).ok).toBe(false);
  });
});
