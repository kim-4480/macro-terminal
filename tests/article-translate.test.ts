import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitChunks, splitLong, toUnits, translateAdaptive } from '../src/server/article-translate';
import { classifyFailure, sameTitle } from '../src/server/article-view';
import { GoogleBlockedError, googleBlocked, resolveGoogleNewsLink } from '../src/server/sources/google-link';

describe('splitChunks', () => {
  it('groups paragraphs up to the limit and keeps their positions', () => {
    expect(splitChunks(['aaaa', 'bbbb', 'cccc'], 8)).toEqual([[0, 1], [2]]);
  });
  it('keeps a long paragraph in its own chunk', () => {
    expect(splitChunks(['a', 'x'.repeat(50), 'b'], 10)).toEqual([[0], [1], [2]]);
  });
});

describe('sameTitle', () => {
  it('accepts the same headline with a publisher suffix or punctuation changes', () => {
    expect(sameTitle('Microsoft profits soar days after announcing layoffs - BBC', 'Microsoft profits soar: days after announcing layoffs')).toBe(true);
    expect(sameTitle('코스피 외국인 매도에 3% 급락 마감 - 연합뉴스', '코스피 외국인 매도에 3% 급락 마감')).toBe(true);
  });
  it('rejects different stories on the same subject', () => {
    expect(sameTitle('Microsoft profits soar days after announcing layoffs', 'Microsoft shares fall after announcing new layoffs in Europe')).toBe(false);
    expect(sameTitle('코스피 급락', '코스피 급락')).toBe(false);
  });
});

describe('classifyFailure', () => {
  it('tells the reasons apart', () => {
    expect(classifyFailure(new GoogleBlockedError())).toBe('google-blocked');
    expect(classifyFailure(new Error('구글 뉴스 HTTP 500'))).toBe('google');
    expect(classifyFailure(new Error('HTTP 403'))).toBe('site-blocked');
    expect(classifyFailure(new Error('본문을 찾지 못했습니다'))).toBe('no-body');
    expect(classifyFailure(new Error('fetch failed'))).toBe('network');
  });
});

describe('구글 차단 시 호출 멈춤', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete (globalThis as { __googleBlockedUntil?: number }).__googleBlockedUntil; });
  it('stops calling Google after the bot check page', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://www.google.com/sorry/index?continue=x' } }));
    vi.stubGlobal('fetch', fetchMock);
    const link = 'https://news.google.com/rss/articles/CBMiAbC';
    await expect(resolveGoogleNewsLink(link)).rejects.toBeInstanceOf(GoogleBlockedError);
    await expect(resolveGoogleNewsLink(link)).rejects.toBeInstanceOf(GoogleBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(googleBlocked()).toBe(true);
  });
  it('still passes non-Google links through', async () => {
    await expect(resolveGoogleNewsLink('https://www.bbc.com/news/1')).resolves.toBe('https://www.bbc.com/news/1');
  });
});

describe('긴 글 나누기', () => {
  it('splits a long paragraph at sentence ends without losing text', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} ends here.`).join(' ');
    const parts = splitLong(text, 200);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join(' ')).toBe(text);
  });
  it('cuts a single huge sentence by length', () => {
    const parts = splitLong('x'.repeat(500), 200);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
  });
  it('keeps paragraph numbers and skips empty ones', () => {
    expect(toUnits(['aa', '', 'bb'], 100)).toEqual([{ paragraph: 0, text: 'aa' }, { paragraph: 2, text: 'bb' }]);
  });
});

describe('translateAdaptive', () => {
  const up = (parts: string[]) => parts.map((p) => p.toUpperCase());
  it('splits the chunk when the answer is cut off', async () => {
    const seen: number[] = [];
    const out = await translateAdaptive(['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300)], async (parts) => {
      seen.push(parts.length);
      if (parts.length > 1) throw new SyntaxError('Unexpected end of JSON');
      return up(parts);
    });
    expect(out).toEqual(['A'.repeat(300), 'B'.repeat(300), 'C'.repeat(300)]);
    expect(seen[0]).toBe(3);
  });
  it('splits on a context error and on a wrong paragraph count', async () => {
    let first = true;
    const out = await translateAdaptive(['one sentence.', 'two sentence.'], async (parts) => {
      if (first) { first = false; throw new Error('LLM HTTP 400: exceeds the available context size'); }
      return up(parts);
    });
    expect(out).toEqual(['ONE SENTENCE.', 'TWO SENTENCE.']);
    await expect(translateAdaptive(['one', 'two'], async (parts) => (parts.length > 1 ? ['merged'] : up(parts)))).resolves.toEqual(['ONE', 'TWO']);
  });
  it('splits one long piece and joins the result', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i} is here.`).join(' ');
    const out = await translateAdaptive([long], async (parts) => {
      if (parts.join('').length > 400) throw new SyntaxError('cut off');
      return up(parts);
    });
    expect(out).toEqual([long.toUpperCase()]);
  });
  it('does not retry connection errors', async () => {
    const call = vi.fn(async () => { throw new Error('fetch failed'); });
    await expect(translateAdaptive(['a', 'b'], call)).rejects.toThrow('fetch failed');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('splits after a timeout and leaves only the failing piece in the original', async () => {
    const out = await translateAdaptive(['good one', 'stuck', 'good two'], async (parts) => {
      if (parts.includes('stuck')) throw new Error('The operation was aborted due to timeout');
      return up(parts);
    });
    expect(out).toEqual(['GOOD ONE', 'stuck', 'GOOD TWO']);
  });
});
