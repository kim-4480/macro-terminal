import { describe, expect, it } from 'vitest';
import { isoWeek, weekChange } from '@/server/util';
import type { Point } from '@/shared/types';

describe('isoWeek', () => {
  it('uses Monday-start ISO weeks', () => {
    expect(isoWeek('2026-10-27')).toMatchObject({ year: 2026, week: 44, start: '2026-10-26', end: '2026-11-01', label: '2026-W44' });
    expect(isoWeek('2026-11-01').label).toBe('2026-W44'); // 일요일은 같은 주
    expect(isoWeek('2026-11-02').label).toBe('2026-W45');
  });
  it('handles year boundaries', () => {
    expect(isoWeek('2021-01-03').label).toBe('2020-W53');
    expect(isoWeek('2024-12-30').label).toBe('2025-W01');
  });
});

describe('weekChange', () => {
  const pts: Point[] = [['2026-10-16', 100], ['2026-10-19', 104], ['2026-10-20', 110], ['2026-10-26', 121]];
  it('compares with the last value on or before 7 days ago', () => {
    expect(weekChange(pts, 'pct')).toBeCloseTo(((121 / 104) - 1) * 100);
    expect(weekChange(pts, 'diff')).toBeCloseTo(17);
  });
  it('returns null without enough history', () => {
    expect(weekChange([['2026-10-26', 5]])).toBeNull();
    expect(weekChange([])).toBeNull();
  });
});

import { changeSince, monthLabel } from '@/server/util';
import { oneLiner } from '@/server/periodic';

describe('changeSince / monthLabel', () => {
  it('supports month offsets', () => {
    const pts: Point[] = [['2026-09-25', 200], ['2026-09-30', 210], ['2026-10-26', 231]];
    expect(changeSince(pts, { months: 1 })).toBeCloseTo(((231 / 200) - 1) * 100);
    expect(monthLabel('2026-10-27')).toBe('2026-10');
  });
});

describe('oneLiner (지난 브리핑의 한 줄 요약)', () => {
  it('extracts the Korean and English one-line sections', () => {
    expect(oneLiner('# 오늘의 브리핑\n\n## 한 줄 요약\n금리 상승과 유가 급등.\n\n## 거시경제\n...')).toBe('금리 상승과 유가 급등.');
    expect(oneLiner('# Daily\n## In one line\nRates up, oil up.\n### Next')).toBe('Rates up, oil up.');
    expect(oneLiner('# Weekly\n## The week in one line\nA calmer week.\n## Macro')).toBe('A calmer week.');
    expect(oneLiner('## 이번 주 한 줄 요약\n주간 요약 문장\n## 다음')).toBe('주간 요약 문장');
  });
  it('returns null when missing', () => {
    expect(oneLiner('# 제목\n본문만 있음')).toBeNull();
  });
});
