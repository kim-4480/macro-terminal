import type { SearchResult } from '@/shared/types';
import { peek, put } from './cache';
import type { Settings } from './config';
import { chat, llmStatus, parseJsonArray } from './llm';
import { krxList } from './sources/krx';
import { googleNews } from './sources/news';
import { koNameByName, koNameByTicker } from './sources/wikidata';
import { yahooGet, yahooSearch } from './sources/yahoo';
import { dice, hasHangul, norm } from './text-match';

// 한국어 회사·자산 이름 → 종목: 이름표를 손으로 두지 않고 모델이 판단한다.
//  1) 모델이 후보(영어 이름·표준 한국어 이름·티커)를 낸다
//  2) 상장 여부와 티커는 모델 말을 믿지 않고 Yahoo로 확인한다(작은 모델은 자주 틀린다)
//  3) 모델이 다른(더 유명한) 회사로 바꿔 답하면 걸러내고 한 번 더 묻는다
//  4) 한국어 이름은 모델 말을 그대로 쓰지 않는다(키엔스 → 키엔센스 처럼 지어낸다). 근거가 강한 순서로 확인:
//     KRX 상장사 목록 → 위키데이터(티커·이름) → 한국 기사 제목. 어디서도 확인 못 하면 영어 이름 + "한글명 미확인"
//  5) 확인된 결과는 저장해 다시 쓴다 → 같은 검색은 바로, 모델이 꺼져 있어도 이전 결과는 나온다

export interface Candidate {
  name: string;
  /** 한국 언론에서 쓰는 이름(한글 또는 TSMC 같은 영문 약칭). 없으면 null */
  ko: string | null;
  ticker: string | null;
}

const TICKER_RE = /^[A-Za-z0-9.^=-]{1,20}$/;
const MAX_CANDIDATES = 3;
const MEMORY_DAYS = 180;

