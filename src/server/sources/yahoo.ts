import type { Point } from '@/shared/types';
import { getJson, HttpError } from './http';

export interface Quote {
  symbol: string;
  name: string;
  currency: string | null;
  marketTime: number | null;
  points: Point[];
  via?: 'yahoo' | 'yfinance';
}

// 한꺼번에 많이 요청하면 429로 막히므로 동시 2개, 요청 간격 250ms로 제한한다.
const MAX_ACTIVE = 2;
const GAP_MS = 250;
let active = 0;
let lastStart = 0;
const waiting: { task: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];

function pump(): void {
  if (active >= MAX_ACTIVE || !waiting.length) return;
  const wait = Math.max(0, lastStart + GAP_MS - Date.now());
  if (wait) { setTimeout(pump, wait); return; }
  const job = waiting.shift()!;
  active++;
  lastStart = Date.now();
  job.task().then(job.resolve, job.reject).finally(() => { active--; pump(); });
  pump();
}

const limited = <T>(task: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    waiting.push({ task, resolve: resolve as (v: unknown) => void, reject });
    pump();
  });

/** query1 → query2 순서로, 429·5xx 일 때만 재시도 */
export async function yahooGet<T>(pathAndQuery: string): Promise<T> {
  let lastErr: unknown;
  for (const [i, host] of ['query1', 'query2', 'query1'].entries()) {
    try {
      return await limited(() => getJson<T>(`https://${host}.finance.yahoo.com${pathAndQuery}`, { retries: 0 }));
    } catch (err) {
      lastErr = err;
      if (!(err instanceof HttpError && (err.status === 429 || err.status >= 500))) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

interface ChartResponse {
  chart?: {
    result?: {
      meta: { shortName?: string; longName?: string; currency?: string; gmtoffset?: number; regularMarketPrice?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
    error?: { description?: string };
  };
}

/** Yahoo Finance 차트 엔드포인트(비공식, 개인 용도). 일별 종가 + 현재가. */
export async function yahooChart(symbol: string, range = '2y'): Promise<Quote> {
  const interval = range === 'max' || range === '10y' ? '1wk' : '1d';
  const json = await yahooGet<ChartResponse>(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
  const r = json.chart?.result?.[0];
  if (!r) throw new Error(json.chart?.error?.description || `${symbol}: 데이터 없음`);
  const { meta } = r;
  const offset = meta.gmtoffset ?? 0;
  const day = (t: number) => new Date((t + offset) * 1000).toISOString().slice(0, 10);
  const close = r.indicators?.quote?.[0]?.close ?? [];
  const points: Point[] = [];
  (r.timestamp ?? []).forEach((t, i) => {
    const c = close[i];
    if (c == null) return;
    const d = day(t);
    if (points.at(-1)?.[0] === d) points[points.length - 1] = [d, c];
    else points.push([d, c]);
  });
  if (meta.regularMarketPrice != null && meta.regularMarketTime) {
    const d = day(meta.regularMarketTime);
    const lastDay = points.at(-1)?.[0];
    if (lastDay === d) points[points.length - 1] = [d, meta.regularMarketPrice];
    else if (!lastDay || lastDay < d) points.push([d, meta.regularMarketPrice]);
  }
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    currency: meta.currency ?? null,
    marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    points,
    via: 'yahoo',
  };
}

export interface YahooSearchHit {
  symbol: string;
  name: string;
  exchange?: string;
  quoteType: string;
}

const QUOTE_TYPES = new Set(['EQUITY', 'ETF', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE', 'MUTUALFUND']);

export async function yahooSearch(q: string): Promise<YahooSearchHit[]> {
  const json = await yahooGet<{ quotes?: { symbol?: string; longname?: string; shortname?: string; exchDisp?: string; exchange?: string; quoteType?: string }[] }>(
    `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`,
  );
  return (json.quotes ?? [])
    .filter((x): x is typeof x & { symbol: string; quoteType: string } => !!x.symbol && !!x.quoteType && QUOTE_TYPES.has(x.quoteType))
    .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange, quoteType: x.quoteType }));
}
