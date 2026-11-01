import { baseLang, langFileSuffix, withLang, type BaseLang } from '@/shared/languages';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BriefingKind, Lang } from '@/shared/types';
import { listBriefings, readBriefing } from './briefing';
import { cached } from './cache';
import type { Portfolio, Settings } from './config';
import { runJob } from './jobs';
import { chat, llmStatus } from './llm';
import { quote, rawSeries } from './market-data';
import { decorate, topics } from './news-intel';
import { REPORTS_DIR } from './paths';
import { topicNews } from './sources/news';
import { changeSince, hash, isoWeek, monthLabel, shiftDate, today, valueAtOrBefore, yoy } from './util';

// 주간·월간 브리핑: 기간(7일·1개월)만 다르고 같은 방식으로 만든다.
//  - 지표·시장·보유 종목의 기간 변화(원천 시계열에서 직접 계산)
//  - 금리 곡선의 기간 이동
//  - 기간 동안의 업계·거시 뉴스(뉴스 검색 기간을 늘려서)
//  - 그 기간에 쓴 일간(월간이면 주간도) 브리핑의 "한 줄 요약"

export type Period = Exclude<BriefingKind, 'daily'>;

interface PeriodSpec {
  offset: { days?: number; months?: number };
  newsDays: number;
  newsPerTopic: number;
  /** 파일·화면에 쓰는 기간 이름 */
  label: (date: string) => string;
  /** 이 기간 브리핑이 이미 있으면 자동 생성을 건너뛸 최소 간격(일) */
  autoEveryDays: number;
}

export const PERIODS: Record<Period, PeriodSpec> = {
  weekly: { offset: { days: 7 }, newsDays: 7, newsPerTopic: 16, label: (d) => isoWeek(d).label, autoEveryDays: 7 },
  monthly: { offset: { months: 1 }, newsDays: 30, newsPerTopic: 20, label: monthLabel, autoEveryDays: 30 },
};

const DIRS: Record<Period, string> = {
  weekly: path.join(REPORTS_DIR, 'weekly'),
  monthly: path.join(REPORTS_DIR, 'monthly'),
};
for (const dir of Object.values(DIRS)) mkdirSync(dir, { recursive: true });

const FILE_RE = /^(\d{4}-W\d{2}|\d{4}-\d{2})_(\d{4}-\d{2}-\d{2})_(\d{4})(_[A-Za-z-]+)?\.md$/;

export const periodicJobName = (period: Period, lang: Lang) => `${period}:${lang}`;

