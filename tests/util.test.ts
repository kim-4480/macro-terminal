import { describe, expect, it } from 'vitest';
import { changeStats, downsample, shiftDate, valueAtOrBefore, yoy } from '@/server/util';
import type { Point } from '@/shared/types';

describe('shiftDate', () => {
  it('moves by months and years across boundaries', () => {
    expect(shiftDate('2026-01-31', { months: -1 })).toBe('2025-12-31');
    expect(shiftDate('2026-03-01', { years: -1 })).toBe('2025-03-01');
    expect(shiftDate('2026-01-01', { days: -1 })).toBe('2025-12-31');
  });
});

describe('valueAtOrBefore', () => {
  const pts: Point[] = [['2026-01-02', 1], ['2026-01-05', 2], ['2026-01-09', 3]];
  it('returns the last point on or before the date', () => {
    expect(valueAtOrBefore(pts, '2026-01-06')).toEqual(['2026-01-05', 2]);
    expect(valueAtOrBefore(pts, '2026-01-09')).toEqual(['2026-01-09', 3]);
  });
  it('returns null before the first point', () => {
    expect(valueAtOrBefore(pts, '2025-12-31')).toBeNull();
  });
});

describe('yoy', () => {
  it('computes year-over-year % for monthly data and skips the first year', () => {
    const pts: Point[] = [['2025-01-01', 100], ['2025-02-01', 100], ['2026-01-01', 103], ['2026-02-01', 104]];
    const out = yoy(pts);
    expect(out).toHaveLength(2);
    expect(out[0]![0]).toBe('2026-01-01');
    expect(out[0]![1]).toBeCloseTo(3);
    expect(out[1]![1]).toBeCloseTo(4);
  });
});

describe('changeStats', () => {
  const pts: Point[] = [
    ['2025-10-20', 50],
    ['2025-12-31', 80],
    ['2026-09-20', 90],
    ['2026-10-19', 99],
    ['2026-10-20', 100],
  ];
  it('pct mode', () => {
    const s = changeStats(pts, 'pct')!;
    expect(s.value).toBe(100);
    expect(s.chg.d1).toBeCloseTo((100 / 99 - 1) * 100);
    expect(s.chg.m1).toBeCloseTo((100 / 90 - 1) * 100);
    expect(s.chg.ytd).toBeCloseTo(25);
    expect(s.chg.y1).toBeCloseTo(100);
  });
  it('diff mode (rates)', () => {
    const s = changeStats(pts, 'diff')!;
    expect(s.chg.d1).toBeCloseTo(1);
    expect(s.chg.y1).toBeCloseTo(50);
  });
  it('returns null changes when history is too short', () => {
    const s = changeStats([['2026-10-20', 5]])!;
    expect(s.chg).toEqual({ d1: null, m1: null, ytd: null, y1: null });
  });
  it('returns null for empty series', () => {
    expect(changeStats([])).toBeNull();
  });
});

describe('downsample', () => {
  it('keeps the last point and the requested size', () => {
    const pts: Point[] = Array.from({ length: 1000 }, (_, i) => [`d${i}`, i]);
    const out = downsample(pts, 100);
    expect(out).toHaveLength(100);
    expect(out.at(-1)).toEqual(['d999', 999]);
  });
});
