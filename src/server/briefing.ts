import { baseLang, langFileSuffix, withLang, type BaseLang } from '@/shared/languages';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Lang } from '@/shared/types';
import type { Portfolio, Settings } from './config';
import { runJob } from './jobs';
import { chat, llmStatus } from './llm';
import { macroRows, marketRows, portfolioView, yieldCurve } from './market-data';
import { decorate, enrichTopic, fetchTopicNews, topics } from './news-intel';
import { REPORTS_DIR } from './paths';
import { today } from './util';

const fmt = (v: number | null | undefined, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
const sgn = (v: number | null | undefined, unit: string) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}${unit}`);

/** 모델에 넘길 데이터 요약(숫자는 여기 있는 것만 쓰게 한다). 브리핑과 챗봇이 함께 쓴다. */
export async function buildContext(settings: Settings, portfolio: Portfolio, lang: Lang, { news = true }: { news?: boolean } = {}): Promise<string> {
  const en = lang !== 'ko';
  const pick = (ko: string, eng?: string) => (en ? eng || ko : ko);
  const [macro, markets, curve, pf] = await Promise.all([
    macroRows(settings),
    marketRows(settings),
    yieldCurve(settings).catch(() => null),
    portfolioView(portfolio),
  ]);
  const out = [`[Date] ${today()}`, '', '[Macro indicators] (value, observation date, vs prior obs, vs 1M, vs 1Y)'];
  for (const m of macro) {
    if (m.error || !m.chg) continue;
    const u = m.mode === 'diff' ? '%p' : '%';
    out.push(`- ${pick(m.label, m.labelEn)}: ${fmt(m.value)}${m.unit} (${m.date}) | prior ${sgn(m.chg.d1, u)} | 1M ${sgn(m.chg.m1, u)} | 1Y ${sgn(m.chg.y1, u)}`);
  }
  if (curve) {
    out.push('', `[US Treasury yield curve] as of ${curve.date}`);
    const names = { now: 'Now', m1: '1M ago', y1: '1Y ago' } as const;
    for (const l of curve.lines) out.push(`- ${names[l.key]}: ${curve.tenors.map((t, i) => `${t} ${fmt(l.values[i])}`).join(', ')}`);
  }
  out.push('', '[Markets] (last, 1D, 1M, YTD)');
  for (const m of markets) {
    if (m.error || !m.chg) continue;
    out.push(`- ${pick(m.label, m.labelEn)}: ${fmt(m.value)} | 1D ${sgn(m.chg.d1, '%')} | 1M ${sgn(m.chg.m1, '%')} | YTD ${sgn(m.chg.ytd, '%')}`);
  }
  out.push('', `[My portfolio] 1D ${sgn(pf.chg.d1, '%')} | 1M ${sgn(pf.chg.m1, '%')} | YTD ${sgn(pf.chg.ytd, '%')}`);
  for (const ind of pf.industries) {
    const b = ind.benchmark ? ` / industry benchmark ${ind.benchmark.symbol} 1M ${sgn(ind.benchmark.chg.m1, '%')}` : '';
    out.push(`- Industry ${pick(ind.label, ind.labelEn)} (weight ${fmt(ind.weight, 1)}%): holdings 1M ${sgn(ind.chg.m1, '%')}${b}`);
  }
  for (const r of pf.rows) {
    if (r.error || !r.chg) continue;
    out.push(`  - ${pick(r.name, r.nameEn)} (${r.symbol}) [${pick(r.industryLabel, r.industryLabelEn)}]: 1D ${sgn(r.chg.d1, '%')} | 1M ${sgn(r.chg.m1, '%')} | YTD ${sgn(r.chg.ytd, '%')}`);
  }
  if (!news) return out.join('\n');
  out.push('', '[News by topic]');
  for (const topic of topics(settings, portfolio)) {
    const items = await fetchTopicNews(topic, settings).catch(() => []);
    const view = decorate(topic, items, lang);
    out.push(`## ${pick(topic.label, topic.labelEn)}`);
    if (view.digest) out.push(view.digest);
    else view.items.slice(0, 6).forEach((it) => out.push(`- ${it.titleT ?? it.title}`));
  }
  return out.join('\n');
}

