import { createHash } from 'node:crypto';
import type { ChangeMode, Point, Stats } from '@/shared/types';

export const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** 서버가 도는 곳(한국)의 오늘 날짜 */
export const today = (): string => isoDay(new Date(Date.now() - new Date().getTimezoneOffset() * 60e3));

export function shiftDate(dateStr: string, { days = 0, months = 0, years = 0 }: { days?: number; months?: number; years?: number }): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

export const daysBetween = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400e3;

/** dateStr 이전(같은 날 포함) 마지막 관측치. 이진 탐색. */
export function valueAtOrBefore(points: Point[], dateStr: string): Point | null {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= dateStr) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? points[ans]! : null;
}

/** 전년 동기 대비 변화율. 1년 전 관측치가 40일 이상 어긋나면 건너뛴다. */
export function yoy(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const target = shiftDate(p[0], { years: -1 });
    const ref = valueAtOrBefore(points, target);
    if (!ref || ref[1] === 0 || daysBetween(ref[0], target) > 40) continue;
    out.push([p[0], (p[1] / ref[1] - 1) * 100]);
  }
  return out;
}

export function changeStats(points: Point[], mode: ChangeMode = 'pct'): Stats | null {
  const last = points.at(-1);
  if (!last) return null;
  const calc = (p: Point | null | undefined): number | null => {
    if (!p || p === last) return null;
    if (mode === 'diff') return last[1] - p[1];
    return p[1] === 0 ? null : (last[1] / p[1] - 1) * 100;
  };
  const at = (o: { months?: number; years?: number }) => valueAtOrBefore(points, shiftDate(last[0], o));
  const ytdRef = valueAtOrBefore(points, `${Number(last[0].slice(0, 4)) - 1}-12-31`);
  return {
    date: last[0],
    value: last[1],
    chg: {
      d1: calc(points.length > 1 ? points.at(-2) : null),
      m1: calc(at({ months: -1 })),
      ytd: calc(ytdRef),
      y1: calc(at({ years: -1 })),
    },
  };
}

export function sinceDate(points: Point[], dateStr: string): Point[] {
  const i = points.findIndex((p) => p[0] >= dateStr);
  return i < 0 ? [] : points.slice(i);
}

export function downsample(points: Point[], max = 120): Point[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: Point[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor(i * step)]!);
  out.push(points.at(-1)!);
  return out;
}

export const lastYear = (points: Point[], max = 90): Point[] =>
  downsample(sinceDate(points, shiftDate(today(), { years: -1 })), max);

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** ISO 8601 주차(월요일 시작). 예: 2026-10-27 → { year: 2026, week: 44, start: '2026-10-26', end: '2026-11-01' } */
export function isoWeek(dateStr: string): { year: number; week: number; start: string; end: string; label: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay() || 7; // 월=1 … 일=7
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - jan1) / 86400e3 + 1) / 7);
  const start = shiftDate(dateStr, { days: 1 - dow });
  return { year, week, start, end: shiftDate(start, { days: 6 }), label: `${year}-W${String(week).padStart(2, '0')}` };
}

/** 마지막 관측일에서 offset 만큼 이전(그날 포함 그 이전 마지막 관측치) 대비 변화 */
export function changeSince(points: Point[], offset: { days?: number; months?: number }, mode: ChangeMode = 'pct'): number | null {
  const last = points.at(-1);
  if (!last) return null;
  const ref = valueAtOrBefore(points, shiftDate(last[0], { days: -(offset.days ?? 0), months: -(offset.months ?? 0) }));
  if (!ref || ref === last) return null;
  if (mode === 'diff') return last[1] - ref[1];
  return ref[1] === 0 ? null : (last[1] / ref[1] - 1) * 100;
}

/** 7일 전 대비 변화 */
export const weekChange = (points: Point[], mode: ChangeMode = 'pct'): number | null => changeSince(points, { days: 7 }, mode);

/** 'YYYY-MM' */
export const monthLabel = (dateStr: string): string => dateStr.slice(0, 7);
