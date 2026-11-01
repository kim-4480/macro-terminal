import { baseLang, langFileSuffix, withLang, type BaseLang } from '@/shared/languages';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CompanyView, Lang } from '@/shared/types';
import { cached, peek, put } from './cache';
import type { Portfolio, Settings } from './config';
import { jobState, runJob } from './jobs';
import { chat, llmStatus } from './llm';
import { macroRows, quote } from './market-data';
import { decorate, enrichJobName, enrichTopic, fetchTopicNews, type Topic } from './news-intel';
import { REPORTS_DIR } from './paths';
import { learnedKoName } from './name-resolver';
import { krxList } from './sources/krx';
import { yfProfile } from './sources/yfinance';
import { changeStats, errorMessage, shiftDate, sinceDate, today } from './util';

// 회사 페이지: 시세 + 그 회사 뉴스(번역·요약) + 회사 브리핑.
// 비상장 기업(창신메모리 등)은 시세·차트 없이 같은 페이지에 뉴스·브리핑만 보여준다.

export const SYMBOL_RE = /^[A-Za-z0-9.^=-]{1,20}$/;
/** 비상장 기업 영어 이름(검색어로 쓰므로 글자·숫자·공백·일부 기호만) */
export const ENTITY_RE = /^[\p{L}\p{N} .&'-]{2,60}$/u;

/** 상장사는 티커로, 비상장은 영어 이름으로 찾는다 */
export type CompanyTarget =
  | { kind: 'listed'; symbol: string; hint: string | null }
  | { kind: 'entity'; nameEn: string; hint: string | null };

/** 캐시·작업·파일 이름에 쓰는 고유 키 */
export const targetKey = (t: CompanyTarget): string =>
  (t.kind === 'listed' ? t.symbol : `ent-${t.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);

/** "Samsung Electronics Co., Ltd." → "Samsung Electronics" (뉴스 검색어용) */
export function cleanCompanyName(name: string): string {
  return name
    // 미국 예탁증서 표기: "ASML Holding N.V. - New York Registry Shares", "… - ADR"
    .replace(/\s+-\s+(new york\s+re\w*|ny\s+reg\w*|adr|ads|american depositary)\b.*$/i, '')
    .replace(/,?\s*(co\.?,?\s*ltd\.?|corporation|corp\.?|incorporated|inc\.?|holdings?|group|plc|ltd\.?|limited|s\.a\.|n\.v\.|ag|se|co\.?)\s*$/i, '')
    .replace(/,?\s*(co\.?,?\s*ltd\.?|corporation|corp\.?|inc\.?)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasHangul = (s: string) => /[가-힣]/.test(s);

/** 한국어·영어 회사 이름: 포트폴리오 > KRX 목록 > 한국어 별칭 > 화면이 넘긴 이름 > yfinance/Yahoo */
export async function resolveNames(t: CompanyTarget, portfolio: Portfolio): Promise<{ nameKo: string; nameEn: string }> {
  if (t.kind === 'entity') {
    // 검색에서 모델이 알려 준 한국어 이름(예: ChangXin Memory → 창신메모리)
    const ko = learnedKoName(`ent:${t.nameEn}`) ?? (t.hint && hasHangul(t.hint) ? t.hint : '');
    return { nameKo: ko || t.nameEn, nameEn: t.nameEn };
  }
  const { symbol, hint } = t;
  const holding = portfolio.holdings.find((h) => h.symbol === symbol);
  let nameKo = holding?.name ?? '';
  let nameEn = holding?.nameEn ?? '';
  if (!nameKo && /\.(KS|KQ)$/.test(symbol)) {
    nameKo = (await krxList().catch(() => [])).find((c) => c.symbol === symbol)?.name ?? '';
  }
  if (!nameKo) nameKo = learnedKoName(symbol) ?? '';
  if (!nameKo && hint && hasHangul(hint)) nameKo = hint;
  if (!nameEn) {
    try {
      const p = await cached(`yfprofile:${symbol}`, 24 * 3600e3, () => yfProfile(symbol));
      // 짧은 이름이 전부 대문자(KWEICHOW MOUTAI)면 정식 이름(Kweichow Moutai Co., Ltd.)을 쓴다
      const shout = (n?: string | null) => !!n && n === n.toUpperCase() && /[A-Z]/.test(n);
      nameEn = (shout(p.shortName) ? p.longName : p.shortName) || p.longName || p.shortName || '';
    } catch { /* yfinance 없으면 Yahoo 이름 */ }
  }
  if (!nameEn) nameEn = (await quote(symbol).catch(() => null))?.name ?? '';
  if (!nameEn && hint && !hasHangul(hint)) nameEn = hint;
  nameEn = cleanCompanyName(nameEn) || symbol;
  return { nameKo: nameKo || nameEn, nameEn };
}

/** 회사 뉴스는 주제(Topic) 하나처럼 다룬다 → 기존 수집·번역·요약을 그대로 쓴다 */
function companyTopic(key: string, nameKo: string, nameEn: string): Topic {
  return {
    id: `co:${key}`,
    label: nameKo,
    labelEn: nameEn,
    en: [`"${nameEn}"`],
    ko: hasHangul(nameKo) ? [`"${nameKo}"`] : [],
    kind: 'industry',
    holdings: [nameKo],
    holdingsEn: [nameEn],
  };
}

const briefKey = (lang: Lang, key: string) => `cobrief:${lang}:${key}`;
export const companyBriefJob = (lang: Lang, key: string) => `cobrief:${lang}:${key}`;

export async function companyView(t: CompanyTarget, lang: Lang, settings: Settings, portfolio: Portfolio): Promise<CompanyView> {
  const key = targetKey(t);
  const { nameKo, nameEn } = await resolveNames(t, portfolio);
  const topic = companyTopic(key, nameKo, nameEn);
  const symbol = t.kind === 'listed' ? t.symbol : null;

  const [q, rawNews, llm] = await Promise.all([
    symbol ? quote(symbol).catch((err: unknown) => new Error(errorMessage(err))) : Promise.resolve(null),
    fetchTopicNews(topic, settings).catch((err: unknown) => new Error(errorMessage(err))),
    llmStatus(settings.llm),
  ]);

  let stats = null;
  let range52w = null;
  if (q && !(q instanceof Error)) {
    stats = changeStats(q.points, 'pct');
    const year = sinceDate(q.points, shiftDate(today(), { years: -1 })).map((p) => p[1]);
    if (year.length) range52w = { low: Math.min(...year), high: Math.max(...year) };
  }

  const items = rawNews instanceof Error ? [] : rawNews;
  const view = decorate(topic, items, lang);
  if (view.pending && llm.online && items.length && settings.automation.background) void enrichTopic(topic, items, settings, lang);

  const h = symbol ? portfolio.holdings.find((x) => x.symbol === symbol) : undefined;
  const ind = h ? portfolio.industries.find((i) => i.id === h.industry) : undefined;

  return {
    symbol,
    listed: t.kind === 'listed',
    nameKo,
    nameEn,
    currency: q && !(q instanceof Error) ? q.currency : null,
    exchange: null,
    quote: stats,
    quoteError: q instanceof Error ? q.message : undefined,
    range52w,
    holding: h ? { qty: h.qty ?? null, industry: h.industry, industryLabel: ind?.label ?? h.industry, industryLabelEn: ind?.labelEn ?? ind?.label ?? h.industry } : null,
    news: view.items,
    digest: view.digest,
    newsPending: llm.online && items.length > 0 && view.pending,
    newsError: rawNews instanceof Error ? rawNews.message : undefined,
    llmOnline: llm.online,
    newsJob: jobState(enrichJobName(lang, topic.id)),
    briefing: peek<{ markdown: string; generatedAt: number }>(briefKey(lang, key))?.value ?? null,
    briefingJob: jobState(companyBriefJob(lang, key)),
  };
}

const fmt = (v: number | null | undefined, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
const sgn = (v: number | null | undefined) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

const PROMPTS: Record<BaseLang, { system: string; user: (ctx: string, name: string, listed: boolean) => string }> = {
  ko: {
    system: '너는 개인 투자자(트레이더 아님)를 위한 기업·산업 리서치 애널리스트다. 제공된 시세·기업 정보·뉴스에 있는 사실과 수치만 근거로 쓴다. 매수·매도·목표가를 제시하지 않는다. 확실하지 않으면 그렇다고 말한다. 한국어 마크다운으로 쓴다. 한자나 중국어·일본어 표현을 섞지 말고 순수 한국어로 쓴다(예: YTD는 "연초 대비").',
    user: (ctx, name, listed) => `${ctx}\n\n위 데이터로 ${name} 브리핑을 써줘. 구성:\n## ${name} 브리핑\n### 한 줄 요약\n${listed ? '### 최근 주가 흐름\n' : ''}### 뉴스로 본 주요 이슈\n### 업계·거시 환경과의 연결\n${listed ? '' : '### 상장 경쟁사·관련 기업에 주는 의미\n'}### 앞으로 지켜볼 점\n전체 800~1400자.${listed ? '' : ' 이 회사는 비상장이라 주가가 없다.'}`,
  },
  en: {
    system: 'You are a company and industry research analyst for an individual investor (not a trader). Use only facts and numbers in the provided quote, company info and news. Do not give buy/sell calls or price targets. Say so when something is uncertain. Write in English markdown.',
    user: (ctx, name, listed) => `${ctx}\n\nWrite a briefing on ${name} from the data above. Structure:\n## ${name} briefing\n### In one line\n${listed ? '### Recent price action\n' : ''}### Key issues from the news\n### Links to industry and macro\n${listed ? '' : '### What it means for listed peers and related companies\n'}### What to watch\nAbout 300-500 words.${listed ? '' : ' This company is private, so there is no share price.'}`,
  },
};