/** 모델 답(JSON 배열)을 검사해 후보로. 형식이 틀린 항목은 버린다. */
export function parseCandidates(text: string): Candidate[] {
  let arr: unknown[];
  try { arr = parseJsonArray(text); } catch { return []; }
  const out: Candidate[] = [];
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue;
    const o = v as { name?: unknown; ko?: unknown; ticker?: unknown };
    const name = typeof o.name === 'string' ? o.name.replace(/["'`]/g, '').trim() : '';
    if (!name || name.length > 80) continue;
    const ticker = typeof o.ticker === 'string' && TICKER_RE.test(o.ticker.trim()) ? o.ticker.trim().toUpperCase() : null;
    // 한글 이름이거나, 한국 언론도 그대로 쓰는 영문 약칭(TSMC, SMIC)
    const koRaw = typeof o.ko === 'string' ? o.ko.trim() : '';
    const ko = koRaw && koRaw.length <= 40 && (hasHangul(koRaw) || /^[A-Z0-9&]{2,8}$/.test(koRaw)) ? koRaw : null;
    out.push({ name, ko, ticker });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * 모델이 "같은 대상"을 답했는지: 한글 이름을 줬다면 검색어와 글자가 어느 정도 겹쳐야 한다.
 * (창신메모리 → SK하이닉스 처럼 다른 회사로 바꿔 답한 경우를 거른다. 영문 약칭은 비교할 수 없어 통과)
 */
export function sameTarget(query: string, c: Candidate): boolean {
  if (!c.ko || !hasHangul(c.ko)) return true;
  // 나라·시장 이름으로 지수를 찾는 경우(홍콩증시 → 항셍지수)는 글자가 달라도 같은 대상
  if (c.ticker?.startsWith('^') || /(증시|지수|주가지수|증권시장|주식시장)$/.test(query.trim())) return true;
  const a = norm(c.ko);
  const b = norm(query);
  return a.includes(b) || b.includes(a) || dice(a, b) >= 0.34;
}

const PROMPT = `The user typed a Korean search query (often a rough phonetic spelling or a Korean name) for a company, ETF, index, currency, commodity or crypto asset. Work out exactly what they typed — do NOT substitute a different or more famous company; lesser-known and private companies are fine.
Reply with ONLY a JSON array of up to 3 candidates, most likely first:
[{"name": English name (no legal suffix, max 5 words), "ko": the Korean name Korean media use for that SAME thing (e.g. "구이저우마오타이", "텐센트", "TSMC") or null, "ticker": Yahoo Finance ticker or null if not sure or not listed}]
Ticker conventions: US plain (NVDA), Korea 005930.KS / .KQ, Shanghai .SS, Shenzhen .SZ, Hong Kong 0700.HK, Tokyo 7203.T, Taiwan 2330.TW, indices ^GSPC / ^DJI, FX KRW=X, futures GC=F, crypto BTC-USD.
If a company trades in several places, list its home listing and its US listing as separate candidates.
If the user names a country's or region's stock market or index (e.g. 독일증시 → DAX ^GDAXI, 대만가권 → Taiwan Weighted ^TWII, 상해종합 → SSE Composite 000001.SS, 니케이 → Nikkei 225 ^N225), answer that index, not a company.
If you cannot tell, reply [].`;

const RETRY = (q: string) => `Your previous answer named a different company. The query is "${q}". Identify the company or asset that "${q}" itself refers to, even if it is small or private. Use the same JSON format.`;

async function askModel(settings: Settings, q: string, retry = false): Promise<Candidate[]> {
  const out = await chat(settings.llm, [
    { role: 'system', content: PROMPT },
    { role: 'user', content: retry ? RETRY(q) : q },
  ], { maxTokens: 200, temperature: retry ? 0.3 : 0, direct: true, timeoutMs: 20_000 });
  return parseCandidates(out);
}

interface ChartMeta { chart?: { result?: { meta: { symbol?: string; shortName?: string; longName?: string; exchangeName?: string; instrumentType?: string; regularMarketPrice?: number } }[] } }

/**
 * 주식을 본뜬 코인("TSMC Tokenized bStocks", "ChangXin Memory Technologies (Derivatives) USD")은 회사 주식이 아니다.
 * 비트코인 같은 진짜 코인은 통과.
 */
export function isTokenizedStock(type: string | undefined, name: string): boolean {
  return type === 'CRYPTOCURRENCY' && /tokeni[sz]ed|\(derivatives?\)|\bxstocks?\b|\bbstocks?\b/i.test(name);
}

/**
 * 두 이름이 같은 대상을 가리키는지(대략): 한쪽의 첫 단어(3글자 이상)가 다른 쪽에 들어 있으면 같다고 본다.
 * "Kweichow Moutai" ↔ "KWEICHOW MOUTAI", "Gold" ↔ "Gold Dec 26" 은 같고, "ChangXin Memory" ↔ "CXMT USD" 는 다르다.
 */
export function namesMatch(a: string, b: string): boolean {
  const first = (s: string) => norm(s.split(/\s+/).find((w) => w.length >= 3) ?? s);
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (nb.includes(first(a)) || na.includes(first(b))) return true;
  // 약칭 ↔ 정식 이름: TSMC ↔ Taiwan Semiconductor Manufacturing Company
  const initials = (s: string) => s.split(/[\s,.&-]+/).filter((w) => w && !/^(of|and|the|co|ltd|inc|corp|limited|plc)$/i.test(w)).map((w) => w[0]!.toLowerCase()).join('');
  const acronym = (s: string) => /^[A-Z0-9&]{2,8}$/.test(s.trim());
  // TSMC ↔ Taiwan Semiconductor Manufacturing(Company 없이)처럼 약칭이 머리글자보다 길 수도 있다
  const abbr = (x: string, nx: string, full: string) => acronym(x) && (initials(full).startsWith(nx) || (initials(full).length >= 3 && nx.startsWith(initials(full))));
  return abbr(a, na, b) || abbr(b, nb, a);
}

/** 티커가 Yahoo에 실제로 있고(현재가가 나오고) 이름도 맞는지 — 존재하지만 엉뚱한 종목인 티커를 거른다 */
async function tickerMatches(ticker: string, name: string): Promise<{ symbol: string; exchange: string; isIndex: boolean } | null> {
  try {
    const j = await yahooGet<ChartMeta>(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`);
    const m = j.chart?.result?.[0]?.meta;
    if (m?.regularMarketPrice == null) return null;
    const yahooName = m.longName || m.shortName || '';
    const isIndex = m.instrumentType === 'INDEX';
    // 지수는 이름 표기가 제각각이라(Shanghai Composite ↔ SSE Composite Index) Yahoo가 지수라고 확인하면 이름 대조를 건너뛴다
    if (yahooName && !isIndex && !namesMatch(name, yahooName)) return null;
    if (isTokenizedStock(m.instrumentType, yahooName)) return null;
    return { symbol: m.symbol ?? ticker, exchange: m.exchangeName ?? '', isIndex };
  } catch {
    return null;
  }
}

/** 영어 이름으로 Yahoo 검색 — 이름이 실제로 맞는 종목만(첫 단어가 들어 있어야 함) */
async function findByName(name: string): Promise<{ symbol: string; exchange: string; isIndex: boolean } | null> {
  const hits = await yahooSearch(name).catch(() => []);
  const hit = hits.find((x) => ['EQUITY', 'ETF', 'INDEX', 'FUTURE', 'CRYPTOCURRENCY', 'CURRENCY'].includes(x.quoteType)
    && namesMatch(name, x.name) && !isTokenizedStock(x.quoteType, x.name));
  return hit ? { symbol: hit.symbol, exchange: hit.exchange ?? '', isIndex: hit.quoteType === 'INDEX' } : null;
}

const PARTICLE = /(은|는|이|가|을|를|의|에|도|와|과|로)$/;

/**
 * 한국 기사 제목들에서 그 회사의 한국어 표기 고르기.
 * refs(모델이 준 이름)와 비슷하거나 exactOnly(사용자가 친 한글)와 같은 한글 낱말 중 가장 자주 나오는 것. 확인이 안 되면 null.
 * 사용자가 친 말은 대충 친 것일 수 있어(독일증시 → 독일차) 비슷한 낱말까지 넓히지 않는다.
 */
export function pickKoName(headlines: string[], refs: string[], exactOnly: string[] = []): string | null {
  const hangulRefs = refs.filter(hasHangul).map(norm);
  const exact = exactOnly.filter(hasHangul).map(norm);
  if (!hangulRefs.length && !exact.length) return null;
  const counts = new Map<string, number>();
  for (const h of headlines) {
    const seen = new Set<string>();
    for (const [w] of h.matchAll(/[가-힣]{2,}/g)) {
      seen.add(w);
      if (w.length >= 3 && PARTICLE.test(w)) seen.add(w.slice(0, -1));
    }
    for (const w of seen) counts.set(w, (counts.get(w) ?? 0) + 1); // 한 제목에서 한 번만
  }
  let best: { w: string; n: number; d: number } | null = null;
  for (const [w, n] of counts) {
    // 비슷한 표기여야 하고, 너무 짧은 조각(독일증시 → 독일)은 이름으로 보지 않는다
    const d = exact.includes(w) ? 1 : Math.max(0, ...hangulRefs.map((r) => (r === w ? 1 : w.length >= r.length * 0.6 ? dice(r, w) : 0)));
    if (d < 0.34) continue;
    if (n < 2) continue; // 제목 하나로는 우연일 수 있다
    if (!best || n > best.n || (n === best.n && d > best.d)) best = { w, n, d };
  }
  return best?.w ?? null;
}

const koHeadlines = async (queries: string[]): Promise<string[]> =>
  (await Promise.all(queries.map((q) => googleNews(q, 'ko', 365).catch(() => [])))).flat().map((x) => x.title);

/**
 * 기사에서 줄여 쓰는 형태(창신 메모리 테크놀로지스 → 창신메모리): 위키데이터 이름의 앞부분과 같은 한글 낱말이 2번 이상 나오면.
 */
export function shortForms(names: string[], headlines: string[]): string[] {
  const full = names.filter(hasHangul).map(norm);
  const counts = new Map<string, number>();
  for (const h of headlines) for (const w of new Set([...h.matchAll(/[가-힣]{3,}/g)].map((m) => m[0]))) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].filter(([w, n]) => n >= 2 && full.some((f) => f !== w && f.startsWith(w) && w.length >= f.length * 0.4)).map(([w]) => w);
}

/** 제목들에 가장 자주 나오는 이름(없으면 첫 번째) */
export function mostUsed(names: string[], headlines: string[]): string {
  const uses = (n: string) => headlines.filter((h) => norm(h).includes(norm(n))).length;
  return names.map((n, i) => ({ n, u: uses(n), i })).sort((a, b) => b.u - a.u || a.i - b.i)[0]!.n;
}

interface KoName { title: string; verified: boolean }

/** 한국어 이름 확인: KRX → 위키데이터 → 한국 기사 제목. 못 하면 영어 이름(미확인). */
async function confirmKoName(c: Candidate, query: string, symbol: string | null): Promise<KoName> {
  if (symbol && /\.(KS|KQ)$/.test(symbol)) {
    const krx = (await krxList().catch(() => [])).find((x) => x.symbol === symbol)?.name;
    if (krx) return { title: krx, verified: true };
  }
  const same = (en: string) => namesMatch(c.name, en);
  // 지수는 티커(^GDAXI)가 위키데이터 상장 정보에 없어 이름으로 찾는다
  const listed = symbol && !symbol.startsWith('^');
  const wiki = await (listed ? koNameByTicker(symbol, same) : koNameByName(c.name, same)).catch(() => null);
  const typed = [c.ko ?? '', query].filter(hasHangul);
  if (wiki) {
    // 위키데이터 표기가 여럿이면(텐센트 / 텐센트홀딩스) 한국 기사에서 많이 쓰는 쪽.
    // 기사가 위키데이터 이름(귀주모태주)보다 다른 표기(구이저우마오타이)를 훨씬 많이 쓰면 그쪽, 줄임형(창신메모리)도 포함
    const names = [wiki.label, ...wiki.aliases];
    const heads = await koHeadlines([`"${c.name}"`, ...[...names, ...typed].filter(hasHangul).slice(0, 3).map((n) => `"${n}"`)]);
    const used = (n: string) => heads.filter((h) => norm(h).includes(norm(n))).length;
    const extra = typed.filter((n) => !names.includes(n) && used(n) >= 2);
    return { title: mostUsed([...names, ...shortForms(names, heads), ...extra], heads), verified: true };
  }
  if (typed.length) {
    const heads = await koHeadlines([`"${c.name}"`, `${c.name} 기업`, ...typed.map((n) => `"${n}"`)]);
    const picked = pickKoName(heads, c.ko ? [c.ko] : [], [query]);
    if (picked) return { title: picked, verified: true };
  }
  // TSMC 같은 영문 약칭은 지어낸 한글이 아니므로 그대로
  if (c.ko && !hasHangul(c.ko)) return { title: c.ko, verified: true };
  return { title: c.name, verified: false };
}

/**
 * 후보 → 확인된 검색 결과. 상장 여부는 Yahoo로 판단:
 * 티커가 조회되거나 이름으로 종목이 찾아지면 상장, 아니면 비상장(뉴스·브리핑 페이지).
 */
async function verify(c: Candidate, rank: number, query: string): Promise<SearchResult> {
  const score = 80 - rank * 4;
  // 제목은 근거로 확인한 한국어 이름(대충 친 검색어나 모델이 낸 이름을 그대로 쓰지 않는다), 없으면 영어 이름
  const hit = (c.ticker ? await tickerMatches(c.ticker, c.name) : null) ?? (await findByName(c.name));
  const { title, verified } = await confirmKoName(c, query, hit?.symbol ?? null);
  const koUnverified = verified ? undefined : true;
  if (hit) return { key: `y:${hit.symbol}`, kind: hit.isIndex || hit.symbol.startsWith('^') ? 'index' : 'stock', id: `yahoo:${hit.symbol}`, symbol: hit.symbol, title, titleEn: c.name, sub: hit.exchange, score, koUnverified };
  return { key: `e:${c.name}`, kind: 'entity', title, titleEn: c.name, entity: c.name, sub: c.name, score: score - 10, koUnverified };
}

interface Memory {
  results: SearchResult[];
  translated: string;
  at: number;
}

// v13: 한국어 이름을 KRX·위키데이터·기사로 확인하면서 이전 기억(지어낸 이름 포함)은 버린다
const memKey = (nq: string) => `qres:v13:${nq}`;
const koNameKey = (key: string) => `koname:v10:${key}`;

/** 이전에 확인해 둔 결과(즉시·오프라인) */
export function rememberedResults(nq: string): Memory | null {
  const hit = peek<Memory>(memKey(nq))?.value;
  return hit && Date.now() - hit.at < MEMORY_DAYS * 86400e3 ? hit : null;
}

/** 회사 페이지 등에서 쓰는 한국어 이름(검색해서 확인된 적이 있으면) */
export function learnedKoName(symbolOrEntity: string): string | null {
  return peek<string>(koNameKey(symbolOrEntity))?.value ?? null;
}

/** 한국어 검색어를 모델로 풀고 Yahoo로 확인. 결과가 있으면 기억한다. */
export async function resolveKorean(settings: Settings, query: string, nq: string): Promise<Memory | null> {
  const remembered = rememberedResults(nq);
  if (remembered) return remembered;
  if (!(await llmStatus(settings.llm)).online) return null;

  let candidates = (await askModel(settings, query).catch(() => [])).filter((c) => sameTarget(query, c));
  if (!candidates.length) candidates = (await askModel(settings, query, true).catch(() => [])).filter((c) => sameTarget(query, c));
  if (!candidates.length) return null;

  const verified = await Promise.all(candidates.map((c, i) => verify(c, i, query)));
  const seen = new Set<string>();
  const results = verified.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
  // 상장 종목이 하나라도 확인됐으면 "비상장" 후보는 뺀다(같은 회사의 다른 표기일 가능성이 크다)
  const finalResults = results.some((r) => r.kind !== 'entity') ? results.filter((r) => r.kind !== 'entity') : results;

  const memory: Memory = { results: finalResults, translated: candidates[0]!.name, at: Date.now() };
  put(memKey(nq), memory);
  // 한국어 이름 학습(회사 페이지 제목용): 근거로 확인된 한국어 이름만
  for (const r of finalResults) {
    const key = r.symbol ?? (r.entity ? `ent:${r.entity}` : null);
    if (key && !r.koUnverified && r.title !== r.titleEn && !learnedKoName(key)) put(koNameKey(key), r.title);
  }
  return memory;
}
