import { describe, expect, it } from 'vitest';
import type { Trade } from '../src/shared/journal';
import type { Point } from '../src/shared/types';
import { interpretationLines } from '../src/server/journal/ai-eval';
import { computeProfile } from '../src/server/journal/behavior';
import { normalizeDecision } from '../src/server/journal/capture';
import { validChat } from '../src/server/journal/chats';
import { similarTrades } from '../src/server/journal/coach';
import { benchmarkFor, diffHoldings, priorMove, replay, type TradeRow } from '../src/server/journal/ledger';
import { computeOutcome } from '../src/server/journal/outcomes';

let nextId = 1;
const row = (p: Partial<TradeRow>): TradeRow => ({
  id: nextId++, symbol: 'AAA', name: 'A', side: 'buy', qty: 1, price: 100, currency: 'KRW', fx: 1,
  trade_date: '2026-01-01', executed_at: nextId, source: 'order', prior_move: null, chat_id: null, ...p,
});

describe('ledger replay (FIFO)', () => {
  it('computes realized P&L and holding days from the oldest lot', () => {
    const r = replay([
      row({ qty: 10, price: 100, trade_date: '2026-01-01' }),
      row({ qty: 10, price: 200, trade_date: '2026-01-11' }),
      row({ side: 'sell', qty: 15, price: 150, trade_date: '2026-01-21' }),
    ]);
    const sell = [...r.realized.values()][0]!;
    // 원가 10*100 + 5*200 = 2000, 매도 15*150 = 2250
    expect(sell.amount).toBe(250);
    expect(sell.pct).toBeCloseTo(12.5);
    expect(sell.holdDays).toBeCloseTo((10 * 20 + 5 * 10) / 15);
    expect(r.positions.get('AAA')!.lots).toEqual([{ qty: 5, price: 200, fx: 1, date: '2026-01-11' }]);
  });

  it('turns portfolio quantity changes into trades', () => {
    const r = replay([row({ symbol: 'AAA', qty: 5 }), row({ symbol: 'BBB', qty: 3 })]);
    const portfolio = { example: false, industries: [], holdings: [
      { symbol: 'AAA', industry: 'x', qty: 8 },
      { symbol: 'CCC', industry: 'x', qty: 2, name: '씨' },
    ] };
    expect(diffHoldings(portfolio, r)).toEqual([
      { symbol: 'AAA', name: 'AAA', side: 'buy', qty: 3 },
      { symbol: 'CCC', name: '씨', side: 'buy', qty: 2 },
      { symbol: 'BBB', name: 'A', side: 'sell', qty: 3 },
    ]);
  });

  it('picks a market index and the prior 5-day move', () => {
    expect(benchmarkFor('005930.KS')).toBe('^KS11');
    expect(benchmarkFor('NVDA')).toBe('^GSPC');
    const pts: Point[] = Array.from({ length: 7 }, (_, i) => [`2026-01-0${i + 1}`, 100 + i * 2]);
    expect(priorMove(pts, '2026-01-07')).toBeCloseTo((112 / 102 - 1) * 100);
  });
});

describe('outcomes', () => {
  const points: Point[] = [['2026-01-01', 100], ['2026-01-08', 110], ['2026-01-31', 90]];
  const bench: Point[] = [['2026-01-01', 1000], ['2026-01-08', 1020], ['2026-01-31', 1000]];
  it('measures the result and the edge vs the market', () => {
    const o = computeOutcome({ date: '2026-01-01', price: 100, direction: 'long', points, bench, benchSymbol: '^X', now: '2026-02-15' }, 7)!;
    expect(o.final).toBe(true);
    expect(o.ret).toBeCloseTo(10);
    expect(o.benchRet).toBeCloseTo(2);
    expect(o.edge).toBeCloseTo(8);
    // 매도는 판 뒤 주가가 시장보다 덜 올라야 플러스
    const s = computeOutcome({ date: '2026-01-01', price: 100, direction: 'short', points, bench, benchSymbol: '^X', now: '2026-02-15' }, 7)!;
    expect(s.edge).toBeCloseTo(-8);
  });
  it('shows a provisional value before the horizon ends', () => {
    const o = computeOutcome({ date: '2026-01-01', price: 100, direction: 'long', points, bench, benchSymbol: '^X', now: '2026-01-10' }, 30)!;
    expect(o.final).toBe(false);
    expect(o.date).toBe('2026-01-08');
    expect(computeOutcome({ date: '2026-01-31', price: 90, direction: 'long', points, bench, benchSymbol: '^X', now: '2026-01-31' }, 7)).toBeNull();
  });
});

