import { assertSameOrigin, HttpStatusError, pickLang, route } from '@/server/api';
import { loadConfig } from '@/server/config';
import { computeProfile } from '@/server/journal/behavior';
import { analyzeDecision, confirmDecision, parseNote, saveNote, tradeById } from '@/server/journal/capture';
import { coach } from '@/server/journal/coach';
import { parseOrder, placeOrder } from '@/server/journal/orders';
import { journalTrades, journalView } from '@/server/journal/view';
import { llmStatus } from '@/server/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 매매일지: 잔고·거래(메모·판단·성과)·행동 패턴·AI 자기평가 */
export const GET = route(({ settings, portfolio }) => journalView(settings, portfolio));

const tradeId = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpStatusError(400, 'tradeId 가 필요합니다');
  return n;
};

/**
 * { action: 'order', symbol, side, qty, industry?, name?, chatId? } 모의 주문(포트폴리오 수량 변경 → 매매 기록)
 * { action: 'note', tradeId, memo, plan, planFollowed, target, stop } 거래 메모 → 판단 구조 분석 시작
 * { action: 'confirm', tradeId, emotions, strategy } 감정·전략 확인(고쳐서 확인)
 * { action: 'analyze', tradeId } 판단 구조 다시 뽑기
 * { action: 'coach', symbol, side, memo, emotions, strategy } 비슷한 과거 매매로 점검 질문
 */
export const POST = route(async ({ settings, req }) => {
  assertSameOrigin(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const lang = pickLang(typeof body.lang === 'string' ? body.lang : null);
  switch (body.action) {
    case 'order': {
      const trades = await placeOrder(parseOrder(body));
      return { ok: true, trades: trades.map((t) => t.id) };
    }
    case 'note': {
      const id = tradeId(body.tradeId);
      saveNote(id, parseNote(body));
      const online = (await llmStatus(settings.llm)).online;
      if (online) void analyzeDecision(id, settings, lang);
      return { ok: true, analyzing: online };
    }
    case 'analyze': {
      const id = tradeId(body.tradeId);
      tradeById(id);
      if (!(await llmStatus(settings.llm)).online) throw new HttpStatusError(503, '로컬 모델이 꺼져 있습니다');
      void analyzeDecision(id, settings, lang);
      return { ok: true, analyzing: true };
    }
    case 'confirm': {
      confirmDecision(tradeId(body.tradeId), body);
      return { ok: true };
    }
    case 'coach': {
      const { portfolio } = loadConfig();
      const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
      if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new HttpStatusError(400, '티커가 필요합니다');
      if (!(await llmStatus(settings.llm)).online) throw new HttpStatusError(503, '로컬 모델이 꺼져 있습니다');
      const { trades } = await journalTrades();
      const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      return coach(settings, portfolio, lang, trades, computeProfile(trades), {
        symbol,
        side: body.side === 'sell' ? 'sell' : 'buy',
        memo: str(body.memo, 1000),
        emotions: Array.isArray(body.emotions) ? body.emotions.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
        strategy: str(body.strategy, 30) || null,
      });
    }
    default:
      throw new HttpStatusError(400, '알 수 없는 작업');
  }
});
