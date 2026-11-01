import { describe, expect, it } from 'vitest';
import { cleanCompanyName, SYMBOL_RE } from '@/server/company';
import { ConfigError, savePortfolio } from '@/server/config';

describe('cleanCompanyName (뉴스 검색어용 회사 이름)', () => {
  it('drops legal suffixes', () => {
    expect(cleanCompanyName('Samsung Electronics Co., Ltd.')).toBe('Samsung Electronics');
    expect(cleanCompanyName('ASML Holding N.V. - New York Re')).toBe('ASML Holding');
    expect(cleanCompanyName('NVIDIA Corporation')).toBe('NVIDIA');
    expect(cleanCompanyName('Apple Inc.')).toBe('Apple');
    expect(cleanCompanyName('Kakao Corp.')).toBe('Kakao');
  });
  it('keeps plain names', () => {
    expect(cleanCompanyName('Tesla')).toBe('Tesla');
  });
});

describe('SYMBOL_RE', () => {
  it('accepts Yahoo-style tickers and rejects junk', () => {
    for (const s of ['NVDA', '005930.KS', '^GSPC', 'KRW=X', 'BRK-B']) expect(SYMBOL_RE.test(s)).toBe(true);
    for (const s of ['', 'a b', '../etc', 'X'.repeat(21)]) expect(SYMBOL_RE.test(s)).toBe(false);
  });
});

// 실패해야 하는 입력만 시험한다(검증에서 막히므로 실제 config 파일은 건드리지 않는다)
describe('savePortfolio validation', () => {
  const ind = { id: 'semis', label: '반도체', en: [], ko: [] };
  it('rejects holdings that point to a missing industry', () => {
    expect(() => savePortfolio({ industries: [ind], holdings: [{ symbol: 'NVDA', industry: 'nope' }] })).toThrow(ConfigError);
  });
  it('rejects duplicate industry ids and duplicate symbols', () => {
    expect(() => savePortfolio({ industries: [ind, ind], holdings: [] })).toThrow(/중복/);
    expect(() => savePortfolio({ industries: [ind], holdings: [{ symbol: 'NVDA', industry: 'semis' }, { symbol: 'NVDA', industry: 'semis' }] })).toThrow(/중복/);
  });
  it('rejects malformed input with a 400 status', () => {
    try {
      savePortfolio({ holdings: [{ symbol: '', industry: 'x', qty: -1 }] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).status).toBe(400);
    }
  });
});

import { findIndustry } from '@/server/agent-actions';

describe('findIndustry (에이전트가 말한 업계 → 업계 id)', () => {
  const p = {
    example: false,
    holdings: [],
    industries: [
      { id: 'semis', label: '반도체', labelEn: 'Semiconductors', en: [], ko: [] },
      { id: 'auto', label: '자동차·전기차', labelEn: 'Autos & EVs', en: [], ko: [] },
    ],
  };
  it('id·한국어·영어 이름 모두', () => {
    expect(findIndustry(p, 'semis')).toBe('semis');
    expect(findIndustry(p, '반도체')).toBe('semis');
    expect(findIndustry(p, 'Semiconductors')).toBe('semis');
    expect(findIndustry(p, '자동차')).toBe('auto');
  });
  it('없거나 비어 있으면 null', () => {
    expect(findIndustry(p, '바이오')).toBeNull();
    expect(findIndustry(p, '')).toBeNull();
  });
});
