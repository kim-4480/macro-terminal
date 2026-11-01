import { baseLang, withLang, type BaseLang } from '@/shared/languages';
import type { Lang, NewsItem, TopicInfo } from '@/shared/types';
import { cached, peek, put } from './cache';
import type { Portfolio, Settings, TopicConfig } from './config';
import { runJob } from './jobs';
import { chat, llmStatus, parseJsonArray } from './llm';
import { type RawNewsItem, topicNews } from './sources/news';
import { hash } from './util';

/** 뉴스 주제 = 일반 거시 주제(settings) + 포트폴리오 업계 */
export type Topic = TopicConfig & TopicInfo;

export function topics(settings: Settings, portfolio: Portfolio): Topic[] {
  const holdingsOf = (id: string, lang: Lang) => portfolio.holdings
    .filter((h) => h.industry === id)
    .map((h) => (lang !== 'ko' ? h.nameEn || h.symbol : h.name || h.symbol));
  return [
    ...settings.news.general.map((t): Topic => ({ ...t, labelEn: t.labelEn ?? t.label, kind: 'general', holdings: [], holdingsEn: [] })),
    ...portfolio.industries.map((t): Topic => ({
      ...t,
      // 업계 검색어 + 그 업계에 넣은 보유 종목 이름 → 업계 뉴스·지도가 내 종목과 맞물린다
      en: withHoldingQueries(t.en, portfolio, t.id, 'en'),
      ko: withHoldingQueries(t.ko, portfolio, t.id, 'ko'),
      labelEn: t.labelEn ?? t.label, kind: 'industry', holdings: holdingsOf(t.id, 'ko'), holdingsEn: holdingsOf(t.id, 'en'),
    })),
  ];
}

const HOLDING_QUERIES = 3;

/** 업계 검색어에 보유 종목 이름(한국어 뉴스엔 한글 이름, 영어 뉴스엔 영어 이름)을 몇 개 더한다 */
export function withHoldingQueries(base: string[], portfolio: Portfolio, industryId: string, lang: Lang): string[] {
  const names = portfolio.holdings
    .filter((h) => h.industry === industryId)
    .map((h) => (lang !== 'ko' ? h.nameEn || h.name : h.name))
    .filter((n): n is string => !!n && n.trim().length >= 2 && (lang !== 'ko' ? !/[가-힣]/.test(n) : /[가-힣]/.test(n)))
    .slice(0, HOLDING_QUERIES)
    .map((n) => `"${n.trim()}"`);
  return [...base, ...names.filter((n) => !base.includes(n))];
}

export const topicInfo = ({ id, label, labelEn, kind, holdings, holdingsEn }: Topic): TopicInfo =>
  ({ id, label, labelEn, kind, holdings, holdingsEn });

export function fetchTopicNews(topic: Topic, settings: Settings): Promise<RawNewsItem[]> {
  const key = `news:${topic.id}:${hash(JSON.stringify([topic.en, topic.ko]))}`;
  return cached(key, 30 * 60e3, () => topicNews(topic, { days: settings.news.days, limit: settings.news.perTopic }));
}

const trKey = (lang: Lang, id: string) => `tr:${lang}:${id}`;
const digestKey = (lang: Lang, topic: Topic, items: RawNewsItem[]) => `digest:${lang}:${topic.id}:${hash(items.map((i) => i.id).join(','))}`;
const titleIn = (lang: Lang, it: RawNewsItem): string | null => (it.lang === lang ? it.title : peek<string>(trKey(lang, it.id))?.value ?? null);

export function decorate(topic: Topic, items: RawNewsItem[], lang: Lang): { items: NewsItem[]; digest: string | null; pending: boolean } {
  const enriched = items.map((it) => ({ ...it, titleT: titleIn(lang, it) }));
  const digest = peek<string>(digestKey(lang, topic, items))?.value ?? null;
  return { items: enriched, digest, pending: enriched.some((it) => it.titleT == null) || digest == null };
}

