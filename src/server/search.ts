import type { SearchResponse, SearchResult } from '@/shared/types';
import type { Portfolio, Settings } from './config';
import { rememberedResults, resolveKorean } from './name-resolver';
import { topics } from './news-intel';
import { krxList } from './sources/krx';
import { yahooSearch } from './sources/yahoo';
import { hasHangul, norm, score } from './text-match';
import { errorMessage } from './util';

export { dice, norm, score, spelledLetters } from './text-match';

// 검색 순서
//  빠른 단계(deep=0): 화면 코드·지표·시장·보유 종목·뉴스 주제·KRX 상장사, 그리고 전에 확인해 둔 결과
//  깊은 단계(deep=1): 한국어면 모델이 뜻을 풀고 Yahoo로 확인(name-resolver), 영어·티커면 Yahoo 검색
// 해외 회사의 한국어 이름표는 두지 않는다 — 모델이 판단하고, 확인된 결과를 기억한다.

export async function search(q: string, settings: Settings, portfolio: Portfolio, { deep = true } = {}): Promise<SearchResponse> {
  const query = q.trim();
  const nq = norm(query);
  const results: SearchResult[] = [];
  if (!nq) return { query, translated: null, krxError: null, results, deepAvailable: false };

  // bonus는 실제로 일치했을 때만 더한다(보유 종목을 약간 우선). 같은 종목이면 높은 점수만 남긴다.
  const add = (r: Omit<SearchResult, 'score'>, s: number, bonus = 0) => {
    if (s <= 0) return;
    const prev = results.find((x) => x.key === r.key);
    if (!prev) results.push({ ...r, score: s + bonus });
    else if (s + bonus > prev.score) prev.score = s + bonus;
  };

  for (const m of settings.macro) {
    add({ key: `m:${m.id}`, kind: 'macro', id: m.id, title: m.label, titleEn: m.labelEn, sub: m.group, unit: m.unit },
      Math.max(score(m.label, nq), score(m.labelEn, nq)), 5);
  }
  for (const m of settings.markets) {
    add({ key: `y:${m.symbol}`, kind: 'market', id: `yahoo:${m.symbol}`, symbol: m.symbol, title: m.label, titleEn: m.labelEn, sub: m.symbol },
      Math.max(score(m.label, nq), score(m.labelEn, nq), score(m.symbol, nq)), 5);
  }
  for (const h of portfolio.holdings) {
    add({ key: `y:${h.symbol}`, kind: 'holding', id: `yahoo:${h.symbol}`, symbol: h.symbol, title: h.name ?? h.symbol, titleEn: h.nameEn, sub: h.symbol },
      Math.max(score(h.name, nq), score(h.nameEn, nq), score(h.symbol, nq)), 10);
  }
  for (const t of topics(settings, portfolio)) {
    add({ key: `t:${t.id}`, kind: 'topic', topic: t.id, title: t.label, titleEn: t.labelEn, sub: 'N' },
      Math.max(score(t.label, nq), score(t.labelEn, nq)));
  }

  let krxError: string | null = null;
  try {
    const hits: [number, (Awaited<ReturnType<typeof krxList>>)[number]][] = [];
    for (const c of await krxList()) {
      const s = Math.max(score(c.name, nq), /^\d{4,}/.test(query) && c.symbol.startsWith(query) ? 90 : 0);
      if (s) hits.push([s, c]);
    }
    hits.sort((a, b) => b[0] - a[0]).slice(0, 8).forEach(([s, c]) =>
      add({ key: `y:${c.symbol}`, kind: 'stock', id: `yahoo:${c.symbol}`, symbol: c.symbol, title: c.name, sub: `${c.market} · ${c.sector}` }, s));
  } catch (err) {
    krxError = errorMessage(err);
  }

  // 전에 모델로 확인해 둔 결과(즉시·모델이 꺼져 있어도)
  let translated: string | null = null;
  const remembered = hasHangul(query) ? rememberedResults(nq) : null;
  if (remembered) {
    translated = remembered.translated;
    remembered.results.forEach((r) => add(r, r.score));
  }

  // 깊은 단계가 더 보탤 게 있는가: 한국어인데 확실한 종목 일치(80점 이상)가 없거나, 영어·티커 검색
  const strong = results.some((r) => (r.kind === 'stock' || r.kind === 'index' || r.kind === 'holding' || r.kind === 'entity') && r.score >= 80);
  const needsDeep = !remembered && (!hasHangul(query) || !strong);

  if (deep && needsDeep) {
    if (hasHangul(query)) {
      const res = await resolveKorean(settings, query, nq).catch(() => null);
      if (res) {
        translated = res.translated;
        res.results.forEach((r) => add(r, r.score));
      }
    } else {
      try {
        let hits = await yahooSearch(query);
        if (!hits.length && query.includes(' ')) hits = await yahooSearch(query.split(' ')[0]!);
        // 같은 이름의 ETF·파생보다 지수 자체를 앞에(DAX → ^GDAXI)
        hits.forEach((x, i) =>
          add({ key: `y:${x.symbol}`, kind: x.quoteType === 'INDEX' ? 'index' : 'stock', id: `yahoo:${x.symbol}`, symbol: x.symbol, title: x.name, sub: x.exchange ?? '' }, 60 - i * 3 + (x.quoteType === 'INDEX' ? 8 : 0)));
      } catch { /* Yahoo 검색 실패 시 로컬 결과만 */ }
    }
  }

  results.sort((a, b) => b.score - a.score);
  // deepAvailable: 빠른 단계 응답에서 "깊은 검색을 이어서 하면 더 나올 수 있다"는 표시
  return { query, translated, krxError, results: results.slice(0, 12), deepAvailable: !deep && needsDeep };
}