const trade = (p: Partial<Trade>): Trade => ({
  id: nextId++, symbol: 'AAA', name: 'A', side: 'buy', qty: 1, price: 100, currency: 'KRW', fx: 1, date: '2026-01-01', executedAt: nextId,
  source: 'order', realizedBase: null, realizedPct: null, holdDays: null, priorMove: null, note: null, decision: null, outcomes: [], ...p,
});
const fin = (edge: number) => [{ horizon: 30 as const, final: true, date: '2026-02-01', ret: edge, benchSymbol: '^X', benchRet: 0, edge }];
const emo = (label: 'fomo' | 'calm') => ({ status: 'done' as const, confirmed: false, error: null, chatExcerpts: 0, updatedAt: 0,
  data: { rationale: [], emotions: [{ label, evidence: 'x', verified: true }], sources: [], strategy: 'momentum' as const, horizon: 'days' as const } });

describe('behavior profile', () => {
  it('flags holding losers longer than winners', () => {
    const p = computeProfile([
      trade({ side: 'sell', realizedPct: 10, holdDays: 3 }), trade({ side: 'sell', realizedPct: 5, holdDays: 5 }),
      trade({ side: 'sell', realizedPct: -8, holdDays: 30, outcomes: fin(-3) }), trade({ side: 'sell', realizedPct: -4, holdDays: 20, outcomes: fin(-1) }),
    ], '2026-03-01');
    const la = p.patterns.find((x) => x.id === 'loss_aversion')!;
    expect(la.flagged).toBe(true);
    expect(la.metric).toBeCloseTo(25 / 4);
    expect(la.edgeHit).toBeCloseTo(-2);
  });

  it('flags quick rebuys and impulsive trades, and ignores initial holdings', () => {
    const p = computeProfile([
      trade({ source: 'initial', symbol: 'ZZZ' }),
      trade({ side: 'sell', date: '2026-01-02', decision: emo('fomo') }),
      trade({ date: '2026-01-04', decision: emo('fomo'), outcomes: fin(-5) }),
      trade({ side: 'sell', date: '2026-01-05' }),
      trade({ date: '2026-01-06', decision: emo('calm'), outcomes: fin(2) }),
      trade({ date: '2026-01-07', note: { memo: '', plan: '', planFollowed: 'no', target: null, stop: null, createdAt: 0 } }),
      trade({ date: '2026-01-20', decision: emo('calm') }),
    ], '2026-03-01');
    expect(p.trades).toBe(6);
    expect(p.patterns.find((x) => x.id === 'quick_rebuy')!.count).toBe(3);
    const imp = p.patterns.find((x) => x.id === 'impulsive')!;
    expect(imp.count).toBe(3);
    expect(imp.flagged).toBe(true);
    expect(p.emotions.find((e) => e.label === 'fomo')!.avgEdge30).toBeCloseTo(-5);
    expect(p.hitRate30).toBeCloseTo(0.5);
  });
});

describe('decision extraction', () => {
  it('keeps enum values and checks emotion evidence against the note', () => {
    const d = normalizeDecision({
      rationale: ['급등을 놓치기 싫었다', 7], emotions: [{ label: 'fomo', evidence: '놓치면 후회할 것 같아서' }, { label: 'calm', evidence: '지어낸 말입니다요' }, { label: 'joy', evidence: 'x' }],
      sources: ['news', 'tv'], strategy: 'momentum', horizon: 'forever',
    }, ['오늘 너무 올라서 놓치면 후회할 것 같아서 샀다']);
    expect(d.rationale).toEqual(['급등을 놓치기 싫었다']);
    expect(d.emotions).toEqual([{ label: 'fomo', evidence: '놓치면 후회할 것 같아서', verified: true }, { label: 'calm', evidence: '지어낸 말입니다요', verified: false }]);
    expect(d.sources).toEqual(['news']);
    expect(normalizeDecision({ sources: ['ai_agent', 'chart'] }, [], false).sources).toEqual(['chart']);
    expect(d.horizon).toBe('unknown');
  });
});

describe('coaching and AI opinions', () => {
  it('ranks similar past trades', () => {
    const past = [trade({ symbol: 'AAA', decision: emo('fomo') }), trade({ symbol: 'BBB' }), trade({ symbol: 'AAA', side: 'sell' })];
    const s = similarTrades(past, { symbol: 'AAA', side: 'buy', memo: '', emotions: ['fomo'], priorMove: null, industry: null, strategy: 'momentum' }, { example: false, industries: [], holdings: [] }, 'ko');
    expect(s.map((x) => x.trade.id)).toEqual([past[0]!.id, past[2]!.id]);
    expect(s[0]!.reasons).toContain('같은 종목');
  });

  it('finds interpretation lines', () => {
    expect(interpretationLines('- 사실 [S1] “x”\n해석: 단기 반등 가능성이 있다.\n- Interpretation: momentum is fading')).toEqual(['단기 반등 가능성이 있다.', 'momentum is fading']);
  });

  it('validates stored chats', () => {
    expect(validChat({ id: 'abcdefgh-1', title: 't', updatedAt: 1, msgs: [{ role: 'user', content: 'hi' }, { role: 'x', content: 'no' }] })!.msgs).toHaveLength(1);
    expect(validChat({ id: 'bad id', msgs: [] })).toBeNull();
  });
});
