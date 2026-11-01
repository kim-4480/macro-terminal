// 숫자 표시 규칙(화면 언어의 locale 을 받는다)

export function fmtVal(v: number | null | undefined, locale: string, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = digits ?? (a >= 10000 ? 0 : a >= 1000 ? 1 : 2);
  return v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function withUnit(v: number | null | undefined, unit: string | undefined, locale: string): string {
  if (unit === '$') return `$${fmtVal(v, locale)}`;
  if (unit === '%' || unit === '%p') return `${fmtVal(v, locale)}${unit}`;
  return fmtVal(v, locale);
}

export const money = (v: number | null | undefined, locale: string, currency: string): string =>
  (v == null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : undefined }).format(v));

export function compact(v: number | null | undefined, locale: string, currency?: string | null): string {
  if (v == null) return '—';
  const s = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  return currency ? `${s} ${currency}` : s;
}

/** 차트 눈금: 1·2·2.5·5 배수 */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  const raw = (hi - lo) / (n - 1);
  if (!(raw > 0)) return [lo];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
