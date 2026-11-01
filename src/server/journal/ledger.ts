import { baseCurrency } from '../config';
import type { DatabaseSync } from 'node:sqlite';
import type { Ledger, Position, TradeSide, TradeSource } from '@/shared/journal';
import type { Point } from '@/shared/types';
import { cleanCompanyName } from '../company';
import type { Portfolio } from '../config';
import { quote } from '../market-data';
import { daysBetween, today, valueAtOrBefore } from '../util';
import { journalDb, tx } from './db';

// 모의 매매 원장: 증권사 대신 포트폴리오 수량 변화를 매매로 본다(실제 주문·돈 이동 없음).
//  - 처음 한 번은 그때 있던 보유분을 "기초 보유"로 잡는다(행동 분석에서는 빼고 매입 단가에만 쓴다)
//  - 그 뒤로 수량이 늘면 매수, 줄면(빠지면) 매도. 체결가는 그때의 최근 종가, 외화는 그날 환율로 원화 환산
//  - 손익·보유 일수는 날짜순 FIFO 로 다시 계산한다

export interface TradeRow {
  id: number;
  symbol: string;
  name: string;
  side: TradeSide;
  qty: number;
  price: number;
  currency: string;
  fx: number;
  trade_date: string;
  executed_at: number;
  source: TradeSource;
  prior_move: number | null;
  chat_id: string | null;
}

export interface Lot { qty: number; price: number; fx: number; date: string }

export interface Replayed {
  positions: Map<string, { name: string; currency: string; lots: Lot[] }>;
  /** 매도 거래별 실현 손익(원화)·수익률·보유 일수(수량 가중) */
  realized: Map<number, { amount: number; pct: number; holdDays: number }>;
}

const EPS = 1e-9;

export function replay(rows: TradeRow[]): Replayed {
  const sorted = [...rows].sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.executed_at - b.executed_at || a.id - b.id);
  const out: Replayed = { positions: new Map(), realized: new Map() };
  for (const t of sorted) {
    const pos = out.positions.get(t.symbol) ?? { name: t.name, currency: t.currency, lots: [] };
    pos.name = t.name;
    if (t.side === 'buy') {
      pos.lots.push({ qty: t.qty, price: t.price, fx: t.fx, date: t.trade_date });
    } else {
      let left = t.qty;
      let cost = 0;
      let dayQty = 0;
      while (left > EPS && pos.lots.length) {
        const lot = pos.lots[0]!;
        const q = Math.min(lot.qty, left);
        cost += q * lot.price * lot.fx;
        dayQty += q * daysBetween(lot.date, t.trade_date);
        lot.qty -= q;
        left -= q;
        if (lot.qty <= EPS) pos.lots.shift();
      }
      const sold = t.qty - left;
      if (sold > EPS) {
        const proceeds = sold * t.price * t.fx;
        out.realized.set(t.id, { amount: proceeds - cost, pct: cost ? (proceeds / cost - 1) * 100 : 0, holdDays: dayQty / sold });
      }
    }
    if (pos.lots.length) out.positions.set(t.symbol, pos);
    else out.positions.delete(t.symbol);
  }
  return out;
}

export const heldQty = (r: Replayed, symbol: string) => r.positions.get(symbol)?.lots.reduce((s, l) => s + l.qty, 0) ?? 0;

export function tradeRows(db: DatabaseSync = journalDb()): TradeRow[] {
  return db.prepare('SELECT * FROM trades ORDER BY trade_date, executed_at, id').all() as unknown as TradeRow[];
}

/** 기록을 시작한 시각(없으면 아직 기초 보유를 잡지 않음) */
export function ledgerSince(db: DatabaseSync = journalDb()): number | null {
  const row = db.prepare('SELECT created_at FROM account WHERE id = 1').get() as { created_at: number } | undefined;
  return row?.created_at ?? null;
}

/** 시장지수(사후 성과 비교용) */
export function benchmarkFor(symbol: string): string {
  const s = symbol.toUpperCase();
  const map: [string, string][] = [['.KS', '^KS11'], ['.KQ', '^KQ11'], ['.T', '^N225'], ['.HK', '^HSI'], ['.SS', '000001.SS'], ['.SZ', '000001.SS'],
    ['.L', '^FTSE'], ['.DE', '^GDAXI'], ['.PA', '^FCHI'], ['.AS', '^AEX'], ['.TW', '^TWII']];
  return map.find(([suf]) => s.endsWith(suf))?.[1] ?? '^GSPC';
}

export async function closes(symbol: string): Promise<{ points: Point[]; name: string; currency: string }> {
  const q = await quote(symbol);
  if (!q.points.length) throw new Error(`${symbol} 시세 없음`);
  return { points: q.points, name: q.name, currency: q.currency ?? baseCurrency() };
}

export async function fxAt(currency: string, date: string): Promise<number> {
  const base = baseCurrency();
  if (currency === base) return 1;
  const { points } = await closes(`${currency}${base}=X`);
  const p = valueAtOrBefore(points, date) ?? points.at(-1);
  if (!p) throw new Error(`${currency}/${base} 환율 없음`);
  return p[1];
}

/** 체결 전 5거래일 주가 변화(%) — 급등·급락 직후 거래(추격)를 본다 */
export function priorMove(points: Point[], date: string): number | null {
  const idx = points.findLastIndex((p) => p[0] <= date);
  if (idx < 5) return null;
  const a = points[idx - 5]![1];
  return a ? (points[idx]![1] / a - 1) * 100 : null;
}

