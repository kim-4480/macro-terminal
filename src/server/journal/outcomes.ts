import type { DatabaseSync } from 'node:sqlite';
import { HORIZONS, type Horizon, type Outcome } from '@/shared/journal';
import type { Point } from '@/shared/types';
import { shiftDate, today, valueAtOrBefore } from '../util';
import { journalDb } from './db';
import { benchmarkFor, closes } from './ledger';

// Outcome Tracking: 거래(또는 AI 의견) 이후 7·30·90일 주가와 시장지수 대비 성과.
//  - 기간이 다 지나면 확정값을 DB에 저장하고, 아직이면 오늘까지의 중간값을 보여 준다
//  - edge(시장 대비 판단 성과): 매수·상승 의견은 (주가 - 지수), 매도·하락 의견은 (지수 - 주가)
//    → 판 뒤 주가가 시장보다 더 올랐으면 그 매도의 edge 는 마이너스

export type Direction = 'long' | 'short';

export interface OutcomeInput {
  date: string;
  price: number;
  direction: Direction;
  points: Point[];
  bench: Point[];
  benchSymbol: string;
  /** 계산 기준일(테스트용, 기본 오늘) */
  now?: string;
}

export function computeOutcome(i: OutcomeInput, horizon: Horizon): Outcome | null {
  const now = i.now ?? today();
  const due = shiftDate(i.date, { days: horizon });
  const final = due <= now;
  const end = final ? due : now;
  if (end <= i.date) return null;
  const p = valueAtOrBefore(i.points, end);
  if (!p || p[0] <= i.date && !final) return null;
  const ret = (p[1] / i.price - 1) * 100;
  const b0 = valueAtOrBefore(i.bench, i.date);
  const b1 = valueAtOrBefore(i.bench, end);
  const benchRet = b0 && b1 && b0[1] ? (b1[1] / b0[1] - 1) * 100 : null;
  const edge = benchRet == null ? null : i.direction === 'long' ? ret - benchRet : benchRet - ret;
  return { horizon, final, date: p[0], ret, benchSymbol: i.benchSymbol, benchRet, edge };
}

type Table = 'outcomes' | 'ai_outcomes';
const KEY: Record<Table, string> = { outcomes: 'trade_id', ai_outcomes: 'opinion_id' };

interface StoredRow { id: number; horizon: number; date: string; ret: number; bench_symbol: string; bench_ret: number | null }

function storedOutcomes(db: DatabaseSync, table: Table): Map<number, Map<number, StoredRow>> {
  const rows = db.prepare(`SELECT ${KEY[table]} AS id, horizon, date, ret, bench_symbol, bench_ret FROM ${table}`).all() as unknown as StoredRow[];
  const out = new Map<number, Map<number, StoredRow>>();
  for (const r of rows) {
    const m = out.get(r.id) ?? new Map<number, StoredRow>();
    m.set(r.horizon, r);
    out.set(r.id, m);
  }
  return out;
}

const fromStored = (r: StoredRow, direction: Direction): Outcome => ({
  horizon: r.horizon as Horizon, final: true, date: r.date, ret: r.ret, benchSymbol: r.bench_symbol, benchRet: r.bench_ret,
  edge: r.bench_ret == null ? null : direction === 'long' ? r.ret - r.bench_ret : r.bench_ret - r.ret,
});

export interface Subject { id: number; symbol: string; date: string; price: number; direction: Direction }

/** 대상들(거래·AI 의견)의 기간 성과. 확정된 것은 저장해 두고 다시 계산하지 않는다 */
export async function outcomesFor(subjects: Subject[], table: Table, db: DatabaseSync = journalDb()): Promise<Map<number, Outcome[]>> {
  const stored = storedOutcomes(db, table);
  const series = new Map<string, Promise<Point[] | null>>();
  const load = (sym: string) => {
    if (!series.has(sym)) series.set(sym, closes(sym).then((d) => d.points, () => null));
    return series.get(sym)!;
  };
  const insert = db.prepare(`INSERT OR REPLACE INTO ${table} (${KEY[table]}, horizon, date, ret, bench_symbol, bench_ret, measured_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const result = new Map<number, Outcome[]>();
  await Promise.all(subjects.map(async (s) => {
    const have = stored.get(s.id);
    const list: Outcome[] = [];
    const missing = HORIZONS.filter((h) => !have?.has(h));
    if (missing.length) {
      const benchSymbol = benchmarkFor(s.symbol);
      const [points, bench] = await Promise.all([load(s.symbol), load(benchSymbol)]);
      if (points) {
        for (const h of missing) {
          const o = computeOutcome({ ...s, points, bench: bench ?? [], benchSymbol }, h);
          if (!o) continue;
          // 지수를 못 받았으면 저장하지 않고 다음에 다시 잰다
          if (o.final && o.benchRet != null) insert.run(s.id, h, o.date, o.ret, o.benchSymbol, o.benchRet, Date.now());
          list.push(o);
        }
      }
    }
    for (const r of have?.values() ?? []) list.push(fromStored(r, s.direction));
    result.set(s.id, list.sort((a, b) => a.horizon - b.horizon));
  }));
  return result;
}
