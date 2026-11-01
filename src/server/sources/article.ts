import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// 기사 본문 읽기(챗봇 근거용). 기사 페이지는 외부 내용이므로 데이터로만 다룬다.
//  - 안전: http/https 만, 사설·로컬 주소 차단(리다이렉트마다 다시 검사), 크기·시간 제한
//  - 추출: MSN 기사 API → 구조화 데이터(articleBody) → 흔한 본문 영역 → <article>/<p> → 요약(og:description)

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;

export interface Article {
  url: string;
  title: string;
  text: string;
  /** 본문을 못 찾고 요약(설명)만 얻었으면 true */
  partial: boolean;
}

/** 사설·루프백·링크로컬·멀티캐스트 주소인가(IPv4/IPv6) */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('ff');
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('http/https 주소만 읽을 수 있습니다');
  if (url.username || url.password) throw new Error('계정 정보가 든 주소는 읽지 않습니다');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('내부망 주소는 읽지 않습니다');
  return url;
}

/** 외부 페이지를 안전하게 받는다(리다이렉트는 직접 따라가며 매번 주소 검사) */
export async function safeFetchText(raw: string, accept = 'text/html,application/json'): Promise<{ url: string; body: string }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'ko,en;q=0.8' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`리다이렉트 주소 없음 (${res.status})`);
      current = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new Error('페이지가 너무 큽니다');
    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, MAX_BYTES);
    const charset = (res.headers.get('content-type') ?? '').match(/charset=([\w-]+)/i)?.[1] ?? sniffCharset(buf);
    let body: string;
    try { body = new TextDecoder(charset).decode(buf); } catch { body = new TextDecoder().decode(buf); }
    return { url: url.toString(), body };
  }
  throw new Error('리다이렉트가 너무 많습니다');
}

function sniffCharset(buf: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
  return head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
}

const decodeEntities = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/** HTML 조각 → 읽을 수 있는 텍스트(문단은 줄바꿈) */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|noscript|iframe|svg|figure|figcaption|button|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 여는 태그 위치부터 같은 이름의 짝 닫는 태그까지(중첩 고려) */
function balancedElement(html: string, start: number): string | null {
  const name = html.slice(start).match(/^<([a-zA-Z0-9]+)/)?.[1]?.toLowerCase();
  if (!name) return null;
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return null;
}

// 흔한 기사 본문 영역(국내 언론 CMS 포함)
const BODY_SELECTORS = [
  /<[a-z]+[^>]+itemprop=["']articleBody["'][^>]*>/i,
  /<[a-z]+[^>]+id=["'](?:article-view-content-div|articleBody|articletxt|article_body|newsct_article|news_body_area|articeBody|textBody|article-body)["'][^>]*>/i,
  /<[a-z]+[^>]+class=["'][^"']*\b(?:article-body|article_body|articleBody|article-content|article_txt|news_end|story-body|entry-content|post-content|caas-body|article__body|ArticleBody)\b[^"']*["'][^>]*>/i,
];

// 본문 끝에 붙는 군더더기(저작권·주소·기자 연락처)
const JUNK = /(무단\s*전재|재배포\s*금지|Copyright|All rights reserved|저작권자|대표전화|등록번호|사업자등록|발행인|편집인|구독\s*신청|기사제보|Subscribe|Sign up for)/i;

// 광고 자리 표시만 있는 줄
const AD_LABEL = /^(광고|AD|Advertisement|ADVERTISEMENT|Sponsored)$/;

export function cleanBody(text: string): string {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !JUNK.test(l) && !AD_LABEL.test(l)).join('\n').trim();
}

/** 페이지 HTML에서 기사 본문 추출 */
export function extractArticle(html: string): { title: string; text: string; partial: boolean } {
  const meta = (p: string) => decodeEntities(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1] ?? '').trim();
  const title = meta('og:title') || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();

  // 1) 구조화 데이터(JSON-LD)의 articleBody
  const ld = [...html.matchAll(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => { try { return JSON.parse(`"${m[1]}"`) as string; } catch { return ''; } })
    .sort((a, b) => b.length - a.length)[0];
  if (ld && ld.length > 300) return { title, text: cleanBody(htmlToText(ld)), partial: false };

  // 2) 흔한 본문 영역
  for (const sel of BODY_SELECTORS) {
    const m = sel.exec(html);
    const el = m ? balancedElement(html, m.index) : null;
    const text = el ? cleanBody(htmlToText(el)) : '';
    if (text.length > 300) return { title, text, partial: false };
  }

  // 3) <article> 안(없으면 전체)의 긴 문단들
  const scope = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => htmlToText(m[1] ?? '')).filter((t) => t.length > 40 && !JUNK.test(t));
  const joined = paras.join('\n');
  if (joined.length > 300) return { title, text: joined, partial: false };

  // 4) 요약만
  const desc = meta('og:description') || meta('description');
  return { title, text: desc, partial: true };
}

/** MSN 기사(빙 뉴스 결과에 많음)는 화면이 스크립트로 그려지므로 공개 콘텐츠 API로 본문을 받는다 */
async function readMsn(url: string): Promise<Article | null> {
  const m = url.match(/^https:\/\/www\.msn\.com\/([a-z]{2}-[a-z]{2})\/.*\/ar-([A-Za-z0-9]+)/);
  if (!m) return null;
  const { body } = await safeFetchText(`https://assets.msn.com/content/view/v2/Detail/${m[1]}/${m[2]}`, 'application/json');
  const j = JSON.parse(body) as { title?: string; body?: string; provider?: { name?: string } };
  const text = cleanBody(htmlToText(j.body ?? ''));
  return text ? { url, title: j.title ?? '', text, partial: false } : null;
}

export async function readArticle(url: string): Promise<Article> {
  const msn = await readMsn(url).catch(() => null);
  if (msn) return msn;
  const { url: finalUrl, body } = await safeFetchText(url);
  const a = extractArticle(body);
  if (!a.text) throw new Error('본문을 찾지 못했습니다');
  return { url: finalUrl, ...a };
}