const PROMPTS: Record<BaseLang, { system: string; user: (ctx: string, date: string) => string }> = {
  ko: {
    system: '너는 개인 투자자(트레이더 아님)를 위한 거시경제·산업 리서치 애널리스트다. 사용자는 큰 흐름과 자기 포트폴리오가 속한 업계의 동향을 한 번에 파악하고 싶어 한다. 규칙: 1) 제공된 데이터와 뉴스 요약에 있는 수치·사실만 쓴다. 2) 매수·매도·비중 조절 권유를 하지 않는다. 3) 지표 간 연결(예: 금리-달러-업계)을 설명하되 단정하지 말고 근거를 밝힌다. 4) 데이터에 없는 일정이나 전망치를 지어내지 않는다. 5) 한국어 마크다운으로 쓴다. 한자나 중국어·일본어 표현을 섞지 말고 순수 한국어로 쓴다(예: YTD는 "연초 대비").',
    user: (ctx, d) => `${ctx}\n\n위 데이터로 오늘의 브리핑을 써줘. 구성:\n# 오늘의 브리핑 (${d})\n## 한 줄 요약\n## 거시경제\n## 금융시장\n## 내 포트폴리오 업계 동향\n(업계별 ### 소제목)\n## 앞으로 지켜볼 것\n전체 1500~2500자.`,
  },
  en: {
    system: 'You are a macro and industry research analyst for an individual investor (not a trader) who wants the big picture plus the trends in the industries their portfolio belongs to. Rules: 1) Use only numbers and facts in the provided data and news summaries. 2) No buy, sell or rebalancing recommendations. 3) Explain links between indicators (e.g. rates - dollar - industry) with evidence, without overclaiming. 4) Do not invent dates, events or forecasts that are not in the data. 5) Write in English markdown.',
    user: (ctx, d) => `${ctx}\n\nWrite today's briefing from the data above. Structure:\n# Daily Briefing (${d})\n## In one line\n## Macro\n## Markets\n## My portfolio's industries\n(one ### subheading per industry)\n## What to watch\nAbout 500-800 words.`,
  },
};

const FILE_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4})(_[A-Za-z-]+)?\.md$/;
export const briefingJobName = (lang: Lang) => `briefing:${lang}`;

export function generateBriefing(settings: Settings, portfolio: Portfolio, lang: Lang) {
  return runJob(briefingJobName(lang), async () => {
    if (!(await llmStatus(settings.llm)).online) throw new Error('LLM offline: check /setup');
    // 주제별 번역·요약을 먼저 끝내 두면 브리핑 품질이 좋아진다.
    for (const topic of topics(settings, portfolio)) {
      try { await enrichTopic(topic, await fetchTopicNews(topic, settings), settings, lang); } catch { /* 계속 */ }
    }
    const context = await buildContext(settings, portfolio, lang);
    const md = await chat(settings.llm, [
      { role: 'system', content: withLang(PROMPTS[baseLang(lang)].system, lang) },
      { role: 'user', content: PROMPTS[baseLang(lang)].user(context, today()) },
    ], { maxTokens: 3000, temperature: 0.4 });
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60e3).toISOString();
    const file = `${local.slice(0, 10)}_${local.slice(11, 16).replace(':', '')}${langFileSuffix(lang)}.md`;
    writeFileSync(path.join(REPORTS_DIR, file), `${md}\n`);
    return file;
  });
}

export function listBriefings(lang: Lang): string[] {
  return readdirSync(REPORTS_DIR)
    .filter((f) => { const m = f.match(FILE_RE); return !!m && (m[3] ?? '') === langFileSuffix(lang); })
    .sort()
    .reverse();
}

export function readBriefing(file: string): string {
  if (!FILE_RE.test(file)) throw new Error('잘못된 파일 이름');
  return readFileSync(path.join(REPORTS_DIR, file), 'utf8');
}
