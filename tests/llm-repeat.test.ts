import { describe, expect, it } from 'vitest';
import { collapseRepeats, foreignWords, replaceForeign } from '../src/server/llm';
import { answerLang, copiesEarlierAnswer } from '../src/server/chat';

describe('collapseRepeats', () => {
  it('keeps one copy of a paragraph the model looped on', () => {
    const loop = 'If you\'d like a summary, please let me know. Otherwise, please specify which company you\'d like to open.';
    const text = ['The PORT screen is already open.', ...Array(30).fill(loop), 'If you\'d like a summary, please let me know. Otherwise, please specify which company you'].join('\n\n');
    expect(collapseRepeats(text)).toBe(['The PORT screen is already open.', loop, 'If you\'d like a summary, please let me know. Otherwise, please specify which company you'].join('\n\n'));
  });

  it('collapses a sentence repeated inside one line', () => {
    expect(collapseRepeats('결론은 이렇다. 반도체 업황이 좋아지고 있다. 반도체 업황이 좋아지고 있다. 반도체 업황이 좋아지고 있다.')).toBe('결론은 이렇다. 반도체 업황이 좋아지고 있다.');
  });

  it('leaves normal answers alone', () => {
    const ok = '## 요약\n- NVDA 7일 +3.2% [S1] “shares rose 3.2%”\n- TSM 7일 -1.1% [S2] “fell 1.1%”\n\n| 종목 | 7일 |\n| --- | --- |\n| NVDA | +3.2% |';
    expect(collapseRepeats(ok)).toBe(ok);
  });

  it('stays fast on long text', () => {
    const long = Array.from({ length: 400 }, (_, i) => `문장 ${i} 내용이 조금씩 다르다 ${i * 7}.`).join(' ');
    const t = performance.now();
    collapseRepeats(long);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe('copiesEarlierAnswer', () => {
  const history = [
    { role: 'system' as const, content: 'sys' },
    { role: 'user' as const, content: 'Open my portfolio' },
    { role: 'assistant' as const, content: 'Your portfolio screen is now open.' },
    { role: 'user' as const, content: 'Open my portfolio' },
  ];
  it('flags a reply that repeats an earlier answer word for word', () => {
    expect(copiesEarlierAnswer(history, ' your portfolio  screen is now open. ')).toBe(true);
  });
  it('accepts a new reply', () => {
    expect(copiesEarlierAnswer(history, '포트폴리오 화면을 열었습니다.')).toBe(false);
    expect(copiesEarlierAnswer(history, '')).toBe(false);
  });
});

describe('한국어 답에 섞인 한자·일본어', () => {
  it('finds words outside quotes only', () => {
    expect(foreignWords('가장 큰单日 하락 [S1] “中国 stocks fell”')).toEqual(['单日']);
    expect(foreignWords('これは 일본어 표현')).toEqual(['これは']);
  });
  it('leaves text without Hangul alone', () => {
    expect(foreignWords('China (中国) shares fell')).toEqual([]);
  });
  it('replaces only outside quotes and adds a space after Hangul', () => {
    const map = new Map([['单日', '단일'], ['中国', '중국']]);
    expect(replaceForeign('가장 큰单日 하락, 中国 시장 [S1] “中国 单日”', map)).toBe('가장 큰 단일 하락, 중국 시장 [S1] “中国 单日”');
  });
  it('keeps words with no translation', () => {
    expect(replaceForeign('큰 单日 하락', new Map())).toBe('큰 单日 하락');
  });
});

describe('answerLang', () => {
  it('follows a clear question language', () => {
    expect(answerLang('Find me recent news about Nvidia', 'ko')).toBe('en');
    expect(answerLang('엔비디아 뉴스 찾아줘', 'en')).toBe('ko');
    expect(answerLang('Nvidia 뉴스 찾아줘', 'en')).toBe('ko');
  });
  it('keeps the screen language for short or ambiguous questions', () => {
    expect(answerLang('NVDA', 'ko')).toBe('ko');
    expect(answerLang('AI chips', 'ko')).toBe('ko');
    expect(answerLang('2026', 'en')).toBe('en');
  });
});
