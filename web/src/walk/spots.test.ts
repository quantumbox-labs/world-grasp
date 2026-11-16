import { describe, expect, it } from 'vitest';
import { budgetWord, elevAt, spotNote } from './spots';

describe('spot one-liner', () => {
  it('names the budget by the ratio boundaries', () => {
    expect(budgetWord(0.49, 'ja')).toBe('余裕あり');
    expect(budgetWord(0.5, 'ja')).toBe('半分以上使う');
    expect(budgetWord(0.79, 'ja')).toBe('半分以上使う');
    expect(budgetWord(0.8, 'ja')).toBe('ぎりぎり');
    expect(budgetWord(0.2, 'en')).toBe('plenty to spare');
  });

  it('builds the line from the data only', () => {
    expect(spotNote({ kind: 'name', ratio: 0.43, dz: -25.2, type: 'Crater', diamKm: 0.9 }, 'ja'))
      .toBe('直径 0.9 km のクレーター・基地より 25 m 低い・余裕あり（往復で使う分 43%）');
    expect(spotNote({ kind: 'rover', ratio: 0.85 }, 'en'))
      .toBe('where the rover really drove · cutting it close (85% of the budget)');
  });

  it('reads the nearest DEM cell', () => {
    const g = { lat0: 1, lon0: 0, dlat: 1, dlon: 1, rows: 2, cols: 2, z: [10, 20, 30, null] };
    expect(elevAt(g, 1, 1)).toBe(20);
    expect(elevAt(g, 0, 0)).toBe(30);
    expect(elevAt(g, 0, 1)).toBeNull();
    expect(elevAt(g, 5, 5)).toBeNull();
  });
});
