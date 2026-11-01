import { baseCurrency } from '../config';
import { baseLang, withLang, type BaseLang } from '@/shared/languages';
import type { BehaviorProfile, CoachView, SimilarTrade, Trade, TradeSide } from '@/shared/journal';
import type { Lang } from '@/shared/types';
import { checkQuotes } from '../citations';
import type { Portfolio, Settings } from '../config';
import { chat } from '../llm';
import { errorMessage } from '../util';
import { edge30 } from './behavior';
import { closes, priorMove } from './ledger';

// Personalized Coaching: 지금 하려는(방금 한) 매매와 비슷한 과거 거래를 찾아, 그 판단과 결과를 근거로
// 점검 질문과 개선 방법을 준다. 사고팔라는 말은 하지 않는다(결정은 사용자).
// 비슷함은 코드로 점수 매긴다: 같은 종목·같은 업계·같은 방향·같은 전략·겹치는 감정·비슷한 직전 주가 흐름.

export interface CoachInput { symbol: string; side: TradeSide; memo: string; emotions: string[]; priorMove: number | null; industry: string | null; strategy: string | null }

export function similarTrades(trades: Trade[], input: CoachInput, portfolio: Portfolio, lang: Lang, max = 5): SimilarTrade[] {
  const ko = lang === 'ko';
  const industryOf = (sym: string) => portfolio.holdings.find((h) => h.symbol.toUpperCase() === sym)?.industry ?? null;
  return trades
    .filter((t) => t.source !== 'initial')
    .map((t) => {
      let score = 0;
      const reasons: string[] = [];
      if (t.symbol === input.symbol) { score += 3; reasons.push(ko ? '같은 종목' : 'same ticker'); }
      else if (input.industry && industryOf(t.symbol) === input.industry) { score += 1; reasons.push(ko ? '같은 업계' : 'same industry'); }
      if (t.side === input.side) { score += 1; reasons.push(input.side === 'buy' ? (ko ? '매수' : 'buy') : (ko ? '매도' : 'sell')); }
      const s = t.decision?.data?.strategy;
      if (input.strategy && s && s === input.strategy && s !== 'other') { score += 2; reasons.push(ko ? `같은 전략(${s})` : `same strategy (${s})`); }
      const shared = (t.decision?.data?.emotions ?? []).filter((e) => e.verified && input.emotions.includes(e.label)).map((e) => e.label);
      if (shared.length) { score += 2 * shared.length; reasons.push(`${ko ? '같은 감정' : 'same emotion'}: ${shared.join(', ')}`); }
      if (input.priorMove != null && t.priorMove != null && Math.sign(input.priorMove) === Math.sign(t.priorMove) && Math.abs(input.priorMove) >= 4 && Math.abs(t.priorMove) >= 4) {
        score += 1; reasons.push(ko ? '비슷한 직전 주가 흐름' : 'similar prior move');
      }
      return { trade: t, score, reasons };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.trade.executedAt - a.trade.executedAt)
    .slice(0, max);
}

const fmt = (v: number | null | undefined, d = 1) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
/** 천 단위 쉼표(모델이 자릿수를 잘못 옮기지 않게) */
const num = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 과거 거래 하나 = 근거 하나(T#). 모델은 이 글에서만 발췌한다 */
export function tradeSourceText(t: Trade, lang: Lang): string {
  const ko = lang === 'ko';
  const d = t.decision?.data;
  const o = (h: number) => t.outcomes.find((x) => x.horizon === h);
  return [
    `${t.date} ${hhmm(t.executedAt)} ${t.side === 'buy' ? (ko ? '매수' : 'BUY') : (ko ? '매도' : 'SELL')} ${t.name} (${t.symbol}) ${num(t.qty)}${ko ? '주' : ' sh'} @ ${num(t.price)} ${t.currency}`,
    // 금액은 미리 계산해 둔다(작은 모델이 곱셈을 틀린다)
    `${ko ? '체결금액' : 'amount'}: ${num(t.qty * t.price)} ${t.currency}${t.currency !== baseCurrency() ? ` (≈ ${num(Math.round(t.qty * t.price * t.fx))} ${baseCurrency()})` : ''}`,
    t.priorMove != null ? `${ko ? '직전 5거래일' : 'prior 5 days'}: ${fmt(t.priorMove)}` : '',
    t.realizedPct != null ? `${ko ? '실현 손익' : 'realized'}: ${num(Math.round(t.realizedBase ?? 0))} ${baseCurrency()}, ${fmt(t.realizedPct)} (${ko ? '보유' : 'held'} ${t.holdDays?.toFixed(0)}${ko ? '일' : 'd'})` : '',
    t.note?.memo ? `${ko ? '메모' : 'note'}: ${t.note.memo}` : '',
    t.note?.plan ? `${ko ? '계획' : 'plan'}: ${t.note.plan}` : '',
    t.note?.planFollowed ? `${ko ? '계획 준수' : 'followed plan'}: ${t.note.planFollowed}` : '',
    d?.rationale.length ? `${ko ? '판단 근거' : 'rationale'}: ${d.rationale.join(' / ')}` : '',
    d?.emotions.length ? `${ko ? '감정' : 'emotions'}: ${d.emotions.map((e) => e.label).join(', ')}` : '',
    d ? `${ko ? '전략' : 'strategy'}: ${d.strategy}` : '',
    ...[7, 30, 90].map((h) => { const x = o(h); return x ? `${h}${ko ? '일 뒤' : 'd later'}${x.final ? '' : ko ? '(진행 중)' : ' (so far)'}: ${ko ? '주가' : 'price'} ${fmt(x.ret)}, ${ko ? '시장' : 'market'} ${fmt(x.benchRet)}, ${ko ? '시장 대비 판단 성과' : 'edge vs market'} ${fmt(x.edge)}` : ''; }),
  ].filter(Boolean).join('\n');
}

const SYSTEM: Record<BaseLang, string> = {
  ko: `너는 사용자의 매매 습관을 함께 돌아보는 코치다. 사용자가 지금 하려는(또는 방금 한) 매매와, 근거로 주는 과거의 비슷한 거래(T1…)와 행동 패턴만 보고 쓴다.
형식(마크다운):
## 점검 질문
- 질문 3개. 과거 거래와 이어서 묻는다. 예: "지난번 비슷하게 급등 뒤 샀을 때(T2) 30일 뒤 시장보다 낮았는데, 이번엔 무엇이 다른가요?"
## 개선 방법
- 1~2개. 구체적인 습관(계획 미리 적기, 손절가 정하기, 하루 기다리기 등).
과거 거래를 말할 때는 끝에 [T#] “그 근거 글에서 글자 그대로 복사한 부분”을 붙인다. 근거에 없는 숫자는 쓰지 않는다.
사라·팔라·비중을 늘려라 같은 매매 지시는 하지 않는다. 결정은 사용자가 한다. 과거 거래가 없으면 일반적인 점검 질문만 쓴다.
한국어로 쓰고 한자·중국어·일본어 표현을 섞지 않는다.`,
  en: `You coach the user to reflect on trading habits. Use only the trade they are about to make (or just made), the similar past trades given as evidence (T1…) and the behavior patterns.
Format (markdown):
## Questions to check
- 3 questions tied to past trades, e.g. "Last time you bought after a spike (T2), it lagged the market 30 days later — what is different now?"
## How to improve
- 1–2 concrete habits (write the plan first, set a stop, wait a day, etc.).
When citing a past trade, end with [T#] "text copied verbatim from that evidence". No numbers that are not in the evidence.
Never tell the user to buy, sell or resize. The decision is theirs. If there are no past trades, give general check questions only.`,
};

export async function coach(settings: Settings, portfolio: Portfolio, lang: Lang, trades: Trade[], profile: BehaviorProfile, raw: Omit<CoachInput, 'priorMove' | 'industry'>): Promise<CoachView> {
  let prior: number | null = null;
  try {
    const d = await closes(raw.symbol);
    prior = priorMove(d.points, d.points.at(-1)![0]);
  } catch { /* 시세 없으면 흐름 비교만 뺀다 */ }
  const industry = portfolio.holdings.find((h) => h.symbol.toUpperCase() === raw.symbol)?.industry ?? null;
  const input: CoachInput = { ...raw, priorMove: prior, industry };
  const similar = similarTrades(trades, input, portfolio, lang);
  const ko = lang === 'ko';
  const sources = new Map(similar.map((s, i) => [`T${i + 1}`, tradeSourceText(s.trade, lang)]));
  const flagged = profile.patterns.filter((p) => p.flagged).map((p) => `${p.id} (${p.count}/${p.total}${p.edgeHit != null ? `, edge ${fmt(p.edgeHit)} vs ${fmt(p.edgeRest)}` : ''})`);
  const user = [
    `${ko ? '지금 매매' : 'Current trade'}: ${raw.side === 'buy' ? (ko ? '매수' : 'BUY') : (ko ? '매도' : 'SELL')} ${raw.symbol}${prior != null ? ` (${ko ? '직전 5거래일' : 'prior 5 days'} ${fmt(prior)})` : ''}`,
    raw.memo ? `${ko ? '메모' : 'Note'}: ${raw.memo}` : '',
    raw.emotions.length ? `${ko ? '감정' : 'Emotions'}: ${raw.emotions.join(', ')}` : '',
    `${ko ? '눈에 띄는 행동 패턴' : 'Flagged patterns'}: ${flagged.join('; ') || (ko ? '없음(거래가 적거나 패턴 없음)' : 'none yet')}`,
    ...[...sources].map(([id, text]) => `\n[${id}]\n${text}`),
  ].filter(Boolean).join('\n');
  try {
    let md = await chat(settings.llm, [{ role: 'system', content: withLang(SYSTEM[baseLang(lang)], lang) }, { role: 'user', content: user }], { maxTokens: 900, temperature: 0.3 });
    // 근거 번호를 S 형식으로 바꿔 기존 발췌 대조를 그대로 쓴다
    const checks = checkQuotes(md.replace(/\[T(\d+)\]/g, '[S$1]'), new Map([...sources].map(([k, v]) => [k.replace('T', 'S'), v])));
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) {
      md += `\n\n> ${ko ? '⚠ 원문에서 찾지 못한 발췌' : '⚠ excerpts not found in the record'}: ${bad.map((b) => `[T${b.sourceId.slice(1)}]`).join(', ')}`;
    }
    return { symbol: raw.symbol, side: raw.side, similar, markdown: md, error: null };
  } catch (err) {
    return { symbol: raw.symbol, side: raw.side, similar, markdown: null, error: errorMessage(err) };
  }
}
