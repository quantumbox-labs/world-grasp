// Validator for the `where` argument of explore_hokkaido: one SQL boolean expression over the
// scan columns. Allow-list based: every bare word must be a column, an operator keyword or a
// plain math function, so no statements, subqueries, file readers or comments can get through.
export const WHERE_COLUMNS = [
  'k', 'lat', 'lon', 'elev_m', 'relief_m', 'slope_deg', 'slope_p90_deg', 'shadow', 'ndvi', 'urban',
  'crop', 'forest', 'water', 'barren', 'tmin_jan_c', 'tmax_aug_c', 'precip_mm', 'screened', 'score',
] as const;

const WORDS = new Set([
  'and', 'or', 'not', 'is', 'null', 'between', 'in', 'like', 'ilike', 'true', 'false',
  'case', 'when', 'then', 'else', 'end',
]);
const FUNCS = new Set([
  'abs', 'round', 'floor', 'ceil', 'sqrt', 'pow', 'power', 'exp', 'ln', 'log', 'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'atan2', 'radians', 'degrees', 'pi', 'least', 'greatest', 'coalesce',
]);
const COLS = new Set<string>(WHERE_COLUMNS);

export type WhereCheck = { ok: true; where: string } | { ok: false; error: string };

export function validateWhere(input: unknown): WhereCheck {
  if (typeof input !== 'string') return { ok: false, error: 'where must be a string' };
  const where = input.trim();
  if (!where) return { ok: false, error: 'where is empty' };
  if (where.length > 400) return { ok: false, error: 'where is longer than 400 characters' };
  if (where.includes(';')) return { ok: false, error: 'no ";" allowed' };
  if (/--|\/\*|\*\/|"|`|\\|\$|\?|::/.test(where)) return { ok: false, error: 'comments, quoted identifiers, casts and parameters are not allowed' };

  // String literals: '…' with '' escapes, kept out of the word check.
  let bare = '';
  for (let i = 0; i < where.length; i++) {
    if (where[i] !== "'") { bare += where[i]; continue; }
    let j = i + 1;
    for (; j < where.length; j++) {
      if (where[j] === "'") { if (where[j + 1] === "'") j++; else break; }
    }
    if (j >= where.length) return { ok: false, error: 'unterminated string' };
    bare += ' 0 ';
    i = j;
  }

  let depth = 0;
  for (const ch of bare) {
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return { ok: false, error: 'unbalanced parentheses' };
  }
  if (depth) return { ok: false, error: 'unbalanced parentheses' };
  if (/[^\w\s.()+\-*/%<>=!,]/.test(bare)) return { ok: false, error: 'unexpected character' };

  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (let m; (m = re.exec(bare)); ) {
    const w = m[0].toLowerCase();
    const prev = bare[m.index - 1];
    if (prev && /[0-9.]/.test(prev)) {
      if (/^e\d*$/.test(w)) continue; // exponent: 1e3, 2.5e-4
      return { ok: false, error: `unexpected "${m[0]}"` };
    }
    const isCall = /^\s*\(/.test(bare.slice(m.index + m[0].length));
    if (WORDS.has(w) || (isCall ? FUNCS.has(w) : COLS.has(w))) continue;
    return { ok: false, error: isCall ? `function ${m[0]}() is not allowed` : `unknown word "${m[0]}" (columns: ${WHERE_COLUMNS.join(', ')})` };
  }
  return { ok: true, where };
}
