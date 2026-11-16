import { describe, expect, it } from 'vitest';
import { validateWhere } from './where';

const ok = (s: string) => expect(validateWhere(s)).toEqual({ ok: true, where: s.trim() });
const bad = (s: unknown) => expect(validateWhere(s).ok).toBe(false);

describe('validateWhere', () => {
  it('accepts boolean expressions over scan columns', () => {
    ok('elev_m >= 1000');
    ok('slope_deg BETWEEN 5 AND 15 AND ndvi < 0.4');
    ok('tmin_jan_c <= -15 OR (forest IS NULL AND barren > 0.1)');
    ok("screened IS NULL OR screened <> 'it''s drop table cells'");
    ok('111.32 * sqrt(pow(lat - 43.06, 2) + pow((lon - 141.35) * cos(radians(lat)), 2)) <= 50');
    ok('round(score, 2) >= 0.8');
    ok('elev_m >= 1e3');
  });
  it('rejects statements, keywords and file access', () => {
    bad('elev_m > 0; DROP TABLE cells');
    bad("screened = 'a;b'"); // no ';' at all, even inside a string
    bad('elev_m > 0 -- comment');
    bad('elev_m > 0 /* x */');
    bad('k IN (SELECT k FROM cells)');
    bad('1=1 UNION SELECT 1');
    bad("k IN (SELECT * FROM read_csv('x.csv'))");
    bad("read_text('/etc/passwd') IS NOT NULL");
    bad('ATTACH');
    bad('COPY');
    bad('PRAGMA');
    bad('INSERT');
    bad('"elev_m" > 0');
    bad('elev_m::text > 0');
    bad('foo > 1');
    bad('elev_m > 1)');
    bad("screened = 'open");
    bad('');
    bad(42);
    bad('x'.repeat(401));
  });
  it('rejects disallowed functions even with allowed names as columns', () => {
    bad('getenv(ndvi) > 0');
    bad('elev_m(1) > 0');
  });
});
