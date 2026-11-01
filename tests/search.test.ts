import { describe, expect, it } from 'vitest';
import { norm, score } from '@/server/search';

describe('search scoring', () => {
  it('ranks exact > prefix > contains > none', () => {
    const q = norm('카카오');
    const exact = score('카카오', q);
    const prefix = score('카카오뱅크', q);
    const contains = score('주식회사카카오', q);
    expect(exact).toBe(100);
    expect(prefix).toBeLessThan(exact);
    expect(contains).toBeLessThan(prefix);
    expect(score('삼성전자', q)).toBe(0);
  });

  it('matches Korean spelled-out group names (에스케이 → SK)', () => {
    expect(score('SK하이닉스', norm('에스케이하이닉스'))).toBe(100);
    expect(score('LG에너지솔루션', norm('엘지에너지'))).toBeGreaterThan(0);
  });

  it('ignores spaces, case and punctuation', () => {
    expect(score('S&P 500', norm('s&p500'))).toBe(100);
    expect(score('Samsung Electronics', norm('samsung'))).toBeGreaterThan(0);
  });
});

import { dice, spelledLetters } from '@/server/search';
import { isTokenizedStock, mostUsed, namesMatch, shortForms, parseCandidates, pickKoName, sameTarget } from '@/server/name-resolver';

describe('spelledLetters (영어 글자 이름의 한글 표기)', () => {
  it('converts runs of 2+ letter names', () => {
    expect(spelledLetters('티에스엠씨')).toBe('tsmc');
    expect(spelledLetters('에이에스엠엘')).toBe('asml');
    expect(spelledLetters('에스케이하이닉스')).toBe('sk하이닉스');
    expect(spelledLetters('엘지에너지솔루션')).toBe('lg에너지솔루션');
  });
  it('leaves single letters inside normal words alone', () => {
    expect(spelledLetters('하이닉스')).toBe('하이닉스');
    expect(spelledLetters('삼성전자')).toBe('삼성전자');
  });
});

describe('dice (비슷한 표기)', () => {
  it('is 1 for equal strings, high for near misses, 0 for unrelated', () => {
    expect(dice('타이완세미컨덕터', '타이완세미컨덕터')).toBe(1);
    expect(dice('타이완세미실리콘컨덕터', '타이완세미컨덕터')).toBeGreaterThan(0.6);
    expect(dice('타이완세미컨덕터', '삼성전자')).toBe(0);
  });
  it('lets KRX names match slightly different spellings', () => {
    expect(score('에스케이하이닉스', norm('에스케이하이닉쓰'))).toBeGreaterThan(0);
  });
});

