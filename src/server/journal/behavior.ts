import { type BehaviorPattern, type BehaviorProfile, type Emotion, EMOTIONS, type PatternId, type Trade } from '@/shared/journal';
import { daysBetween, today } from '../util';

// Behavior Profile: 거래 기록에서 개인별 행동 패턴을 코드로 계산한다(숫자는 모델이 아니라 여기서 낸다).
//  - loss_aversion  손실 종목을 이익 종목보다 오래 들고 있다(처분 효과)
//  - impulsive      조급·욕심·만회 같은 감정이 드러나거나 계획 없이 계획을 어긴 거래
//  - quick_rebuy    판 지 7일 안에 같은 종목을 다시 산다
//  - plan_deviation 계획대로 하지 않았다고 답한 거래, 손절가보다 한참 아래에서 판 거래
//  - overtrading    주당 거래 수가 많다
//  - chasing        직전 5거래일 +8% 넘게 오른 뒤 사거나 -8% 넘게 내린 뒤 판다
// 패턴마다 해당 거래와 나머지 거래의 30일 시장 대비 성과(edge)를 함께 내서, 그 습관이 실제로 손해였는지 본다.

const IMPULSE: Emotion[] = ['fomo', 'impatience', 'greed', 'revenge'];
const REBUY_DAYS = 7;
const CHASE_PCT = 8;
const STOP_SLIP = 0.97;

/** 확정된 30일 edge(없으면 null) */
export const edge30 = (t: { outcomes: Trade['outcomes'] }) => t.outcomes.find((o) => o.horizon === 30 && o.final)?.edge ?? null;

const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

function pattern(id: PatternId, scope: Trade[], hit: Trade[], opts: { enough: boolean; flagged: boolean; metric?: number | null }): BehaviorPattern {
  const ids = new Set(hit.map((t) => t.id));
  return {
    id,
    enough: opts.enough,
    flagged: opts.enough && opts.flagged,
    count: hit.length,
    total: scope.length,
    metric: opts.metric ?? null,
    edgeHit: avg(hit.map(edge30)),
    edgeRest: avg(scope.filter((t) => !ids.has(t.id)).map(edge30)),
    tradeIds: hit.map((t) => t.id),
  };
}

export function computeProfile(all: Trade[], now = today()): BehaviorProfile {
  // 기초 보유는 판단이 아니므로 뺀다(기초 보유분을 판 매도는 판단이므로 넣는다)
  const trades = all.filter((t) => t.source !== 'initial').sort((a, b) => a.date.localeCompare(b.date) || a.executedAt - b.executedAt);
  const sells = trades.filter((t) => t.side === 'sell');
  const buys = trades.filter((t) => t.side === 'buy');
  const patterns: BehaviorPattern[] = [];

  // 손실 회피(처분 효과)
  const winners = sells.filter((t) => (t.realizedPct ?? 0) > 0 && t.holdDays != null);
  const losers = sells.filter((t) => (t.realizedPct ?? 0) < 0 && t.holdDays != null);
  const holdW = avg(winners.map((t) => t.holdDays));
  const holdL = avg(losers.map((t) => t.holdDays));
  const ratio = holdW != null && holdL != null ? holdL / Math.max(holdW, 0.5) : null;
  patterns.push(pattern('loss_aversion', sells, losers, { enough: winners.length >= 2 && losers.length >= 2, flagged: ratio != null && ratio >= 1.5, metric: ratio }));

  // 충동매매
  const impulsive = trades.filter((t) => {
    const emo = t.decision?.data?.emotions.some((e) => e.verified && IMPULSE.includes(e.label));
    const noPlan = t.note?.planFollowed === 'no' && !t.note.plan;
    return emo || noPlan;
  });
  const judged = trades.filter((t) => t.note || t.decision?.data);
  patterns.push(pattern('impulsive', judged, impulsive, { enough: judged.length >= 5, flagged: impulsive.length >= 2 && impulsive.length / judged.length >= 0.3, metric: judged.length ? impulsive.length / judged.length : null }));

  // 단기 재매수
  const rebuys = buys.filter((b) => sells.some((s) => s.symbol === b.symbol && s.date <= b.date && daysBetween(s.date, b.date) <= REBUY_DAYS && s.executedAt < b.executedAt));
  patterns.push(pattern('quick_rebuy', buys, rebuys, { enough: sells.length >= 1, flagged: rebuys.length >= 2, metric: rebuys.length }));

  // 계획 이탈
  const planned = trades.filter((t) => t.note?.planFollowed);
  const deviated = trades.filter((t) => t.note?.planFollowed === 'no' || t.note?.planFollowed === 'partial'
    || (t.side === 'sell' && t.note?.stop != null && t.price < t.note.stop * STOP_SLIP));
  patterns.push(pattern('plan_deviation', planned.length ? planned : trades, deviated, { enough: planned.length >= 3, flagged: planned.length > 0 && deviated.length / planned.length >= 0.3, metric: planned.length ? deviated.length / planned.length : null }));

  // 과매매(주당 거래 수)
  const weeks = trades.length ? Math.max(1, daysBetween(trades[0]!.date, now) / 7) : 1;
  const perWeek = trades.length / weeks;
  patterns.push(pattern('overtrading', trades, [], { enough: trades.length >= 8, flagged: perWeek >= 4, metric: perWeek }));

  // 추격 매수·공포 매도
  const chased = trades.filter((t) => t.priorMove != null && (t.side === 'buy' ? t.priorMove >= CHASE_PCT : t.priorMove <= -CHASE_PCT));
  const moved = trades.filter((t) => t.priorMove != null);
  patterns.push(pattern('chasing', moved, chased, { enough: moved.length >= 5, flagged: chased.length >= 2 && chased.length / moved.length >= 0.3, metric: moved.length ? chased.length / moved.length : null }));

  const finals = trades.map(edge30).filter((x): x is number => x != null);
  const emotions = EMOTIONS.map((label) => {
    const with_ = trades.filter((t) => t.decision?.data?.emotions.some((e) => e.label === label && e.verified));
    return { label, count: with_.length, avgEdge30: avg(with_.map(edge30)) };
  }).filter((e) => e.count > 0).sort((a, b) => b.count - a.count);

  return {
    trades: trades.length,
    sells: sells.length,
    hitRate30: finals.length ? finals.filter((x) => x > 0).length / finals.length : null,
    avgEdge30: avg(finals),
    patterns,
    emotions,
  };
}
