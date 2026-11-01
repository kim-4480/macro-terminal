import { cached } from '../cache';
import { getJson } from './http';

// 위키데이터: 회사의 한국어 이름을 근거 있는 데이터에서 찾는다(에이전트가 이름을 지어내지 않게).
//  - 상장사: 거래소 상장 정보의 티커(P414 → P249)로 회사를 특정하고, 영어 이름이 맞는지 한 번 더 본다
//  - 비상장: 영어 이름으로 검색해 이름이 같은 항목만

export interface WikiKoName {
  /** 대표 한국어 이름 */
  label: string;
  /** 다른 한국어 표기들 */
  aliases: string[];
}

const DAY = 86400e3;
const SPARQL = 'https://query.wikidata.org/sparql';
const API = 'https://www.wikidata.org/w/api.php';

/** "귀주모태주 (기업)" → "귀주모태주" */
export const cleanLabel = (s: string): string => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Yahoo 티커 → 위키데이터에 적힌 티커 표기 후보(6861.T → 6861, 0700.HK → 0700·700, NVDA → NVDA) */
export function tickerCodes(symbol: string): string[] {
  if (symbol.startsWith('^') || /[=]|-USD$/.test(symbol)) return [];
  const base = symbol.replace(/\.[A-Z]{1,3}$/, '');
  const out = [base];
  if (/^0+\d+$/.test(base)) out.push(base.replace(/^0+/, ''));
  return out;
}

interface Binding { en?: { value: string }; ko?: { value: string }; alts?: { value: string } }

async function byTickers(codes: string[]): Promise<{ en: string; ko: string | null; aliases: string[] }[]> {
  const values = codes.map((c) => JSON.stringify(c)).join(' ');
  const query = `SELECT ?item ?en ?ko (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
  VALUES ?t { ${values} }
  ?item p:P414 ?st. ?st pq:P249 ?t.
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?ko FILTER(LANG(?ko) = "ko") }
  OPTIONAL { ?item skos:altLabel ?alt FILTER(LANG(?alt) = "ko") }
} GROUP BY ?item ?en ?ko LIMIT 20`;
  const j = await getJson<{ results: { bindings: Binding[] } }>(`${SPARQL}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
    timeoutMs: 10_000,
  });
  return j.results.bindings.map((b) => ({
    en: b.en?.value ?? '',
    ko: b.ko?.value ?? null,
    aliases: (b.alts?.value ?? '').split('|').filter(Boolean),
  }));
}

const toName = (ko: string | null, aliases: string[]): WikiKoName | null => {
  const label = ko ? cleanLabel(ko) : '';
  const alts = [...new Set(aliases.map(cleanLabel))].filter((a) => a && a !== label);
  if (!label && !alts.length) return null;
  return { label: label || alts[0]!, aliases: label ? alts : alts.slice(1) };
};

/**
 * 상장사 한국어 이름. sameCompany(위키데이터 영어 이름)로 같은 회사인지 확인한다
 * (같은 숫자 티커를 다른 나라 회사가 쓰는 경우가 있다: 7203 → 토요타 / Wang-Zheng Berhad).
 */
export function koNameByTicker(symbol: string, sameCompany: (en: string) => boolean): Promise<WikiKoName | null> {
  const codes = tickerCodes(symbol);
  if (!codes.length) return Promise.resolve(null);
  return cached(`wd:tk:v1:${symbol}`, 30 * DAY, async () => {
    const rows = (await byTickers(codes)).filter((r) => r.en && sameCompany(r.en));
    for (const r of rows) {
      const n = toName(r.ko, r.aliases);
      if (n) return n;
    }
    return null;
  });
}

interface SearchHit { id: string; label?: string }
interface Entity { labels?: { ko?: { value: string } }; aliases?: { ko?: { value: string }[] } }

/** 비상장 기업 등: 영어 이름으로 찾고 sameCompany 로 이름이 맞는 항목만 */
export function koNameByName(nameEn: string, sameCompany: (en: string) => boolean): Promise<WikiKoName | null> {
  return cached(`wd:nm:v1:${nameEn.toLowerCase()}`, 30 * DAY, async () => {
    const s = await getJson<{ search?: SearchHit[] }>(`${API}?${new URLSearchParams({ action: 'wbsearchentities', search: nameEn, language: 'en', format: 'json', limit: '5' })}`, { timeoutMs: 10_000 });
    const hit = s.search?.find((h) => h.label && sameCompany(h.label));
    if (!hit) return null;
    const e = await getJson<{ entities?: Record<string, Entity> }>(`${API}?${new URLSearchParams({ action: 'wbgetentities', ids: hit.id, props: 'labels|aliases', languages: 'ko', format: 'json' })}`, { timeoutMs: 10_000 });
    const ent = e.entities?.[hit.id];
    return toName(ent?.labels?.ko?.value ?? null, (ent?.aliases?.ko ?? []).map((a) => a.value));
  });
}
