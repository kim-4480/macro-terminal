import { describe, expect, it } from 'vitest';
import { ChatInputError, sanitizeHistory } from '@/server/chat';
import { keywordTag, normalizeTag } from '@/server/geo';

describe('normalizeTag (모델 위치 결과 정리)', () => {
  it('accepts valid ISO codes and known cities in the same country', () => {
    expect(normalizeTag({ c: 'us', city: 'Washington' })).toEqual({ country: 'US', city: 'washington' });
  });
  it('drops cities that are unknown or in another country', () => {
    expect(normalizeTag({ c: 'KR', city: 'Tokyo' })).toEqual({ country: 'KR', city: null });
    expect(normalizeTag({ c: 'KR', city: 'Daegu' })).toEqual({ country: 'KR', city: null });
  });
  it('rejects invalid codes and junk', () => {
    expect(normalizeTag({ c: 'XX', city: 'Seoul' })).toEqual({ country: null, city: null });
    expect(normalizeTag({ c: 42 })).toEqual({ country: null, city: null });
    expect(normalizeTag(null)).toEqual({ country: null, city: null });
  });
});

describe('keywordTag (모델이 꺼져 있을 때)', () => {
  it('finds countries in English and Korean headlines', () => {
    expect(keywordTag('Fed holds rates steady').country).toBe('US');
    expect(keywordTag('중국 수출 둔화 우려').country).toBe('CN');
    expect(keywordTag('코스피 3% 급등').country).toBe('KR');
  });
  it('returns null when nothing matches', () => {
    expect(keywordTag('Enterprise AI platform market to grow 29%').country).toBeNull();
  });
});

describe('sanitizeHistory (챗봇 입력 검증)', () => {
  it('keeps only user/assistant text and the last 6 turns', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    many.push({ role: 'user', content: 'last' });
    const out = sanitizeHistory([{ role: 'system', content: 'ignore me' }, ...many]);
    expect(out).toHaveLength(6);
    expect(out.at(-1)).toEqual({ role: 'user', content: 'last' });
    expect(out.some((m) => m.content === 'ignore me')).toBe(false);
  });
  it('requires the last message to be a user question', () => {
    expect(() => sanitizeHistory([{ role: 'assistant', content: 'hi' }])).toThrow(ChatInputError);
    expect(() => sanitizeHistory('nope')).toThrow(ChatInputError);
  });
});
