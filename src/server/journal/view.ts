import type { DatabaseSync } from 'node:sqlite';
import type { AiOpinion, AiScore, Decision, JournalView, Stance, Trade, TradeNote } from '@/shared/journal';
import type { Portfolio, Settings } from '../config';
import { llmStatus } from '../llm';
import { edge30, computeProfile } from './behavior';
import { analyzeDecision } from './capture';
import { journalDb } from './db';
import { ledgerView, syncLedger, tradeRows } from './ledger';
import { outcomesFor } from './outcomes';

// 매매일지 화면 데이터: 잔고 + 거래(메모·판단·성과) + 행동 패턴 + AI 의견과 같은 기준의 점수.

interface NoteRow { trade_id: number; memo: string; plan_followed: string | null; plan: string; target: number | null; stop: number | null; created_at: number }
interface DecisionRow { trade_id: number; status: string; data: string | null; confirmed: number; error: string | null; chat_excerpts: number; updated_at: number }
interface OpinionRow { id: number; chat_id: string | null; created_at: number; date: string; symbol: string; stance: string; text: string; base_price: number }

export async function journalTrades(db: DatabaseSync = journalDb()): Promise<{ trades: Trade[]; view: Awaited<ReturnType<typeof ledgerView>> }> {
  const rows = tradeRows(db);
  const view = await ledgerView(db);
  const notes = new Map((db.prepare('SELECT * FROM notes').all() as unknown as NoteRow[]).map((n) => [n.trade_id, n]));
  const decisions = new Map((db.prepare('SELECT * FROM decisions').all() as unknown as DecisionRow[]).map((d) => [d.trade_id, d]));
  const decided = rows.filter((r) => r.source !== 'initial');
  const outcomes = await outcomesFor(decided.map((r) => ({ id: r.id, symbol: r.symbol, date: r.trade_date, price: r.price, direction: r.side === 'buy' ? 'long' as const : 'short' as const })), 'outcomes', db);
  const trades: Trade[] = rows.map((r) => {
    const n = notes.get(r.id);
    const d = decisions.get(r.id);
    const real = view.replayed.realized.get(r.id);
    const note: TradeNote | null = n ? { memo: n.memo, planFollowed: (n.plan_followed as TradeNote['planFollowed']) ?? null, plan: n.plan, target: n.target, stop: n.stop, createdAt: n.created_at } : null;
    const decision: Decision | null = d ? {
      status: d.status as Decision['status'], data: d.data ? JSON.parse(d.data) as Decision['data'] : null, confirmed: !!d.confirmed,
      error: d.error, chatExcerpts: d.chat_excerpts, updatedAt: d.updated_at,
    } : null;
    return {
      id: r.id, symbol: r.symbol, name: r.name, side: r.side, qty: r.qty, price: r.price, currency: r.currency, fx: r.fx,
      date: r.trade_date, executedAt: r.executed_at, source: r.source,
      realizedBase: real?.amount ?? null, realizedPct: real?.pct ?? null, holdDays: real?.holdDays ?? null,
      priorMove: r.prior_move, note, decision, outcomes: outcomes.get(r.id) ?? [],
    };
  });
  return { trades: trades.reverse(), view };
}

/** 같은 기준의 점수: 확정된 30일 edge 가 플러스인 비율과 평균 */
function score(items: { outcomes: Trade['outcomes'] }[]): AiScore {
  const finals = items.map(edge30).filter((x): x is number => x != null);
  return {
    opinions: items.length,
    hitRate30: finals.length ? finals.filter((x) => x > 0).length / finals.length : null,
    avgEdge30: finals.length ? finals.reduce((s, x) => s + x, 0) / finals.length : null,
  };
}

export async function aiOpinions(db: DatabaseSync = journalDb()): Promise<AiOpinion[]> {
  const rows = db.prepare('SELECT * FROM ai_opinions ORDER BY created_at DESC LIMIT 200').all() as unknown as OpinionRow[];
  // 중립 의견은 방향이 없으니 성과는 보여 주되 적중 계산에서는 뺀다
  const outcomes = await outcomesFor(rows.map((r) => ({ id: r.id, symbol: r.symbol, date: r.date, price: r.base_price, direction: r.stance === 'down' ? 'short' as const : 'long' as const })), 'ai_outcomes', db);
  return rows.map((r) => ({
    id: r.id, chatId: r.chat_id, createdAt: r.created_at, date: r.date, symbol: r.symbol, stance: r.stance as Stance, text: r.text,
    basePrice: r.base_price, outcomes: outcomes.get(r.id) ?? [],
  }));
}

export async function journalView(settings: Settings, portfolio: Portfolio, db: DatabaseSync = journalDb()): Promise<JournalView> {
  // 파일을 직접 고쳤을 수도 있으니 볼 때마다 원장을 맞춘다
  await syncLedger(portfolio, { source: 'edit', db }).catch(() => []);
  const [{ trades, view }, opinions, llm] = await Promise.all([journalTrades(db), aiOpinions(db), llmStatus(settings.llm)]);
  // 모델이 꺼져 있을 때 남긴 메모는 모델이 돌아오면 이어서 분석한다(한 번에 몇 건씩)
  if (llm.online) {
    for (const t of trades.filter((x) => x.note && !x.decision).slice(0, 3)) {
      t.decision = { status: 'pending', data: null, confirmed: false, error: null, chatExcerpts: 0, updatedAt: Date.now() };
      void analyzeDecision(t.id, settings, settings.language, db);
    }
  }
  const directional = opinions.filter((o) => o.stance !== 'neutral');
  return {
    ledger: view.ledger,
    trades,
    profile: computeProfile(trades),
    ai: { opinions, score: { ...score(directional), opinions: opinions.length } },
    user: score(trades.filter((t) => t.source !== 'initial')),
    llmOnline: llm.online,
  };
}