const PROMPTS: Record<BaseLang, { translate: string; digestSystem: string; digestUser: (label: string, who: string, lines: string) => string }> = {
  ko: {
    translate: '너는 경제·금융 뉴스 전문 번역가다. 뉴스 제목을 자연스러운 한국어 기사 제목으로 번역한다. 회사명·인물명은 한국 언론 표기(예: 젠슨 황)를 따른다. 출력은 번역된 문자열의 JSON 배열 하나뿐이며, 입력과 같은 순서·같은 개수를 유지한다.',
    digestSystem: '너는 개인 투자자를 위해 산업·거시 동향을 정리하는 리서치 애널리스트다. 주어진 뉴스 헤드라인만 근거로 쓰고, 헤드라인에 없는 수치나 사실은 만들지 않는다. 매수·매도 권유는 하지 않는다. 한국어로 간결하게 쓴다. 한자나 중국어·일본어 표현을 섞지 말고 순수 한국어로 쓴다(예: YTD는 "연초 대비").',
    digestUser: (label, who, lines) => `주제: ${label}${who ? `\n관련 보유 종목: ${who}` : ''}\n최근 헤드라인:\n${lines}\n\n출력 규칙: 제목이나 머리말 없이, 서로 겹치지 않는 핵심 동향 3~5개를 "- "로 시작하는 한 줄짜리 글머리표로 쓴다. 그 다음 빈 줄을 두고 "**시사점:** "으로 시작하는 한두 문장을 쓴다. 인명·기업명은 한국 언론 표기(예: 젠슨 황)를 따른다.`,
  },
  en: {
    translate: 'You are a professional financial news translator. Translate each headline into natural English news-headline style. Use the standard English spelling of company and person names. Output only one JSON array of strings, in the same order and with the same count as the input.',
    digestSystem: 'You are a research analyst summarizing industry and macro trends for an individual investor. Use only the given headlines; do not invent numbers or facts that are not in them. Do not give buy or sell recommendations. Write concise English.',
    digestUser: (label, who, lines) => `Topic: ${label}${who ? `\nRelated holdings: ${who}` : ''}\nRecent headlines:\n${lines}\n\nOutput rules: no title or preamble. Write 3-5 non-overlapping key trends, each one line starting with "- ". Then a blank line and one or two sentences starting with "**Takeaway:** ".`,
  },
};

const BATCH = 12;

async function translate(settings: Settings, items: RawNewsItem[], lang: Lang): Promise<void> {
  const todo = items.filter((it) => it.lang !== lang && !peek(trKey(lang, it.id)));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const out = await chat(settings.llm, [
      { role: 'system', content: withLang(PROMPTS[baseLang(lang)].translate, lang) },
      { role: 'user', content: JSON.stringify(batch.map((b) => b.title)) },
    ], { maxTokens: 2000, temperature: 0.1 });
    const arr = parseJsonArray(out);
    if (arr.length !== batch.length) throw new Error('번역 결과 개수가 맞지 않음');
    batch.forEach((b, j) => {
      const t = arr[j];
      if (typeof t === 'string' && t.trim()) put(trKey(lang, b.id), t.trim());
    });
  }
}

async function digest(settings: Settings, topic: Topic, items: RawNewsItem[], lang: Lang): Promise<void> {
  const key = digestKey(lang, topic, items);
  if (peek(key)) return;
  const lines = items.map((it) => {
    const d = it.published ? new Date(it.published).toISOString().slice(5, 10) : '';
    return `- [${d}][${it.source}] ${titleIn(lang, it) ?? it.title}`;
  }).join('\n');
  const label = lang !== 'ko' ? topic.labelEn : topic.label;
  const who = (lang !== 'ko' ? topic.holdingsEn : topic.holdings).join(', ');
  const text = await chat(settings.llm, [
    { role: 'system', content: withLang(PROMPTS[baseLang(lang)].digestSystem, lang) },
    { role: 'user', content: PROMPTS[baseLang(lang)].digestUser(label, who, lines) },
  ], { maxTokens: 700 });
  put(key, text);
}

export const enrichJobName = (lang: Lang, topicId: string) => `news:${lang}:${topicId}`;

/** 제목 번역 → 주제 요약. 인터넷이 끊기면 jobs 가 기다렸다가 이어서 한다. */
export function enrichTopic(topic: Topic, items: RawNewsItem[], settings: Settings, lang: Lang) {
  return runJob(enrichJobName(lang, topic.id), async () => {
    if (!(await llmStatus(settings.llm)).online) throw new Error('LLM 오프라인');
    await translate(settings, items, lang);
    await digest(settings, topic, items, lang);
  });
}
