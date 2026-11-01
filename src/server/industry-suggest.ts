import { peek, put } from './cache';
import type { Settings } from './config';
import { chat, llmStatus, parseJsonArray } from './llm';
import { yahooGet, yahooSearch } from './sources/yahoo';

// 포트폴리오 업계 자동 채우기: 이름만 넣으면 에이전트(모델)가 영어 이름·대표 지표·뉴스 검색어를 제안한다.
// 대표 지표는 업계 테마 ETF·지수: 모델이 고른 것이 시장 전체 ETF(QQQ 등)거나 이름이 업계와 안 맞으면
// Yahoo에서 업계 이름으로 찾은 테마 ETF를 쓴다. Yahoo에서 실제로 조회되는 것만 쓴다.

export interface IndustrySuggestion {
  labelEn: string;
  /** 업계를 대표하는 ETF·지수(확인 안 되면 null) */
  benchmark: string | null;
  en: string[];
  ko: string[];
}

const PROMPT = `The user is setting up an industry group for their stock portfolio and typed only its name (Korean or English).
Reply with ONLY a JSON array with one object:
[{"labelEn": short English name of the industry, "benchmark": Yahoo Finance ticker of the most representative US-listed ETF or index for this industry (e.g. semiconductors → ^SOX or SOXX, banks → KBE, biotech → XBI, defense → ITA, data centers → DTCR) or null. Never a broad market fund such as QQQ, SPY or VTI, "en": two short English news search queries about this industry's trends, "ko": two short Korean news search queries about this industry's trends}]
Queries should find industry-wide news (demand, prices, policy), not one company. Do not put years or dates in the queries.`;

const clean = (v: unknown, max = 60): string => (typeof v === 'string' ? v.replace(/["'`]/g, '').trim().slice(0, max) : '');

/** 모델 답 검사(형식이 틀리면 null) */
export function parseSuggestion(text: string): IndustrySuggestion | null {
  let v: unknown;
  try { v = parseJsonArray(text)[0]; } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const labelEn = clean(o.labelEn, 40);
  if (!labelEn) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.map((q) => clean(q, 50).replace(/\b(19|20)\d{2}\b\s*년?/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3) : []);
  const bm = clean(o.benchmark, 20).toUpperCase();
  return { labelEn, benchmark: /^[A-Z0-9.^=-]{1,20}$/.test(bm) ? bm : null, en: list(o.en), ko: list(o.ko) };
}

/** 시장 전체를 따라가는 ETF(업계 지표로는 너무 넓다) */
const BROAD = new Set(['QQQ', 'QQQM', 'SPY', 'VOO', 'IVV', 'VTI', 'DIA', 'IWM', 'VT', 'ACWI', 'RSP', 'SPLG', 'ONEQ', '^GSPC', '^IXIC', '^NDX', '^DJI']);

const GENERIC = new Set(['industry', 'industries', 'sector', 'and', 'the', 'of', 'etf', 'global', 'stocks', 'companies']);

/** 업계 이름의 핵심 낱말 어근: "Data Centers" → data, center / "Batteries" → batter(battery·batteries 둘 다 맞게) */
export function themeWords(labelEn: string): string[] {
  return labelEn.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !GENERIC.has(w)).map((w) => (w.length > 4 ? w.replace(/(ies|y|s)$/, '') : w));
}

/** 종목 이름이 업계 핵심 낱말을 모두 담는지 */
export function fitsTheme(name: string, words: string[]): boolean {
  const n = name.toLowerCase();
  return words.length > 0 && words.every((w) => n.includes(w));
}

async function tickerName(ticker: string): Promise<string | null> {
  try {
    const j = await yahooGet<{ chart?: { result?: { meta: { regularMarketPrice?: number; longName?: string; shortName?: string } }[] } }>(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`);
    const m = j.chart?.result?.[0]?.meta;
    return m?.regularMarketPrice != null ? m.longName || m.shortName || ticker : null;
  } catch {
    return null;
  }
}

/** 이름이 담은 업계 핵심 낱말 수 */
export const themeHits = (name: string, words: string[]): number => words.filter((w) => name.toLowerCase().includes(w)).length;

/**
 * Yahoo에서 업계 이름으로 찾은 테마 ETF. 핵심 낱말을 다 담은 것 → 미국 상장 → 검색 순서로 고른다.
 * (Yahoo가 ETF를 주식으로 잘못 분류하는 경우가 있어 이름에 ETF가 있으면 ETF로 본다)
 */
async function themeEtf(labelEn: string): Promise<string | null> {
  const words = themeWords(labelEn);
  if (!words.length) return null;
  const queries = [labelEn, `${labelEn} ETF`, ...words.map((w) => `${w} ETF`)];
  const hits = (await Promise.all(queries.map((q) => yahooSearch(q).catch(() => [])))).flat();
  const seen = new Set<string>();
  const etfs = hits
    .filter((h) => (h.quoteType === 'ETF' || /\bETF\b/i.test(h.name)) && !BROAD.has(h.symbol) && !h.symbol.startsWith('^'))
    .filter((h) => (seen.has(h.symbol) ? false : (seen.add(h.symbol), true)))
    .map((h, i) => ({ symbol: h.symbol, hits: themeHits(h.name, words), us: !h.symbol.includes('.'), i }))
    .filter((h) => h.hits > 0)
    .sort((x, y) => y.hits - x.hits || Number(y.us) - Number(x.us) || x.i - y.i);
  return etfs[0]?.symbol ?? null;
}

/** 대표 지표 고르기: 업계에 맞는 모델 답 → Yahoo 테마 ETF → 넓지 않은 모델 답 → 없음 */
async function pickBenchmark(labelEn: string, suggested: string | null): Promise<string | null> {
  const ok = suggested && !BROAD.has(suggested) ? await tickerName(suggested) : null;
  if (ok && fitsTheme(ok, themeWords(labelEn))) return suggested;
  return (await themeEtf(labelEn)) ?? (ok ? suggested : null);
}

export async function suggestIndustry(settings: Settings, label: string): Promise<IndustrySuggestion> {
  const key = `indsuggest:v5:${label.trim().toLowerCase()}`;
  const hit = peek<IndustrySuggestion>(key)?.value;
  if (hit) return hit;
  if (!(await llmStatus(settings.llm)).online) throw new Error('LLM offline: check /setup');
  const out = await chat(settings.llm, [
    { role: 'system', content: PROMPT },
    { role: 'user', content: label },
  ], { maxTokens: 250, temperature: 0, direct: true, timeoutMs: 30_000 });
  const s = parseSuggestion(out);
  if (!s) throw new Error('업계 정보를 만들지 못했습니다. 다시 시도하거나 직접 입력하세요.');
  s.benchmark = await pickBenchmark(s.labelEn, s.benchmark);
  put(key, s);
  return s;
}
