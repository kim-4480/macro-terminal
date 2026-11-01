import { describe, expect, it } from 'vitest';
import { money } from '@/lib/format';
import { STRINGS, stringsFor } from '@/lib/strings';
import { deepMerge } from '@/shared/deep-merge';
import { baseLang, DEFAULT_LANG, isLang, LANGS, langFileSuffix, languageInfo, withLang } from '@/shared/languages';

describe('언어 목록', () => {
  it('ships English and Korean, English first by default', () => {
    expect(LANGS.slice(0, 2)).toEqual(['en', 'ko']);
    expect(DEFAULT_LANG).toBe('en');
    expect(isLang('ko')).toBe(true);
    expect(isLang('xx')).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it('falls back to English for anything that is not Korean', () => {
    expect(baseLang('ko')).toBe('ko');
    expect(baseLang('xx')).toBe('en');
    expect(languageInfo('nope').code).toBe('en');
    expect(stringsFor('xx').views.HOME).toBe(STRINGS.en.views.HOME);
    expect(stringsFor('ko')).toBe(STRINGS.ko);
  });

  it('keeps existing briefing file names', () => {
    expect(langFileSuffix('ko')).toBe('');
    expect(langFileSuffix('en')).toBe('_en');
    expect(langFileSuffix('pt-BR')).toBe('_pt-BR');
  });

  it('adds an output instruction only for languages without hand-written prompts', () => {
    expect(withLang('P', 'ko')).toBe('P');
    expect(withLang('P', 'en')).toBe('P');
  });
});

describe('deepMerge', () => {
  it('overrides only what is given, keeps functions, ignores undefined', () => {
    const fn = () => 'x';
    const out = deepMerge({ a: { b: 1, c: 2 }, f: fn, s: 's' }, { a: { b: 9 }, s: undefined });
    expect(out).toEqual({ a: { b: 9, c: 2 }, f: fn, s: 's' });
  });
});

describe('money', () => {
  it('formats in the base currency', () => {
    expect(money(1234.5, 'en-US', 'USD')).toBe('$1,235');
    expect(money(12.5, 'en-US', 'USD')).toBe('$12.50');
    expect(money(1234567, 'ko-KR', 'KRW')).toBe('₩1,234,567');
    expect(money(null, 'en-US', 'USD')).toBe('—');
  });
});
