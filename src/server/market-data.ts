import type { Changes, HoldingRow, IndustryRow, MacroRow, MarketRow, Point, PortfolioView, StripItem, YieldCurve } from '@/shared/types';
import { cached } from './cache';
import type { MacroItem, Portfolio, Settings } from './config';
import { baseCurrency } from './config';
import { ecosSeries } from './sources/ecos';
import { csvSeries } from './sources/csv';
import { fredSeries } from './sources/fred';
import { imfSeries } from './sources/imf';
import { type Quote, yahooChart } from './sources/yahoo';
import { yfHistory } from './sources/yfinance';
import { changeStats, downsample, errorMessage, lastYear, shiftDate, sinceDate, today, valueAtOrBefore, yoy } from './util';

const MIN = 60e3;
const HOUR = 60 * MIN;
const HISTORY_YEARS = 11;

export class KeyRequiredError extends Error {}

export function parseSeriesId(id: string): { src: string; key: string } {
  const i = id.indexOf(':');
  return { src: id.slice(0, i), key: id.slice(i + 1) };
}

/** 표·스파크라인용 기본 범위는 2년(1년 전 대비 계산에 여유분 필요) */
export function quote(symbol: string, range = '2y'): Promise<Quote> {
  const ttl = range === '2y' ? 15 * MIN : 6 * HOUR;
  // Yahoo 직접 호출이 막히면 yfinance(쿠키·crumb 처리 포함)로 한 번 더 시도
  return cached(`yahoo:${symbol}:${range}`, ttl, () =>
    yahooChart(symbol, range).catch((err: unknown) => yfHistory(symbol, range).catch(() => { throw err; })));
}

/** 원천 시계열(약 11년치) */
export async function rawSeries(id: string, settings: Settings): Promise<Point[]> {
  const { src, key } = parseSeriesId(id);
  const start = shiftDate(today(), { years: -HISTORY_YEARS });
  if (src === 'fred') return cached(`fred:${key}`, 6 * HOUR, () => fredSeries(key, start));
  if (src === 'ecos') {
    if (!settings.ecosApiKey) throw new KeyRequiredError('ECOS 인증키 필요 (.env 의 ECOS_API_KEY)');
    return cached(`ecos:${key}`, 6 * HOUR, () => ecosSeries(settings.ecosApiKey, key, start, today()));
  }
  if (src === 'imf') return cached(`imf:${key}`, 12 * HOUR, () => imfSeries(key, start));
  if (src === 'yahoo') return (await quote(key, '10y')).points;
  if (src === 'csv') return cached(`csv:${key}`, 6 * HOUR, () => csvSeries(key));
  throw new Error(`알 수 없는 데이터 소스: ${src}`);
}

const modeFor = (item: MacroItem) => (item.transform === 'yoy' || item.unit === '%' || item.unit === '%p' ? 'diff' : 'pct');

export async function macroRows(settings: Settings): Promise<MacroRow[]> {
  return Promise.all(settings.macro.map(async (item): Promise<MacroRow> => {
    const base: MacroRow = {
      id: item.id, group: item.group, groupEn: item.groupEn, label: item.label, labelEn: item.labelEn,
      unit: item.unit, transform: item.transform ?? null, mode: modeFor(item),
    };
    try {
      let points = await rawSeries(item.id, settings);
      if (item.transform === 'yoy') points = yoy(points);
      const stats = changeStats(points, base.mode);
      if (!stats) throw new Error('데이터 없음');
      return { ...base, ...stats, spark: lastYear(points) };
    } catch (err) {
      return { ...base, error: errorMessage(err), keyRequired: err instanceof KeyRequiredError };
    }
  }));
}

export async function marketRows(settings: Settings): Promise<MarketRow[]> {
  return Promise.all(settings.markets.map(async (m): Promise<MarketRow> => {
    const base = { symbol: m.symbol, label: m.label, labelEn: m.labelEn };
    try {
      const q = await quote(m.symbol);
      return { ...base, currency: q.currency, ...changeStats(q.points, 'pct'), spark: lastYear(q.points) };
    } catch (err) {
      return { ...base, error: errorMessage(err) };
    }
  }));
}

