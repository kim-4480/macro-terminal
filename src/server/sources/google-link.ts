// 구글 뉴스 RSS 링크(news.google.com/rss/articles/…)는 스크립트로 원문에 넘겨 주므로 서버에서 원문 주소를 직접 알아낸다.
//  1) 기사 페이지에서 서명(data-n-a-sg)·시각(data-n-a-ts)을 읽고
//  2) 구글 뉴스 내부 API(garturlreq)에 물어 원문 주소를 받는다.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// 구글이 자동 접속으로 보고 막으면(봇 확인 페이지, 429) 잠시 구글을 부르지 않는다.
// 막힌 동안 계속 요청하면 차단만 길어지므로, 뚫으려 하지 않고 기다린다.
const BLOCK_PAUSE_MS = 30 * 60e3;
const g = globalThis as typeof globalThis & { __googleBlockedUntil?: number };

export class GoogleBlockedError extends Error {
  constructor() {
    super('구글 뉴스가 자동 접속을 막았습니다');
  }
}

export const googleBlocked = (): boolean => Date.now() < (g.__googleBlockedUntil ?? 0);

function noteBlock(): never {
  g.__googleBlockedUntil = Date.now() + BLOCK_PAUSE_MS;
  throw new GoogleBlockedError();
}

const isBlockResponse = (res: Response) => res.status === 429 || (res.status >= 300 && res.status < 400 && /\/sorry\//.test(res.headers.get('location') ?? ''));

export function googleArticleId(link: string): string | null {
  try {
    const u = new URL(link);
    if (u.hostname !== 'news.google.com') return null;
    return u.pathname.match(/\/articles\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 응답에서 원문 주소 꺼내기: [["wrb.fr","Fbv4je","[\"garturlres\",\"https://…\",1]",…]] */
export function parseGarturlResponse(text: string): string | null {
  const line = text.split('\n').find((l) => l.startsWith('[["wrb.fr"'));
  if (!line) return null;
  try {
    const outer = JSON.parse(line) as unknown[][];
    const payload = outer[0]?.[2];
    const inner = typeof payload === 'string' ? (JSON.parse(payload) as unknown[]) : null;
    const url = inner?.[0] === 'garturlres' ? inner[1] : null;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** 구글 뉴스 링크 → 원문 주소(구글 링크가 아니면 그대로) */
export async function resolveGoogleNewsLink(link: string): Promise<string> {
  const id = googleArticleId(link);
  if (!id) return link;
  if (googleBlocked()) throw new GoogleBlockedError();
  const page = await fetch(`https://news.google.com/articles/${id}?hl=ko&gl=KR&ceid=KR:ko`, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(12_000) });
  if (isBlockResponse(page)) noteBlock();
  if (!page.ok) throw new Error(`구글 뉴스 HTTP ${page.status}`);
  const html = await page.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="(\d+)"/)?.[1];
  if (!sg || !ts) throw new Error('구글 뉴스에서 원문 주소를 찾지 못했습니다');
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ 'f.req': JSON.stringify([[['Fbv4je', inner, null, 'generic']]]) }),
    signal: AbortSignal.timeout(12_000),
  });
  if (isBlockResponse(res)) noteBlock();
  const url = res.ok ? parseGarturlResponse(await res.text()) : null;
  if (!url) throw new Error('구글 뉴스에서 원문 주소를 찾지 못했습니다');
  return url;
}
