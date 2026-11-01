import type { PortfolioConfig } from '@/shared/types';
import { assertSameOrigin, HttpStatusError, route } from '@/server/api';
import { savePortfolio } from '@/server/config';
import { syncLedger } from '@/server/journal/ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 편집기용 원본 설정(config/portfolio.json) */
export const GET = route(({ portfolio }): PortfolioConfig => portfolio);

/** 편집기 저장: 검증 후 파일에 쓴다(이전 파일은 portfolio.json.bak). 수량 변화는 매매 원장에 기록 */
export const PUT = route(async ({ req }) => {
  assertSameOrigin(req);
  const body: unknown = await req.json().catch(() => { throw new HttpStatusError(400, 'JSON 본문이 필요합니다'); });
  const portfolio = savePortfolio(body);
  // 편집기에서 수량을 바꾼 것도 매매로 기록한다
  const trades = await syncLedger(portfolio, { source: 'edit' }).catch(() => []);
  return { saved: true, portfolio: portfolio satisfies PortfolioConfig, trades: trades.map((t) => t.id) };
});
