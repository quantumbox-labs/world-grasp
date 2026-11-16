import { describe, expect, it } from 'vitest';
import { flatKm, spaced } from './explore';

describe('spaced', () => {
  it('keeps rows in order, at least 15 km from every kept row', () => {
    const rows = [
      { id: 1, lat: 43.0, lon: 142.0 },
      { id: 2, lat: 43.05, lon: 142.0 }, // ~5.6 km from 1: dropped
      { id: 3, lat: 43.2, lon: 142.0 }, // ~22 km from 1: kept
      { id: 4, lat: 43.0, lon: 142.1 }, // ~8 km from 1: dropped
      { id: 5, lat: 43.0, lon: 142.4 }, // ~33 km: kept
      { id: 6, lat: 44.0, lon: 142.0 },
    ];
    expect(spaced(rows, 3).map((r) => r.id)).toEqual([1, 3, 5]);
    expect(spaced(rows, 10).map((r) => r.id)).toEqual([1, 3, 5, 6]);
  });
  it('measures like scan::top', () => {
    expect(flatKm({ lat: 43, lon: 142 }, { lat: 44, lon: 142 })).toBeCloseTo(111.32, 2);
  });
});
