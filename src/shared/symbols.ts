/** 지수(^), 환율·선물(=), 코인(-USD)이 아니면 회사(종목)로 본다 */
export const isCompanySymbol = (symbol: string | null | undefined): symbol is string =>
  !!symbol && !/^\^|=|-USD$/.test(symbol);