export interface QtyChange { symbol: string; name: string; side: TradeSide; qty: number }

/** 포트폴리오 수량과 원장의 차이 = 새 매매 */
export function diffHoldings(portfolio: Portfolio, r: Replayed): QtyChange[] {
  const out: QtyChange[] = [];
  const seen = new Set<string>();
  for (const h of portfolio.holdings) {
    const sym = h.symbol.toUpperCase();
    seen.add(sym);
    const d = (h.qty ?? 0) - heldQty(r, sym);
    if (Math.abs(d) > EPS) out.push({ symbol: sym, name: h.name || h.nameEn || sym, side: d > 0 ? 'buy' : 'sell', qty: Math.abs(d) });
  }
  // 포트폴리오에서 빠진 종목 = 전량 매도
  for (const [sym, p] of r.positions) {
    if (!seen.has(sym)) out.push({ symbol: sym, name: p.name, side: 'sell', qty: heldQty(r, sym) });
  }
  return out;
}

const g = globalThis as typeof globalThis & { __ledgerChain?: Promise<unknown> };

/**
 * 포트폴리오 → 원장 맞추기. 처음이면 기초 보유를 잡고, 아니면 수량 차이를 매매로 기록한다.
 * 동시에 두 번 돌지 않게 줄 세운다. 시세를 못 받은 종목은 건너뛰고 다음에 다시 맞춘다.
 */
export function syncLedger(portfolio: Portfolio, opts: { source?: TradeSource; chatId?: string | null; db?: DatabaseSync } = {}): Promise<TradeRow[]> {
  const run = async (): Promise<TradeRow[]> => {
    const db = opts.db ?? journalDb();
    const first = ledgerSince(db) == null;
    const changes = diffHoldings(portfolio, replay(tradeRows(db)));
    const date = today();
    const priced = await Promise.all(changes.map(async (c) => {
      try {
        const d = await closes(c.symbol);
        const last = d.points.at(-1)!;
        return { ...c, name: c.name === c.symbol ? cleanCompanyName(d.name) || c.symbol : c.name, price: last[1], currency: d.currency, fx: await fxAt(d.currency, date), prior: priorMove(d.points, last[0]) };
      } catch {
        return null;
      }
    }));
    return tx(db, () => {
      if (first) db.prepare('INSERT INTO account (id, initial_base, cash_base, created_at) VALUES (1, 0, 0, ?)').run(Date.now());
      const added: TradeRow[] = [];
      for (const c of priced) {
        if (!c) continue;
        const row = {
          symbol: c.symbol, name: c.name, side: c.side, qty: c.qty, price: c.price, currency: c.currency, fx: c.fx,
          trade_date: date, executed_at: Date.now(), source: first ? 'initial' as const : opts.source ?? 'edit',
          prior_move: c.prior, chat_id: opts.chatId ?? null,
        };
        const info = db.prepare(`INSERT INTO trades (symbol, name, side, qty, price, currency, fx, trade_date, executed_at, source, prior_move, chat_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(row.symbol, row.name, row.side, row.qty, row.price, row.currency, row.fx, row.trade_date, row.executed_at, row.source, row.prior_move, row.chat_id);
        added.push({ id: Number(info.lastInsertRowid), ...row });
      }
      return added;
    });
  };
  const prev = g.__ledgerChain ?? Promise.resolve();
  const p = prev.then(run, run);
  g.__ledgerChain = p.catch(() => undefined);
  return p;
}

/** 잔고 평가(현재가·원화 환산) */
export async function ledgerView(db: DatabaseSync = journalDb()): Promise<{ ledger: Ledger; replayed: Replayed }> {
  const r = replay(tradeRows(db));
  const positions: Position[] = await Promise.all([...r.positions].map(async ([symbol, p]) => {
    const qty = p.lots.reduce((s, l) => s + l.qty, 0);
    const costBase = p.lots.reduce((s, l) => s + l.qty * l.price * l.fx, 0);
    const avgPrice = p.lots.reduce((s, l) => s + l.qty * l.price, 0) / qty;
    let last: number | null = null;
    let valueBase: number | null = null;
    try {
      last = (await closes(symbol)).points.at(-1)![1];
      valueBase = qty * last * (await fxAt(p.currency, today()));
    } catch { /* 시세 없으면 평가 생략 */ }
    return {
      symbol, name: p.name, qty, avgPrice, currency: p.currency, costBase, last, valueBase,
      pnlBase: valueBase == null ? null : valueBase - costBase,
      pnlPct: valueBase == null || !costBase ? null : (valueBase / costBase - 1) * 100,
    };
  }));
  const costBase = positions.reduce((s, p) => s + p.costBase, 0);
  const valueBase = positions.every((p) => p.valueBase != null) ? positions.reduce((s, p) => s + (p.valueBase ?? 0), 0) : null;
  return {
    replayed: r,
    ledger: {
      positions: positions.sort((a, b) => (b.valueBase ?? 0) - (a.valueBase ?? 0)),
      costBase,
      valueBase,
      unrealizedBase: valueBase == null ? null : valueBase - costBase,
      unrealizedPct: valueBase == null || !costBase ? null : (valueBase / costBase - 1) * 100,
      realizedBase: [...r.realized.values()].reduce((s, x) => s + x.amount, 0),
      since: ledgerSince(db),
    },
  };
}