/** 상단 띠: settings.strip 의 id 마다 현재 값과 하루 변화. 이름은 macro/markets 설정에서 찾는다. */
export async function stripItems(settings: Settings): Promise<StripItem[]> {
  return Promise.all(settings.strip.map(async (id): Promise<StripItem> => {
    const { src, key } = parseSeriesId(id);
    const macro = settings.macro.find((m) => m.id === id);
    const market = src === 'yahoo' ? settings.markets.find((m) => m.symbol === key) : undefined;
    const base = {
      id,
      label: macro?.label ?? market?.label ?? key,
      labelEn: macro?.labelEn ?? market?.labelEn,
      unit: macro?.unit ?? '',
      mode: macro ? modeFor(macro) : (src === 'yahoo' ? 'pct' : 'diff'),
    } satisfies StripItem;
    try {
      let points = src === 'yahoo' ? (await quote(key)).points : await rawSeries(id, settings);
      if (macro?.transform === 'yoy') points = yoy(points);
      const stats = changeStats(points, base.mode);
      if (!stats) throw new Error('데이터 없음');
      return { ...base, ...stats };
    } catch (err) {
      return { ...base, error: errorMessage(err) };
    }
  }));
}

const TENOR_LABEL: Record<string, string> = {
  DGS1MO: '1M', DGS3MO: '3M', DGS6MO: '6M', DGS1: '1Y', DGS2: '2Y', DGS3: '3Y', DGS5: '5Y', DGS7: '7Y', DGS10: '10Y', DGS20: '20Y', DGS30: '30Y',
};

export async function yieldCurve(settings: Settings): Promise<YieldCurve> {
  const series = await Promise.all(settings.curve.map((id) => rawSeries(`fred:${id}`, settings).catch((): Point[] => [])));
  const latest = series.map((s) => s.at(-1)?.[0]).filter((d): d is string => !!d).sort().at(-1);
  if (!latest) throw new Error('금리 곡선 데이터 없음');
  const snapshots = [
    { key: 'now', date: latest },
    { key: 'm1', date: shiftDate(latest, { months: -1 }) },
    { key: 'y1', date: shiftDate(latest, { years: -1 }) },
  ] as const;
  return {
    date: latest,
    tenors: settings.curve.map((id) => TENOR_LABEL[id] ?? id),
    lines: snapshots.map((s) => ({ ...s, values: series.map((pts) => valueAtOrBefore(pts, s.date)?.[1] ?? null) })),
  };
}

/** 차트 기간 → 개월 수 */
export const RANGE_MONTHS: Record<string, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60, '10y': 120 };

/** 상세 차트용 시계열 */
export async function seriesDetail(id: string, range: string, settings: Settings): Promise<Point[]> {
  // CSV 경로는 사용자가 승인해 설정에 들어간 것만 읽는다(이 주소로 임의의 파일을 받게 하지 않는다)
  if (id.startsWith('csv:') && !settings.macro.some((m) => m.id === id) && !settings.strip.includes(id)) throw new Error('등록되지 않은 CSV 경로입니다');
  const { src, key } = parseSeriesId(id);
  const months = RANGE_MONTHS[range] ?? 12;
  let points: Point[];
  if (src === 'yahoo') {
    points = (await quote(key, months <= 12 ? '2y' : months <= 60 ? '5y' : '10y')).points;
  } else {
    points = await rawSeries(id, settings);
    if (settings.macro.find((m) => m.id === id)?.transform === 'yoy') points = yoy(points);
  }
  return downsample(sinceDate(points, shiftDate(today(), { months: -months })), 600);
}

const emptyChanges = (): Changes => ({ d1: null, m1: null, ytd: null, y1: null });

