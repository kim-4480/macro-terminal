/** 객체를 재귀로 겹친다. over 에 없는(또는 undefined 인) 항목은 base 값을 쓴다 */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (typeof base !== 'object' || base === null || typeof over !== 'object') return over as T;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  return out as T;
}
