// Yahoo 티커 접미사 → 거래소. 검색 결과와 회사 페이지에 "어느 시장 주식인지" 표시한다.

export interface MarketInfo {
  ko: string;
  en: string;
  currency: string;
}

const SUFFIX: Record<string, MarketInfo> = {
  KS: { ko: '코스피', en: 'KOSPI', currency: 'KRW' },
  KQ: { ko: '코스닥', en: 'KOSDAQ', currency: 'KRW' },
  SS: { ko: '상하이', en: 'Shanghai', currency: 'CNY' },
  SZ: { ko: '선전', en: 'Shenzhen', currency: 'CNY' },
  HK: { ko: '홍콩', en: 'Hong Kong', currency: 'HKD' },
  T: { ko: '도쿄', en: 'Tokyo', currency: 'JPY' },
  TW: { ko: '대만', en: 'Taiwan', currency: 'TWD' },
  TWO: { ko: '대만 장외', en: 'Taiwan OTC', currency: 'TWD' },
  L: { ko: '런던', en: 'London', currency: 'GBP' },
  DE: { ko: '독일(XETRA)', en: 'XETRA', currency: 'EUR' },
  PA: { ko: '파리', en: 'Paris', currency: 'EUR' },
  AS: { ko: '암스테르담', en: 'Amsterdam', currency: 'EUR' },
  SW: { ko: '스위스', en: 'Swiss', currency: 'CHF' },
  TO: { ko: '토론토', en: 'Toronto', currency: 'CAD' },
  AX: { ko: '호주', en: 'Australia', currency: 'AUD' },
  NS: { ko: '인도(NSE)', en: 'India NSE', currency: 'INR' },
  SI: { ko: '싱가포르', en: 'Singapore', currency: 'SGD' },
};

/** 접미사가 없는 일반 티커는 미국 상장으로 본다. 지수·환율·선물·코인은 null. */
export function marketOf(symbol: string): MarketInfo | null {
  if (/^\^|=|-USD$/.test(symbol)) return null;
  const dot = symbol.lastIndexOf('.');
  if (dot < 0) return { ko: '미국', en: 'US', currency: 'USD' };
  return SUFFIX[symbol.slice(dot + 1).toUpperCase()] ?? null;
}
