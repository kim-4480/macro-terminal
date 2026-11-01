import { htmlToText, safeFetchText } from './article';
import { getText } from './http';

// 에이전트의 웹 검색과 페이지 읽기. 공개 주소만 읽고, 내용은 모델에게 데이터로만 준다.

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

const strip = (s: string) => htmlToText(s).replace(/\s+/g, ' ').trim();

/** DuckDuckGo HTML 결과 */
export function parseDuckDuckGo(html: string, limit = 8): WebHit[] {
  const out: WebHit[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|(?=class="result__a"))/g;
  for (const m of html.matchAll(re)) {
    const href = m[1]!.replace(/&amp;/g, '&');
    let url = href;
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.pathname === '/y.js') continue; // 광고
      url = u.searchParams.get('uddg') ?? u.toString();
    } catch {
      continue;
    }
    out.push({ title: strip(m[2] ?? ''), url, snippet: strip(m[3] ?? '') });
    if (out.length >= limit) break;
  }
  return out;
}

/** Bing RSS 결과(DuckDuckGo 가 막혔을 때) */
export function parseBingWeb(xml: string, limit = 8): WebHit[] {
  const tag = (block: string, name: string) => strip(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((m) => ({ title: tag(m[1]!, 'title'), url: tag(m[1]!, 'link'), snippet: tag(m[1]!, 'description') }));
}

export async function webSearch(query: string): Promise<WebHit[]> {
  const q = encodeURIComponent(query);
  try {
    const hits = parseDuckDuckGo(await getText(`https://html.duckduckgo.com/html/?q=${q}`));
    if (hits.length) return hits;
  } catch { /* 아래로 */ }
  return parseBingWeb(await getText(`https://www.bing.com/search?format=rss&q=${q}`));
}

const PAGE_CHARS = 3000;
const DATA_FILE_CHARS = 2000;
const MAX_DATA_LINKS = 20;
const DATA_LINK = /\.(csv|tsv|json|xlsx?)(\?|$)|\/(api|download|data|csv)\b/i;

/** 페이지의 링크 중 데이터로 보이는 것(절대 주소) */
export function dataLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, '&'), base);
      if (u.protocol === 'https:' && DATA_LINK.test(u.pathname + u.search)) out.add(u.toString());
    } catch { /* 틀린 주소는 건너뜀 */ }
    if (out.size >= MAX_DATA_LINKS) break;
  }
  return [...out];
}

export async function readWebPage(raw: string): Promise<{ url: string; title: string; text: string; dataLinks: string[] }> {
  if (!/^https?:\/\//.test(raw)) throw new Error('http(s) 주소가 필요합니다');
  const { url, body } = await safeFetchText(raw, 'text/html,text/csv,application/json,text/plain,*/*');
  if (!/<html|<!doctype html/i.test(body.slice(0, 2000))) return { url, title: '', text: body.slice(0, DATA_FILE_CHARS), dataLinks: [] };
  return {
    url,
    title: strip(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    text: htmlToText(body).slice(0, PAGE_CHARS),
    dataLinks: dataLinks(body, url),
  };
}
