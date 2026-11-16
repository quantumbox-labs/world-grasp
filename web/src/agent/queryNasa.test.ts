import { describe, expect, it } from 'vitest';
import { checkSql } from './queryNasa';

describe('query_nasa SQL guard', () => {
  it('accepts one SELECT over the listed tables', () => {
    expect(checkSql('SELECT count(*) FROM eva WHERE hours > 8;')).toMatchObject({ ok: true, tables: ['eva'] });
    expect(checkSql("WITH s AS (SELECT sol, km FROM rover_traverse) SELECT max(km) FROM s")).toMatchObject({ ok: true, tables: ['rover_traverse'] });
    expect(checkSql('select c.k from cells c join sites t on true')).toMatchObject({ ok: true });
  });
  it('refuses writes, files, other tables and several statements', () => {
    expect(checkSql('DROP TABLE eva').ok).toBe(false);
    expect(checkSql('SELECT 1; SELECT 2').ok).toBe(false);
    expect(checkSql("SELECT * FROM read_csv('x.csv')").ok).toBe(false);
    expect(checkSql("SELECT * FROM 'data.parquet'").ok).toBe(false);
    expect(checkSql('SELECT * FROM duckdb_settings()').ok).toBe(false);
    expect(checkSql('SELECT * FROM secrets').ok).toBe(false);
    expect(checkSql('SELECT 1 -- ; DROP TABLE eva').ok).toBe(true);
  });
});