const fmt = (v: number | null | undefined, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
const sgn = (v: number | null | undefined, unit: string) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}${unit}`);

/** 일간·주간 브리핑에서 "한 줄 요약" 단락만 뽑는다 */
export function oneLiner(markdown: string): string | null {
  const m = markdown.match(/^##\s*(?:(?:이번 주|이번 달)\s*)?(?:한 줄 요약|(?:the (?:week|month) )?in one line)[^\n]*\n+([\s\S]*?)(?=\n#{1,3}\s|$)/im);
  const text = m?.[1]?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 400) : null;
}

/** 기간 안(시작일 이후)에 쓴 브리핑 파일들의 한 줄 요약 */
function summariesSince(files: { date: string; read: () => string }[], since: string, max: number): string[] {
  const byDate = new Map<string, string>(); // 하루(주)에 여러 개면 가장 최근 것
  for (const f of files) {
    if (f.date < since || byDate.has(f.date)) continue;
    const line = oneLiner(f.read());
    if (line) byDate.set(f.date, line);
  }
  return [...byDate.entries()].sort().slice(-max).map(([d, s]) => `- ${d.slice(5)}: ${s}`);
}

function periodNews(topic: ReturnType<typeof topics>[number], period: Period) {
  const spec = PERIODS[period];
  const key = `news:${period}:${topic.id}:${hash(JSON.stringify([topic.en, topic.ko]))}`;
  return cached(key, 3 * 3600e3, () => topicNews(topic, { days: spec.newsDays, limit: spec.newsPerTopic }));
}

async function buildPeriodContext(period: Period, settings: Settings, portfolio: Portfolio, lang: Lang): Promise<string> {
  const spec = PERIODS[period];
  const en = lang !== 'ko';
  const pick = (ko: string, eng?: string) => (en ? eng || ko : ko);
  const end = today();
  const start = shiftDate(end, { days: -(spec.offset.days ?? 0), months: -(spec.offset.months ?? 0) });
  const span = period === 'weekly' ? '1W' : '1M';
  const out = [`[Period] ${spec.label(end)} (${start} ~ ${end})`, '', `[Macro indicators] (latest value, date, change over the period)`];

  for (const m of settings.macro) {
    try {
      let pts = await rawSeries(m.id, settings);
      if (m.transform === 'yoy') pts = yoy(pts);
      const last = pts.at(-1);
      if (!last) continue;
      const mode = m.transform === 'yoy' || m.unit === '%' || m.unit === '%p' ? 'diff' : 'pct';
      out.push(`- ${pick(m.label, m.labelEn)}: ${fmt(last[1])}${m.unit} (${last[0]}) | ${span} ${sgn(changeSince(pts, spec.offset, mode), mode === 'diff' ? '%p' : '%')}`);
    } catch { /* 키 없음 등은 건너뜀 */ }
  }

  // 금리 곡선: 지금 vs 기간 시작
  const curve = await Promise.all(settings.curve.map((id) => rawSeries(`fred:${id}`, settings).catch(() => [])));
  const tenorLabels = settings.curve.map((id) => id.replace('DGS', '').replace('MO', 'M').replace(/^(\d+)$/, '$1Y'));
  out.push('', `[US Treasury yield curve] now vs ${start}`);
  out.push(`- Now: ${curve.map((pts, i) => `${tenorLabels[i]} ${fmt(pts.at(-1)?.[1])}`).join(', ')}`);
  out.push(`- Start: ${curve.map((pts, i) => `${tenorLabels[i]} ${fmt(valueAtOrBefore(pts, start)?.[1])}`).join(', ')}`);

  out.push('', `[Markets] (last, change over the period)`);
  for (const m of settings.markets) {
    const q = await quote(m.symbol).catch(() => null);
    const last = q?.points.at(-1);
    if (q && last) out.push(`- ${pick(m.label, m.labelEn)}: ${fmt(last[1])} | ${span} ${sgn(changeSince(q.points, spec.offset), '%')}`);
  }

  out.push('', `[My portfolio holdings] (last, change over the period)`);
  for (const h of portfolio.holdings) {
    const q = await quote(h.symbol).catch(() => null);
    const last = q?.points.at(-1);
    const ind = portfolio.industries.find((i) => i.id === h.industry);
    if (q && last) out.push(`- ${pick(h.name ?? h.symbol, h.nameEn)} (${h.symbol}) [${pick(ind?.label ?? h.industry, ind?.labelEn)}]: ${fmt(last[1])} | ${span} ${sgn(changeSince(q.points, spec.offset), '%')}`);
  }
  for (const ind of portfolio.industries) {
    if (!ind.benchmark) continue;
    const q = await quote(ind.benchmark).catch(() => null);
    if (q) out.push(`- Industry benchmark ${pick(ind.label, ind.labelEn)} (${ind.benchmark}): ${span} ${sgn(changeSince(q.points, spec.offset), '%')}`);
  }

  // 그 기간에 쓴 브리핑의 한 줄 요약(흐름 파악용)
  const dailies = summariesSince(listBriefings(lang).map((f) => ({ date: f.slice(0, 10), read: () => readBriefing(f) })), start, period === 'weekly' ? 7 : 12);
  if (dailies.length) out.push('', '[Daily briefing one-liners in this period]', ...dailies);
  if (period === 'monthly') {
    const weeklies = summariesSince(listPeriodic('weekly', lang).map((f) => ({ date: f.match(FILE_RE)?.[2] ?? '', read: () => readPeriodic('weekly', f) })), start, 5);
    if (weeklies.length) out.push('', '[Weekly briefing one-liners in this period]', ...weeklies);
  }

  out.push('', `[News by topic in this period]`);
  for (const topic of topics(settings, portfolio)) {
    const items = await periodNews(topic, period).catch(() => []);
    const { items: dec } = decorate(topic, items, lang);
    out.push(`## ${pick(topic.label, topic.labelEn)}`);
    dec.slice(0, spec.newsPerTopic).forEach((it) => {
      const d = it.published ? new Date(it.published).toISOString().slice(5, 10) : '';
      out.push(`- [${d}] ${it.titleT ?? it.title}`);
    });
  }
  return out.join('\n');
}

const RULES_KO = '규칙: 1) 제공된 데이터·뉴스·지난 브리핑 요약에 있는 수치와 사실만 쓴다. 2) 매수·매도·비중 조절 권유를 하지 않는다. 3) 기간 동안 무엇이 달라졌는지와 그 이유를 지표 간 연결로 설명하되 단정하지 말고 근거를 밝힌다. 4) 데이터에 없는 일정·전망치를 지어내지 않는다. 5) 한국어 마크다운으로 쓴다. 한자나 중국어·일본어 표현을 섞지 말고 순수 한국어로 쓴다(예: YTD는 "연초 대비").';
const RULES_EN = 'Rules: 1) Use only numbers and facts in the provided data, news and past briefing summaries. 2) No buy, sell or rebalancing recommendations. 3) Explain what changed over the period and why, linking indicators with evidence, without overclaiming. 4) Do not invent dates, events or forecasts. 5) Write in English markdown.';

