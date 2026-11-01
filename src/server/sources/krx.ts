import { cached } from '../cache';
import { getResponse } from './http';

// KRX 상장법인 목록(한국어 회사명 → 종목코드). EUC-KR HTML 표.
const KRX_URL = 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13';

// 시장구분은 '유가'(코스피)·'코스닥'·'코넥스'로 표기된다. 코넥스는 Yahoo에 없어 제외.
const SUFFIX: Record<string, string> = { 유가: '.KS', 유가증권: '.KS', 코스닥: '.KQ' };
const MARKET_NAME: Record<string, string> = { 유가: '코스피', 유가증권: '코스피', 코스닥: '코스닥' };

export interface KrxCompany {
  name: string;
  market: string;
  symbol: string;
  sector: string;
}

export function parseKrxHtml(html: string): KrxCompany[] {
  const clean = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const out: KrxCompany[] = [];
  for (const [, row = ''] of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1] ?? ''));
    const [name, market, code, sector] = cells;
    if (!name || !market || !code || !SUFFIX[market]) continue;
    out.push({ name, market: MARKET_NAME[market]!, symbol: `${code}${SUFFIX[market]}`, sector: sector ?? '' });
  }
  return out;
}

async function fetchKrx(): Promise<KrxCompany[]> {
  const res = await getResponse(KRX_URL, { timeoutMs: 30_000 });
  const list = parseKrxHtml(new TextDecoder('euc-kr').decode(await res.arrayBuffer()));
  if (list.length < 1000) throw new Error('KRX 목록이 비정상적으로 짧음');
  return list;
}

const g = globalThis as typeof globalThis & { __krx?: Promise<KrxCompany[]> };

export function krxList(): Promise<KrxCompany[]> {
  g.__krx ??= cached('krx:list', 24 * 3600e3, fetchKrx).catch((err: unknown) => {
    g.__krx = undefined;
    throw err;
  });
  return g.__krx;
}
