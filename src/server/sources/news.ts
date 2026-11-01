import type { BaseLang } from '@/shared/types';
import { hash } from '../util';
import { getText } from './http';

// Google News RSS 검색(공식 API 가 아니다. README 의 데이터 소스 안내 참고).
const EDITIONS: Record<BaseLang, string> = {
  en: 'hl=en-US&gl=US&ceid=US:en',
  ko: 'hl=ko&gl=KR&ceid=KR:ko',
};

export interface RawNewsItem {
  id: string;
  title: string;
  lang: BaseLang;
  source: string;
  link: string;
  published: number | null;
}

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&') // 마지막에 풀어야 &amp;lt; 같은 이중 해석을 막는다
    .trim();
}

const tag = (xml: string, name: string): string => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m?.[1] ? decodeXml(m[1]) : '';
};

export function parseRss(xml: string, lang: BaseLang): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  for (const [, body = ''] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = tag(body, 'source');
    let title = tag(body, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const pub = Date.parse(tag(body, 'pubDate'));
    items.push({ id: hash(title.toLowerCase()), title, lang, source, link: tag(body, 'link'), published: Number.isFinite(pub) ? pub : null });
  }
  return items;
}

export async function googleNews(query: string, lang: BaseLang, days: number): Promise<RawNewsItem[]> {
  const q = encodeURIComponent(`${query} when:${days}d`);
  return parseRss(await getText(`https://news.google.com/rss/search?q=${q}&${EDITIONS[lang]}`), lang);
}

/** 영어·한국어 결과가 한쪽에 몰리지 않게 번갈아 채우고 최신순 정렬 */
export function mergeNews(groups: RawNewsItem[][], limit: number): RawNewsItem[] {
  const seen = new Set<string>();
  const byLang: Record<BaseLang, RawNewsItem[]> = { en: [], ko: [] };
  const all = groups.flat().sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
  for (const it of all) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    byLang[it.lang].push(it);
  }
  const out: RawNewsItem[] = [];
  while (out.length < limit && (byLang.en.length || byLang.ko.length)) {
    const en = byLang.en.shift();
    if (en) out.push(en);
    const ko = out.length < limit ? byLang.ko.shift() : undefined;
    if (ko) out.push(ko);
  }
  return out.sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
}

export async function topicNews(topic: { en: string[]; ko: string[] }, { days, limit }: { days: number; limit: number }): Promise<RawNewsItem[]> {
  const results = await Promise.allSettled([
    ...topic.en.map((q) => googleNews(q, 'en', days)),
    ...topic.ko.map((q) => googleNews(q, 'ko', days)),
  ]);
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (!ok.length && firstError) throw firstError.reason;
  return mergeNews(ok, limit);
}