const PROMPTS: Record<Period, Record<BaseLang, { system: string; user: (ctx: string, label: string) => string }>> = {
  weekly: {
    ko: {
      system: `너는 개인 투자자(트레이더 아님)를 위한 거시경제·산업 리서치 애널리스트다. 한 주를 돌아보며 큰 흐름과 사용자 포트폴리오 업계의 변화를 정리한다. ${RULES_KO}`,
      user: (ctx, label) => `${ctx}\n\n위 데이터로 주간 브리핑을 써줘. 구성:\n# 주간 브리핑 (${label})\n## 이번 주 한 줄 요약\n## 이번 주 거시경제 흐름\n## 금융시장 주간 성적\n## 내 포트폴리오 업계 주간 동향\n(업계별 ### 소제목)\n## 다음 주 지켜볼 것\n전체 2000~3200자.`,
    },
    en: {
      system: `You are a macro and industry research analyst for an individual investor (not a trader). Look back on the week: the big picture and how the user's portfolio industries changed. ${RULES_EN}`,
      user: (ctx, label) => `${ctx}\n\nWrite the weekly briefing from the data above. Structure:\n# Weekly Briefing (${label})\n## The week in one line\n## Macro this week\n## Markets: weekly scorecard\n## My portfolio's industries this week\n(one ### subheading per industry)\n## What to watch next week\nAbout 700-1100 words.`,
    },
  },
  monthly: {
    ko: {
      system: `너는 개인 투자자(트레이더 아님)를 위한 거시경제·산업 리서치 애널리스트다. 한 달을 돌아보며 추세 변화와 사용자 포트폴리오 업계의 구조적 흐름을 정리한다. 하루하루의 소음보다 한 달 동안의 방향을 강조한다. ${RULES_KO}`,
      user: (ctx, label) => `${ctx}\n\n위 데이터로 월간 브리핑을 써줘. 구성:\n# 월간 브리핑 (${label})\n## 이번 달 한 줄 요약\n## 이번 달 거시경제: 무엇이 바뀌었나\n## 금융시장 월간 성적\n## 내 포트폴리오 업계 월간 동향\n(업계별 ### 소제목)\n## 다음 달 지켜볼 것\n전체 2500~4000자.`,
    },
    en: {
      system: `You are a macro and industry research analyst for an individual investor (not a trader). Look back on the month: shifts in trend and the structural direction of the user's portfolio industries. Emphasize the month's direction over day-to-day noise. ${RULES_EN}`,
      user: (ctx, label) => `${ctx}\n\nWrite the monthly briefing from the data above. Structure:\n# Monthly Briefing (${label})\n## The month in one line\n## Macro this month: what changed\n## Markets: monthly scorecard\n## My portfolio's industries this month\n(one ### subheading per industry)\n## What to watch next month\nAbout 900-1400 words.`,
    },
  },
};

export function generatePeriodic(period: Period, settings: Settings, portfolio: Portfolio, lang: Lang) {
  return runJob(periodicJobName(period, lang), async () => {
    if (!(await llmStatus(settings.llm)).online) throw new Error('LLM offline: check /setup');
    const label = PERIODS[period].label(today());
    const context = await buildPeriodContext(period, settings, portfolio, lang);
    const md = await chat(settings.llm, [
      { role: 'system', content: withLang(PROMPTS[period][baseLang(lang)].system, lang) },
      { role: 'user', content: PROMPTS[period][baseLang(lang)].user(context, label) },
    ], { maxTokens: 4000, temperature: 0.4 });
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60e3).toISOString();
    const file = `${label}_${local.slice(0, 10)}_${local.slice(11, 16).replace(':', '')}${langFileSuffix(lang)}.md`;
    writeFileSync(path.join(DIRS[period], file), `${md}\n`);
    return file;
  });
}

export function listPeriodic(period: Period, lang: Lang): string[] {
  return readdirSync(DIRS[period])
    .filter((f) => { const m = f.match(FILE_RE); return !!m && (m[4] ?? '') === langFileSuffix(lang); })
    .sort((a, b) => (a.match(FILE_RE)![2]! + a.match(FILE_RE)![3]! < b.match(FILE_RE)![2]! + b.match(FILE_RE)![3]! ? 1 : -1));
}

export function readPeriodic(period: Period, file: string): string {
  if (!FILE_RE.test(file)) throw new Error('잘못된 파일 이름');
  return readFileSync(path.join(DIRS[period], file), 'utf8');
}

/** 마지막 브리핑이 기간보다 오래됐으면(또는 없으면) 새로 만들 때다 */
export function periodicDue(period: Period, lang: Lang): boolean {
  const latest = listPeriodic(period, lang)[0]?.match(FILE_RE)?.[2];
  if (!latest) return true;
  return latest <= shiftDate(today(), { days: -PERIODS[period].autoEveryDays });
}
