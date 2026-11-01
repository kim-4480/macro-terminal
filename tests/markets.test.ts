import { describe, expect, it } from 'vitest';
import { marketOf } from '@/shared/markets';

describe('marketOf (티커 → 거래소)', () => {
  it('maps Yahoo suffixes', () => {
    expect(marketOf('600519.SS')).toMatchObject({ ko: '상하이', currency: 'CNY' });
    expect(marketOf('000858.SZ')).toMatchObject({ ko: '선전', currency: 'CNY' });
    expect(marketOf('0700.HK')).toMatchObject({ ko: '홍콩', currency: 'HKD' });
    expect(marketOf('7203.T')).toMatchObject({ ko: '도쿄', currency: 'JPY' });
    expect(marketOf('005930.KS')).toMatchObject({ ko: '코스피' });
  });
  it('treats plain tickers as US and skips indices, FX, futures, crypto', () => {
    expect(marketOf('NVDA')).toMatchObject({ en: 'US' });
    for (const s of ['^HSI', 'KRW=X', 'GC=F', 'BTC-USD']) expect(marketOf(s)).toBeNull();
  });
});