describe('parseCandidates (모델 답 검사)', () => {
  it('keeps well-formed candidates and normalizes tickers', () => {
    const out = parseCandidates('Sure: [{"name":"Taiwan Semiconductor","ko":"TSMC","ticker":"tsm","listed":true},{"name":"ChangXin Memory","ko":"창신메모리","ticker":null,"listed":false}]');
    expect(out).toEqual([
      { name: 'Taiwan Semiconductor', ko: 'TSMC', ticker: 'TSM' },
      { name: 'ChangXin Memory', ko: '창신메모리', ticker: null },
    ]);
  });
  it('drops junk tickers, missing names, and caps at 3', () => {
    const out = parseCandidates('[{"name":"A","ticker":"BYD 002594"},{"ticker":"X"},{"name":"B"},{"name":"C"},{"name":"D"}]');
    expect(out.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(out[0]!.ticker).toBeNull();
  });
  it('returns [] for non-JSON answers', () => {
    expect(parseCandidates('I am not sure')).toEqual([]);
    expect(parseCandidates('[]')).toEqual([]);
  });
});

describe('sameTarget (다른 회사로 바꿔 답한 것 거르기)', () => {
  const c = (ko: string | null) => ({ name: 'x', ko, ticker: null });
  it('rejects a different, unrelated Korean name', () => {
    expect(sameTarget('창신메모리', c('SK하이닉스'))).toBe(false);
  });
  it('accepts the same name, longer official names, and acronyms', () => {
    expect(sameTarget('마오타이', c('구이저우마오타이'))).toBe(true);
    expect(sameTarget('금값', c('금'))).toBe(true);
    expect(sameTarget('창신메모리', c('창신메모리'))).toBe(true);
    expect(sameTarget('타이완세미실리콘컨덕터', c('TSMC'))).toBe(true);
    expect(sameTarget('아무거나', c(null))).toBe(true);
    expect(sameTarget('홍콩증시', { name: 'Hang Seng Index', ko: '항셍지수', ticker: '^HSI' })).toBe(true);
  });
});

describe('namesMatch (티커의 실제 이름 대조)', () => {
  it('matches the same company across spellings and suffixes', () => {
    expect(namesMatch('Kweichow Moutai', 'KWEICHOW MOUTAI')).toBe(true);
    expect(namesMatch('Toyota', 'Toyota Motor Corporation')).toBe(true);
    expect(namesMatch('Gold', 'Gold Dec 26')).toBe(true);
    expect(namesMatch('Dow Jones Industrial Average', 'Dow Jones Industrial Average')).toBe(true);
    expect(namesMatch('TSMC', 'Taiwan Semiconductor Manufacturing Company Limited')).toBe(true);
  });
  it('rejects a real ticker that belongs to something else', () => {
    expect(namesMatch('ChangXin Memory', 'CXMT USD')).toBe(false);
    expect(namesMatch('Kweichow Moutai', 'Anhui Xinan Technology')).toBe(false);
  });
});

describe('isTokenizedStock (주식을 본뜬 코인 거르기)', () => {
  it('rejects tokenized or derivative stock tokens', () => {
    expect(isTokenizedStock('CRYPTOCURRENCY', 'TSMC Tokenized bStocks USD')).toBe(true);
    expect(isTokenizedStock('CRYPTOCURRENCY', 'ChangXin Memory Technologies (Derivatives) USD')).toBe(true);
  });
  it('keeps real crypto and real stocks', () => {
    expect(isTokenizedStock('CRYPTOCURRENCY', 'Bitcoin USD')).toBe(false);
    expect(isTokenizedStock('EQUITY', 'Taiwan Semiconductor Manufacturing Company Limited')).toBe(false);
  });
});

import { withHoldingQueries } from '@/server/news-intel';
import { parseSuggestion } from '@/server/industry-suggest';

describe('withHoldingQueries (업계 뉴스에 내 종목 이름 더하기)', () => {
  const pf = {
    example: false,
    industries: [{ id: 'semis', label: '반도체', en: ['chips'], ko: ['반도체 업황'] }],
    holdings: [
      { symbol: '005930.KS', name: '삼성전자', nameEn: 'Samsung Electronics', industry: 'semis' },
      { symbol: 'TSM', name: 'TSM', industry: 'semis' },
      { symbol: 'TSLA', name: '테슬라', nameEn: 'Tesla', industry: 'auto' },
    ],
  };
  it('adds names in the matching script only, for that industry only', () => {
    expect(withHoldingQueries(['chips'], pf, 'semis', 'en')).toEqual(['chips', '"Samsung Electronics"', '"TSM"']);
    expect(withHoldingQueries(['반도체 업황'], pf, 'semis', 'ko')).toEqual(['반도체 업황', '"삼성전자"']);
  });
});

describe('parseSuggestion (업계 자동 채우기 답 검사)', () => {
  it('keeps a well-formed suggestion', () => {
    expect(parseSuggestion('[{"labelEn":"Shipbuilding","benchmark":"sea","en":["shipbuilding orders","LNG carrier demand"],"ko":["조선 수주","LNG선 발주"]}]'))
      .toEqual({ labelEn: 'Shipbuilding', benchmark: 'SEA', en: ['shipbuilding orders', 'LNG carrier demand'], ko: ['조선 수주', 'LNG선 발주'] });
  });
  it('drops bad tickers and rejects missing names', () => {
    expect(parseSuggestion('[{"labelEn":"Defense","benchmark":"ITA ETF","en":[],"ko":[]}]')?.benchmark).toBeNull();
    expect(parseSuggestion('[{"benchmark":"ITA"}]')).toBeNull();
    expect(parseSuggestion('nope')).toBeNull();
    expect(parseSuggestion('[{"labelEn":"Banking","en":["bank outlook 2024"],"ko":["은행업 전망 2024년"]}]')).toMatchObject({ en: ['bank outlook'], ko: ['은행업 전망'] });
  });
});

describe('pickKoName', () => {
  const heads = [
    '키엔스(6861 JP), 2분기 순이익 1391억엔...전년비 51% 증가',
    "한국인은 잘 모르는 일본 ‘괴물 기업’ 키엔스",
    '키엔스·무라타·미쓰비시전기 일본 전기전자부품업종 새 빅3',
    '다케미츠 키엔스 창업자, 일본 부자 1위에 올라',
    '키엔스는 직판 영업으로 이익률 50%',
  ];
  it('모델이 지어낸 표기를 기사 표기로 바로잡는다', () => {
    expect(pickKoName(heads, ['키엔센스'])).toBe('키엔스');
    // 사용자가 친 말은 같은 낱말만
    expect(pickKoName(heads, [], ['키엔스'])).toBe('키엔스');
    expect(pickKoName(['독일차 판매 급감', '독일차 수입 늘어'], [], ['독일증시'])).toBeNull();
  });
  it('기사로 확인이 안 되면 null', () => {
    expect(pickKoName(['엔비디아 주가 급등'], ['키엔센스'])).toBeNull();
    expect(pickKoName(heads, ['TSMC'])).toBeNull();
  });
  it('사용자가 친 이름이 기사에 있으면 그대로', () => {
    expect(pickKoName(['창신메모리, 상하이 상장 첫날 급등', '창신메모리 실적 발표'], [], ['창신메모리'])).toBe('창신메모리');
    // 제목 하나로는 확인으로 보지 않는다
    expect(pickKoName(['창신메모리, 상하이 상장 첫날 급등'], ['창신메모리'])).toBeNull();
  });
});

import { googleArticleId, parseGarturlResponse } from '@/server/sources/google-link';

describe('google news link', () => {
  it('기사 id를 꺼낸다', () => {
    expect(googleArticleId('https://news.google.com/rss/articles/CBMiAbC_d-1?oc=5')).toBe('CBMiAbC_d-1');
    expect(googleArticleId('https://www.yna.co.kr/view/AKR1')).toBeNull();
  });
  it('원문 주소 응답을 읽는다', () => {
    const res = `)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://example.com/a?b=1\\",1]",null,null,null,"generic"],["di",16]]`;
    expect(parseGarturlResponse(res)).toBe('https://example.com/a?b=1');
    expect(parseGarturlResponse(`)]}'\n\n[["wrb.fr","Fbv4je",null,null,null,[3],"generic"]]`)).toBeNull();
  });
});

import { cleanLabel, tickerCodes } from '@/server/sources/wikidata';

describe('wikidata names', () => {
  it('Yahoo 티커를 위키데이터 표기로', () => {
    expect(tickerCodes('6861.T')).toEqual(['6861']);
    expect(tickerCodes('0700.HK')).toEqual(['0700', '700']);
    expect(tickerCodes('NVDA')).toEqual(['NVDA']);
    expect(tickerCodes('^GDAXI')).toEqual([]);
    expect(tickerCodes('BTC-USD')).toEqual([]);
  });
  it('구분용 괄호를 뗀다', () => {
    expect(cleanLabel('귀주모태주 (기업)')).toBe('귀주모태주');
    expect(cleanLabel('키엔스')).toBe('키엔스');
  });
  it('여러 표기 중 기사에서 많이 쓰는 쪽', () => {
    expect(mostUsed(['텐센트', '텐센트홀딩스'], ['텐센트, 3분기 실적', '텐센트 주가'])).toBe('텐센트');
    expect(mostUsed(['토요타 자동차', '도요타'], ['도요타 판매 증가', '도요타 전기차'])).toBe('도요타');
    expect(mostUsed(['키엔스'], [])).toBe('키엔스');
  });
});

describe('short forms and fragments', () => {
  it('기사에서 줄여 쓰는 형태를 찾는다', () => {
    const heads = ['창신메모리, 상하이 상장', '창신메모리 HBM 양산', '창신 메모리 테크놀로지스 공시'];
    expect(shortForms(['창신 메모리 테크놀로지스'], heads)).toEqual(['창신메모리']);
    expect(mostUsed(['창신 메모리 테크놀로지스', ...shortForms(['창신 메모리 테크놀로지스'], heads)], heads)).toBe('창신메모리');
  });
  it('짧은 조각은 이름으로 고르지 않는다', () => {
    expect(pickKoName(['독일 증시 하락', '독일 DAX 반등', '독일 경기 둔화'], ['독일증시'])).toBeNull();
  });
  it('약칭이 머리글자보다 길어도 같은 회사', () => {
    expect(namesMatch('Taiwan Semiconductor Manufacturing', 'TSMC')).toBe(true);
    expect(namesMatch('ChangXin Memory', 'CXMT USD')).toBe(false);
  });
});

import { fitsTheme, themeWords } from '@/server/industry-suggest';

describe('industry benchmark theme', () => {
  it('업계 이름의 핵심 낱말', () => {
    expect(themeWords('Data Centers')).toEqual(['data', 'center']);
    expect(themeWords('Semiconductor Industry')).toEqual(['semiconductor']);
    expect(themeWords('Secondary Batteries')).toEqual(['secondar', 'batter']);
  });
  it('테마 ETF 이름이 맞는지', () => {
    expect(fitsTheme('Global X Data Center & Digital Infrastructure ETF', themeWords('Data Centers'))).toBe(true);
    expect(fitsTheme('Invesco QQQ Trust', themeWords('Data Centers'))).toBe(false);
    expect(fitsTheme('iShares Semiconductor ETF', themeWords('Semiconductors'))).toBe(true);
    expect(fitsTheme('Tiger Secondary Battery ETF', themeWords('Secondary Batteries'))).toBe(true);
  });
});

import { imfPeriodToIso, parseImfCsv } from '@/server/sources/imf';

describe('imf', () => {
  it('기간 표기를 날짜로', () => {
    expect(imfPeriodToIso('2026-M08')).toBe('2026-08-01');
    expect(imfPeriodToIso('2026-Q2')).toBe('2026-04-01');
    expect(imfPeriodToIso('2025')).toBe('2025-01-01');
    expect(imfPeriodToIso('x')).toBeNull();
  });
  it('CSV를 읽는다(빈 값은 건너뜀)', () => {
    const csv = 'STRUCTURE,COUNTRY,TIME_PERIOD,OBS_VALUE\ndataflow,JPN,2026-M02,1.26\ndataflow,JPN,2026-M01,1.5\ndataflow,JPN,2026-M03,\n';
    expect(parseImfCsv('CPI/JPN', csv)).toEqual([['2026-01-01', 1.5], ['2026-02-01', 1.26]]);
  });
});
