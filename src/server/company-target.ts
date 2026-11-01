import { HttpStatusError } from './api';
import { type CompanyTarget, ENTITY_RE, SYMBOL_RE } from './company';

/** ?symbol=티커 또는 ?entity=영어이름 (+ ?name=검색에서 본 이름) */
export function targetFromUrl(url: URL): CompanyTarget {
  const hint = url.searchParams.get('name')?.slice(0, 60) ?? null;
  const symbol = url.searchParams.get('symbol');
  if (symbol) {
    if (!SYMBOL_RE.test(symbol)) throw new HttpStatusError(400, '잘못된 종목 코드');
    return { kind: 'listed', symbol, hint };
  }
  const entity = url.searchParams.get('entity')?.trim() ?? '';
  if (!ENTITY_RE.test(entity)) throw new HttpStatusError(400, 'symbol 또는 entity 가 필요합니다');
  return { kind: 'entity', nameEn: entity, hint };
}
