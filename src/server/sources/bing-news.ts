import type { BaseLang } from '@/shared/types';
import { getText } from './http';
import { decodeXml } from './news';

// 빙 뉴스 RSS: 원문 주소를 바로 주므로(구글 뉴스는 중간 페이지) 챗봇이 기사를 읽을 때 쓴다.

export interface NewsHit {
  title: string;
  publisher: string;
  url: string;
  published: number | null;
  snippet: string;
}

const MARKET: Record<BaseLang, string> = { ko: 'ko-KR', en: 'en-US' };

export function parseBingRss(xml: string): NewsHit[] {
  const out: NewsHit[] = [];
  for (const [, body = ''] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (n: string) => {
      const m = body.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`));
      return m?.[1] ? decodeXml(m[1]) : '';
    };
    const link = tag('link');
    let url = link;
    try { url = new URL(link).searchParams.get('url') ?? link; } catch { continue; }
    if (!/^https?:\/\//.test(url)) continue;
    const pub = Date.parse(tag('pubDate'));
    out.push({
      title: tag('title'),
      publisher: tag('News:Source').replace(/ on MSN$/, ''),
      url,
      published: Number.isFinite(pub) ? pub : null,
      snippet: tag('description').replace(/<[^>]+>/g, '').slice(0, 300),
    });
  }
  return out;
}

export async function bingNews(query: string, lang: BaseLang, limit = 8): Promise<NewsHit[]> {
  const xml = await getText(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=${MARKET[lang]}`);
  return parseBingRss(xml).slice(0, limit);
}
