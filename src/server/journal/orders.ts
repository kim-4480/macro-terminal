import type { TradeSide } from '@/shared/journal';
import { HttpStatusError } from '../api';
import { resolveNames, SYMBOL_RE } from '../company';
import { loadConfig, savePortfolio } from '../config';
import { errorMessage } from '../util';
import { closes, syncLedger, type TradeRow } from './ledger';

// 주문창(모의): 포트폴리오 수량을 바꾸고 → 원장이 그 차이를 매매로 기록한다.
// 전량 매도하면 포트폴리오에서 빠진다(실제 잔고 화면처럼). 새 종목 매수는 업계를 골라야 한다.

export interface OrderInput {
  symbol: string;
  side: TradeSide;
  qty: number;
  /** 새 종목을 살 때 넣을 업계 id */
  industry: string | null;
  /** 한국어 이름 힌트(검색 결과의 이름) */
  name: string | null;
  chatId: string | null;
}

const MAX_QTY = 1e9;

export function parseOrder(raw: unknown): OrderInput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const symbol = typeof o.symbol === 'string' ? o.symbol.trim().toUpperCase() : '';
  if (!SYMBOL_RE.test(symbol)) throw new HttpStatusError(400, '티커가 올바르지 않습니다');
  if (o.side !== 'buy' && o.side !== 'sell') throw new HttpStatusError(400, '매수·매도를 고르세요');
  const qty = Number(o.qty);
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) throw new HttpStatusError(400, '수량이 올바르지 않습니다');
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const chatId = str(o.chatId, 64);
  return { symbol, side: o.side, qty, industry: str(o.industry, 60), name: str(o.name, 80), chatId: chatId && /^[A-Za-z0-9-]{8,64}$/.test(chatId) ? chatId : null };
}

/** 주문 → 포트폴리오 수량 변경 → 원장 기록. 새로 생긴 거래를 돌려준다 */
export async function placeOrder(o: OrderInput): Promise<TradeRow[]> {
  const { portfolio } = loadConfig();
  const held = portfolio.holdings.find((h) => h.symbol.toUpperCase() === o.symbol);
  let holdings = portfolio.holdings;
  if (o.side === 'buy') {
    try { await closes(o.symbol); } catch (err) { throw new HttpStatusError(404, `시세를 찾지 못했습니다: ${errorMessage(err)}`); }
    if (held) {
      holdings = holdings.map((h) => (h === held ? { ...h, qty: (h.qty ?? 0) + o.qty } : h));
    } else {
      if (!o.industry || !portfolio.industries.some((i) => i.id === o.industry)) throw new HttpStatusError(400, '새 종목은 업계를 골라야 합니다');
      const names = await resolveNames({ kind: 'listed', symbol: o.symbol, hint: o.name }, portfolio);
      holdings = [...holdings, { symbol: o.symbol, name: names.nameKo, nameEn: names.nameEn, industry: o.industry, qty: o.qty }];
    }
  } else {
    const have = held?.qty ?? 0;
    if (!held || have <= 0) throw new HttpStatusError(400, '보유하지 않은 종목입니다');
    if (o.qty > have + 1e-9) throw new HttpStatusError(400, `보유 수량(${have})보다 많이 팔 수 없습니다`);
    const left = have - o.qty;
    holdings = left > 1e-9 ? holdings.map((h) => (h === held ? { ...h, qty: left } : h)) : holdings.filter((h) => h !== held);
  }
  const saved = savePortfolio({ ...portfolio, example: false, holdings });
  return syncLedger(saved, { source: 'order', chatId: o.chatId });
}
