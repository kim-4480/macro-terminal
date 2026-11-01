import type { ArticleFailure, ArticleView, BaseLang } from '@/shared/types';
import { cached } from './cache';
import { readArticle } from './sources/article';
import { bingNews, type NewsHit } from './sources/bing-news';
import { GoogleBlockedError, resolveGoogleNewsLink } from './sources/google-link';
import { hash } from './util';

/** 목록에 보이는 기사 정보(원문을 못 읽으면 같은 제목 기사를 찾는 데 쓴다) */
export interface ArticleHint {
  title: string;
  lang: BaseLang;
}

export const parseArticleHint = (title: unknown, lang: unknown): ArticleHint | undefined => (
  typeof title === 'string' && title.trim() && title.length <= 300 ? { title: title.trim(), lang: lang === 'en' ? 'en' : 'ko' } : undefined
);

const titleKey = (s: string) => s.toLowerCase().replace(/\s+-\s+[^-]{1,40}$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * 같은 기사인가: 제목이 같거나, 낱말이 거의 겹칠 때만(다른 기사를 원문처럼 보여 주면 안 되므로 엄격하게).
 * 언론사가 끝에 붙이는 " - 언론사"는 뺀다.
 */
export function sameTitle(a: string, b: string): boolean {
  const x = titleKey(a);
  const y = titleKey(b);
  if (x.length < 12 || y.length < 12) return false;
  if (x === y) return true;
  const xs = new Set(x.split(' '));
  const ys = new Set(y.split(' '));
  if (xs.size < 5 || ys.size < 5) return false;
  const shared = [...xs].filter((w) => ys.has(w)).length;
  return shared / new Set([...xs, ...ys]).size >= 0.8;
}

export const pickSameTitle = (title: string, hits: NewsHit[]): NewsHit | null => hits.find((h) => sameTitle(title, h.title)) ?? null;

/** 왜 못 읽었는지(화면 문구용) */
export function classifyFailure(err: unknown): ArticleFailure {
  if (err instanceof GoogleBlockedError) return 'google-blocked';
  const m = err instanceof Error ? err.message : String(err);
  if (/구글 뉴스/.test(m)) return 'google';
  if (/HTTP (401|402|403|429|451)/.test(m)) return 'site-blocked';
  if (/본문을 찾지/.test(m)) return 'no-body';
  return 'network';
}

const readCached = (url: string) => cached(`article:v1:${hash(url)}`, 24 * 3600e3, () => readArticle(url));

/** 빙 뉴스에서 같은 제목의 기사 찾기. 못 찾으면 예외(저장하지 않아 다음에 다시 찾는다) */
const findAlternative = (link: string, hint: ArticleHint) => cached(`gnalt:v1:${hash(link)}`, 7 * 86400e3, async () => {
  const hit = pickSameTitle(hint.title, await bingNews(hint.title.replace(/\s+-\s+[^-]{1,40}$/, ''), hint.lang));
  if (!hit) throw new Error('같은 제목의 기사를 찾지 못했습니다');
  return hit.url;
});

/** 뉴스 보기: 링크 → 원문 주소와 본문(원문 그대로). 본문을 못 읽어도 원문 주소는 돌려준다. */
export async function articleView(link: string, hint?: ArticleHint): Promise<ArticleView> {
  let url = link;
  let failure: unknown = null;
  // 실패는 저장하지 않는다(잠깐 끊긴 경우 다음에 다시 읽도록)
  try {
    url = await cached(`gnlink:v1:${hash(link)}`, 30 * 86400e3, () => resolveGoogleNewsLink(link));
  } catch (err) {
    failure = err;
  }
  let main: ArticleView | null = null;
  if (!failure) {
    try {
      const a = await readCached(url);
      main = { link, url: a.url, title: a.title, text: a.text, partial: a.partial, error: null, reason: null };
      if (!a.partial) return main;
    } catch (err) {
      failure = err;
    }
  }
  // 원문을 못 읽었거나 요약만 얻었으면 같은 기사를 빙 뉴스에서 찾아 본다
  if (hint?.title) {
    try {
      const altUrl = await findAlternative(link, hint);
      if (altUrl !== url) {
        const a = await readCached(altUrl);
        if (!a.partial || !main) return { link, url: a.url, title: a.title, text: a.text, partial: a.partial, error: null, reason: null };
      }
    } catch { /* 못 찾으면 처음 결과대로 */ }
  }
  return main ?? { link, url, title: '', text: '', partial: true, error: (failure as Error).message, reason: classifyFailure(failure) };
}