export function generateCompanyBriefing(t: CompanyTarget, lang: Lang, settings: Settings, portfolio: Portfolio) {
  const key = targetKey(t);
  return runJob(companyBriefJob(lang, key), async () => {
    if (!(await llmStatus(settings.llm)).online) throw new Error('LLM offline: check /setup');
    const { nameKo, nameEn } = await resolveNames(t, portfolio);
    const topic = companyTopic(key, nameKo, nameEn);
    const items = await fetchTopicNews(topic, settings).catch(() => []);
    // 회사 뉴스 번역·요약을 먼저
    if (items.length) await enrichTopic(topic, items, settings, lang);
    const view = decorate(topic, items, lang);
    const name = lang !== 'ko' ? nameEn : nameKo;
    const symbol = t.kind === 'listed' ? t.symbol : null;

    const lines = [`[Date] ${today()}`, `[Company] ${nameKo} / ${nameEn}${symbol ? ` (${symbol})` : ' (private, unlisted)'}`];
    if (symbol) {
      const q = await quote(symbol).catch(() => null);
      const s = q ? changeStats(q.points, 'pct') : null;
      if (q && s) {
        const year = sinceDate(q.points, shiftDate(today(), { years: -1 })).map((p) => p[1]);
        lines.push(`[Price] ${fmt(s.value)} ${q.currency ?? ''} (${s.date}) | 1D ${sgn(s.chg.d1)} | 1M ${sgn(s.chg.m1)} | YTD ${sgn(s.chg.ytd)} | 1Y ${sgn(s.chg.y1)} | 52w ${fmt(Math.min(...year))}–${fmt(Math.max(...year))}`);
      }
      try {
        const p = await cached(`yfprofile:${symbol}`, 24 * 3600e3, () => yfProfile(symbol));
        lines.push(`[Profile] sector ${p.sector ?? 'n/a'} / ${p.industry ?? 'n/a'}, country ${p.country ?? 'n/a'}, market cap ${p.marketCap ?? 'n/a'}, P/E ${fmt(p.trailingPE)} (fwd ${fmt(p.forwardPE)}), dividend yield ${fmt(p.dividendYield)}%`);
        if (p.longBusinessSummary) lines.push(`[Business] ${p.longBusinessSummary.slice(0, 900)}`);
      } catch { /* 기업 정보 없이 */ }
      const h = portfolio.holdings.find((x) => x.symbol === symbol);
      if (h) {
        const ind = portfolio.industries.find((i) => i.id === h.industry);
        lines.push(`[My holding] industry ${ind?.label ?? h.industry}${ind?.benchmark ? `, benchmark ${ind.benchmark}` : ''}`);
      }
    } else {
      // 비상장: 내 포트폴리오 종목을 함께 알려 주면 연결 고리(경쟁·공급망)를 짚을 수 있다
      lines.push(`[My holdings] ${portfolio.holdings.map((h) => h.name ?? h.symbol).join(', ')}`);
    }
    // 거시 배경은 핵심 몇 개만
    const macro = await macroRows(settings).catch(() => []);
    const keyMacro = macro.filter((m) => !m.error && m.chg && /DGS10|T10Y2Y|DFF|VIXCLS|DTWEXBGS|CPIAUCSL/.test(m.id));
    if (keyMacro.length) lines.push(`[Macro] ${keyMacro.map((m) => `${m.labelEn ?? m.label} ${fmt(m.value)}${m.unit}`).join(' | ')}`);
    lines.push('', '[Company news]');
    if (view.digest) lines.push(view.digest);
    view.items.slice(0, 12).forEach((it) => lines.push(`- [${it.published ? new Date(it.published).toISOString().slice(0, 10) : ''}][${it.source}] ${it.titleT ?? it.title}`));

    const markdown = await chat(settings.llm, [
      { role: 'system', content: withLang(PROMPTS[baseLang(lang)].system, lang) },
      { role: 'user', content: PROMPTS[baseLang(lang)].user(lines.join('\n'), name, t.kind === 'listed') },
    ], { maxTokens: 2000, temperature: 0.4 });
    const generatedAt = Date.now();
    put(briefKey(lang, key), { markdown, generatedAt });
    // 파일로도 남긴다(reports/companies/키/)
    const dir = path.join(REPORTS_DIR, 'companies', key.replace(/[^\w.-]/g, '_'));
    mkdirSync(dir, { recursive: true });
    const local = new Date(generatedAt - new Date().getTimezoneOffset() * 60e3).toISOString();
    writeFileSync(path.join(dir, `${local.slice(0, 10)}_${local.slice(11, 16).replace(':', '')}${langFileSuffix(lang)}.md`), `${markdown}\n`);
    return markdown;
  });
}
