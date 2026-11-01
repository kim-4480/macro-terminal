import { describe, expect, it } from 'vitest';
import { checkNumbers, checkQuotes, countUncited, extractQuotes, quoteInSource } from '@/server/citations';

const src = new Map([
  ['S1', '중국 최대 D램 반도체 업체 창신메모리(CXMT)의 주가가 3분기 순이익 성장세 둔화 우려로 19일 7% 넘게 급락했다. 최근 1주일 동안 13.67%, 한 달간 24.86% 하락했다.'],
  ['S2', 'CXMT closed 7.8% lower on Monday after the Chinese memory chipmaker released its earnings forecast.'],
]);

describe('quoteInSource', () => {
  it('finds verbatim excerpts, ignoring quote style and whitespace', () => {
    expect(quoteInSource('주가가 3분기 순이익 성장세  둔화 우려로', src.get('S1')!)).toBe(true);
    expect(quoteInSource('CXMT closed 7.8% lower on Monday', src.get('S2')!)).toBe(true);
  });
  it('accepts ordered fragments joined by an ellipsis', () => {
    expect(quoteInSource('CXMT closed 7.8% lower … earnings forecast', src.get('S2')!)).toBe(true);
  });
  it('rejects paraphrases and invented text', () => {
    expect(quoteInSource('주가가 8% 폭락했다', src.get('S1')!)).toBe(false);
    expect(quoteInSource('earnings forecast … CXMT closed', src.get('S2')!)).toBe(false);
  });
});

describe('extractQuotes / countUncited', () => {
  it('pairs citations with quotes on either side', () => {
    const a = '- 7% 넘게 급락 [S1] “19일 7% 넘게 급락했다.”\n- fell [S2]: "CXMT closed 7.8% lower on Monday"\n- “한 달간 24.86% 하락했다” [S1]';
    expect(extractQuotes(a).map((q) => q.sourceId)).toEqual(['S1', 'S2', 'S1']);
  });
  it('counts cited lines without an excerpt', () => {
    expect(countUncited('- 급락했다 [S1]\n- 좋다\n- 하락 [S1] “19일 7% 넘게 급락했다.”')).toBe(1);
  });
});

describe('checkNumbers (요약 속 숫자)', () => {
  it('flags numbers in the summary that are not in the cited source', () => {
    const checks = checkNumbers('- 1주일 13.67%, 상장 이후 15.70% 하락 [S1] “최근 1주일 동안 13.67%”', src);
    expect(checks.map((c) => [c.quote, c.ok])).toEqual([['13.67', true], ['15.70', false]]);
  });
  it('checkQuotes combines quote and number checks', () => {
    const all = checkQuotes('- 7.8% 하락 [S2] “CXMT closed 7.8% lower”', src);
    expect(all.every((c) => c.ok)).toBe(true);
    expect(all.map((c) => c.kind).sort()).toEqual(['number', 'quote']);
  });
});

describe('quote extraction with plain quotes in prose', () => {
  it('does not join a plain quote with the following cited excerpt', () => {
    const a = '- "-10%면 손절"이라고 계획했지만 즉시 매도했습니다. [S1] “계획: -10%면 손절” [S1] “계획 준수: no”';
    expect(extractQuotes(a)).toEqual([{ sourceId: 'S1', quote: '계획: -10%면 손절' }, { sourceId: 'S1', quote: '계획 준수: no' }]);
  });
});

describe('표기만 다른 발췌는 통과, 지어낸 발췌는 실패', () => {
  const bbc = 'Microsoft offered buyouts to eligible employees to adapt its workforce to "changing needs".';
  it('accepts inner quotes changed by the model', () => {
    expect(quoteInSource("adapt its workforce to 'changing needs'.", bbc)).toBe(true);
    expect(quoteInSource('Google\'s own \'AI Mode\' search feature', 'Google’s own "AI Mode" search feature was part of it')).toBe(true);
  });
  it('accepts a closing period when the source sentence continues', () => {
    expect(quoteInSource("worst one-day performance in the company's history.", "It was the worst one-day performance in the company’s history, analysts said")).toBe(true);
  });
  it('treats dash kinds alike', () => {
    expect(quoteInSource('one-day performance', 'the one–day performance')).toBe(true);
  });
  it('still rejects changed words and swapped order', () => {
    expect(quoteInSource("adapt its workforce to 'new needs'.", bbc)).toBe(false);
    expect(quoteInSource('changing needs … adapt its workforce', bbc)).toBe(false);
  });
});

describe('checkNumbers 단위 환산', () => {
  const upi = new Map([['S2', 'Revenue rose to $127.6 billion while profit fell 25% to $26.2 billion. Capex was $1.276 trillion.']]);
  const ok = (a: string) => checkNumbers(a, upi).map((c) => [c.quote, c.ok]);
  it('matches the same amount written in another unit', () => {
    expect(ok('- 매출 1,276억 달러, 영업이익 262억 달러 [S2]')).toEqual([['1,276', true], ['262', true]]);
    expect(ok('- 비용 1조 2,760억 달러 [S2]')).toEqual([['2,760', true]]);
    expect(ok('- 매출 1,280억 달러 [S2]')).toEqual([['1,280', true]]);
  });
  it('rejects a different magnitude or an invented amount', () => {
    const m = new Map([['S1', 'profit of $26.2 million']]);
    expect(checkNumbers('- 이익 262억 달러 [S1]', m)[0]!.ok).toBe(false);
    expect(ok('- 영업이익 263억 달러 [S2]')).toEqual([['263', false]]);
    expect(ok('- 영업이익 300억 달러 [S2]')).toEqual([['300', false]]);
  });
  it('does not convert bare numbers without a unit', () => {
    expect(ok('- 영업이익 262 [S2]')).toEqual([['262', false]]);
  });
});

describe('발췌 속 대괄호', () => {
  it('checks excerpts containing brackets like stock codes', () => {
    const a = '- 매출 기록 [S1] “한미반도체[042700]는 3분기 매출을 공시했다”';
    expect(extractQuotes(a)).toEqual([{ sourceId: 'S1', quote: '한미반도체[042700]는 3분기 매출을 공시했다' }]);
    expect(checkQuotes(a, new Map([['S1', '한미반도체[042700]는 3분기 매출을 공시했다고 밝혔다.']])).filter((c) => c.kind === 'quote').every((c) => c.ok)).toBe(true);
    expect(checkQuotes(a, new Map([['S1', '다른 내용의 기사 본문입니다.']])).filter((c) => c.kind === 'quote').every((c) => c.ok)).toBe(false);
  });
});

describe('checkNumbers 와 검색 결과 제목', () => {
  const m = new Map([['S1', 'Shares fell on Monday.'], ['N1', "Dow's 500-point drop"]]);
  it('accepts a number from the title of an [N#] on the same line', () => {
    expect(checkNumbers("- Dow's 500-point drop [N1] [S1] “Shares fell on Monday”", m).map((c) => c.ok)).toEqual([true]);
  });
  it('still flags the number when no [N#] on the line has it', () => {
    expect(checkNumbers("- Dow's 500-point drop [S1] “Shares fell on Monday”", m).map((c) => c.ok)).toEqual([false]);
  });
  it('does not check lines with only [N#]', () => {
    expect(checkNumbers('- 999 drop [N1]', m)).toEqual([]);
  });
});