function weightedChanges(rows: HoldingRow[]): Changes {
  const out = emptyChanges();
  for (const k of Object.keys(out) as (keyof Changes)[]) {
    let w = 0;
    let sum = 0;
    for (const r of rows) {
      const v = r.chg?.[k];
      if (v == null || r.weight == null) continue;
      w += r.weight;
      sum += v * r.weight;
    }
    out[k] = w ? sum / w : null;
  }
  return out;
}

export async function portfolioView(portfolio: Portfolio): Promise<PortfolioView> {
  const holdings = portfolio.holdings;
  const quotes = await Promise.all(holdings.map((h) => quote(h.symbol).catch((err: unknown) => new Error(errorMessage(err)))));

  // 기준 통화 환산용 환율(예: USDKRW=X)
  const base = baseCurrency();
  const currencies = [...new Set(quotes.flatMap((q) => (q instanceof Error || !q.currency || q.currency === base ? [] : [q.currency])))];
  const fx: Record<string, number | null> = { [base]: 1 };
  await Promise.all(currencies.map(async (c) => {
    try { fx[c] = (await quote(`${c}${base}=X`)).points.at(-1)?.[1] ?? null; } catch { fx[c] = null; }
  }));
  const hasQty = holdings.length > 0 && holdings.every((h) => (h.qty ?? 0) > 0);

  const rows: HoldingRow[] = holdings.map((h, i) => {
    const q = quotes[i]!;
    const industry = portfolio.industries.find((ind) => ind.id === h.industry);
    const base: HoldingRow = {
      symbol: h.symbol,
      name: h.name || (q instanceof Error ? h.symbol : q.name),
      nameEn: h.nameEn || (q instanceof Error ? h.symbol : q.name),
      industry: h.industry,
      industryLabel: industry?.label ?? h.industry,
      industryLabelEn: industry?.labelEn ?? industry?.label ?? h.industry,
    };
    if (q instanceof Error) return { ...base, error: q.message };
    const stats = changeStats(q.points, 'pct');
    if (!stats) return { ...base, error: '데이터 없음' };
    const rate = q.currency ? fx[q.currency] : null;
    const valueBase = hasQty && rate ? stats.value * (h.qty ?? 0) * rate : null;
    return { ...base, qty: h.qty ?? null, currency: q.currency, ...stats, valueBase, spark: lastYear(q.points) };
  });

  const ok = rows.filter((r) => !r.error);
  const total = hasQty && ok.length ? ok.reduce((s, r) => s + (r.valueBase ?? 0), 0) : null;
  for (const r of ok) r.weight = total ? ((r.valueBase ?? 0) / total) * 100 : 100 / ok.length;

  const industries: IndustryRow[] = await Promise.all(portfolio.industries.map(async (ind) => {
    const members = ok.filter((r) => r.industry === ind.id);
    let benchmark: IndustryRow['benchmark'] = null;
    if (ind.benchmark) {
      try {
        const b = await quote(ind.benchmark);
        const stats = changeStats(b.points, 'pct');
        if (stats) benchmark = { symbol: ind.benchmark, name: b.name, ...stats };
      } catch { /* 벤치마크 없이 진행 */ }
    }
    return {
      id: ind.id,
      label: ind.label,
      labelEn: ind.labelEn ?? ind.label,
      weight: members.reduce((s, r) => s + (r.weight ?? 0), 0),
      chg: weightedChanges(members),
      benchmark,
    };
  }));

  // 오늘 손익(기준 통화, 환율 변동 제외 추정)
  const dayPnl = hasQty
    ? ok.reduce((s, r) => (r.chg?.d1 == null || !r.valueBase ? s : s + r.valueBase - r.valueBase / (1 + r.chg.d1 / 100)), 0)
    : null;

  return { example: portfolio.example, baseCurrency: base, totalBase: total, dayPnlBase: dayPnl, chg: weightedChanges(ok), fx, rows, industries };
}
