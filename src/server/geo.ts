import countries from 'i18n-iso-countries';
import type { Lang, MapNewsItem, NewsMapResponse } from '@/shared/types';
import { CITIES, cityKey } from '@/shared/geo';
import { peek, put } from './cache';
import type { Portfolio, Settings } from './config';
import { jobState, runJob } from './jobs';
import { chat, llmStatus, parseJsonArray } from './llm';
import { decorate, enrichTopic, fetchTopicNews, topicInfo, topics } from './news-intel';
import type { RawNewsItem } from './sources/news';

// 뉴스 위치 태깅: 모델이 헤드라인마다 "주 무대 국가(ISO 3166-1 alpha-2)와 도시"를 고른다.
// 결과는 기사 id 별로 캐시하고, 모델이 꺼져 있으면 키워드 규칙으로 대신한다.

export interface GeoTag {
  country: string | null;
  city: string | null;
}

const geoKey = (id: string) => `geo:v1:${id}`;

const validCountry = (c: unknown): string | null => {
  if (typeof c !== 'string') return null;
  const up = c.trim().toUpperCase();
  return up.length === 2 && countries.isValid(up) ? up : null;
};

/** 도시는 알려진 목록에 있고 국가가 맞을 때만 쓴다(지도 좌표가 있어야 하므로) */
export function normalizeTag(raw: { c?: unknown; city?: unknown } | null | undefined): GeoTag {
  const country = validCountry(raw?.c);
  const known = CITIES[cityKey(typeof raw?.city === 'string' ? raw.city : null)];
  const city = country && known && known.country === country ? cityKey(raw?.city as string) : null;
  return { country, city };
}

// 모델이 없을 때의 대략적 규칙(영·한). 앞에 있을수록 우선.
const KEYWORDS: [RegExp, string][] = [
  [/\b(fed|federal reserve|wall street|white house|washington|trump|u\.s\.|us treasury|nasdaq|s&p 500)\b|미국|연준|월가|백악관|트럼프|나스닥/i, 'US'],
  [/\b(china|chinese|beijing|shanghai|pboc|xi jinping)\b|중국|베이징|상하이|인민은행|시진핑/i, 'CN'],
  [/\b(japan|japanese|tokyo|boj|nikkei|yen)\b|일본|도쿄|일본은행|닛케이|엔화/i, 'JP'],
  [/\b(korea|korean|seoul|kospi|samsung|sk hynix|hyundai|bok)\b|한국|국내|서울|코스피|코스닥|한은|한국은행|삼성|하이닉스|현대차/i, 'KR'],
  [/\b(taiwan|taiwanese|tsmc|taipei)\b|대만|타이완|tsmc/i, 'TW'],
  [/\b(germany|german|berlin|frankfurt|bundesbank|ecb)\b|독일|유럽중앙은행|ecb/i, 'DE'],
  [/\b(france|french|paris)\b|프랑스|파리/i, 'FR'],
  [/\b(britain|british|uk|england|london|bank of england)\b|영국|런던|영란은행/i, 'GB'],
  [/\b(india|indian|mumbai|rbi|delhi)\b|인도|뭄바이/i, 'IN'],
  [/\b(russia|russian|moscow|kremlin)\b|러시아|모스크바/i, 'RU'],
  [/\b(ukraine|ukrainian|kyiv)\b|우크라이나/i, 'UA'],
  [/\b(israel|israeli|gaza)\b|이스라엘|가자/i, 'IL'],
  [/\b(iran|iranian|tehran)\b|이란/i, 'IR'],
  [/\b(saudi|riyadh|opec)\b|사우디|opec/i, 'SA'],
  [/\b(canada|canadian)\b|캐나다/i, 'CA'],
  [/\b(mexico|mexican)\b|멕시코/i, 'MX'],
  [/\b(brazil|brazilian)\b|브라질/i, 'BR'],
  [/\b(australia|australian|rba)\b|호주/i, 'AU'],
  [/\b(vietnam|vietnamese)\b|베트남/i, 'VN'],
  [/\b(singapore)\b|싱가포르/i, 'SG'],
  [/\b(hong kong)\b|홍콩/i, 'HK'],
];

export function keywordTag(title: string): GeoTag {
  for (const [re, c] of KEYWORDS) if (re.test(title)) return { country: c, city: null };
  return { country: null, city: null };
}

const PROMPT = `For each news headline, identify the single country where the story mainly takes place or which it is mainly about.
Rules:
- "c": ISO 3166-1 alpha-2 code (e.g. "US", "KR", "CN"), or null if the story is global or the place is unclear.
- "city": the English city name only if a specific city is named or clearly implied (e.g. "Washington" for the Fed or White House, "Seoul" for the Bank of Korea), else null.
- Korean-language headlines about domestic Korean topics belong to "KR".
Output only one JSON array with one object {"c": ..., "city": ...} per headline, same order and count as the input.`;

const BATCH = 16;

async function geotag(settings: Settings, items: RawNewsItem[]): Promise<void> {
  const todo = items.filter((it) => !peek(geoKey(it.id)));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const out = await chat(settings.llm, [
      { role: 'system', content: PROMPT },
      { role: 'user', content: JSON.stringify(batch.map((b) => b.title)) },
    ], { maxTokens: 1500, temperature: 0 });
    const arr = parseJsonArray(out);
    if (arr.length !== batch.length) throw new Error('위치 태깅 결과 개수가 맞지 않음');
    batch.forEach((b, j) => put(geoKey(b.id), normalizeTag(arr[j] as { c?: unknown; city?: unknown })));
  }
}

export const GEO_JOB = 'geo';

/** 모든 주제의 뉴스를 위치와 함께. 태깅·번역이 덜 됐으면 백그라운드로 시작(화면은 폴링). */
export async function newsMap(settings: Settings, portfolio: Portfolio, lang: Lang): Promise<NewsMapResponse> {
  const all = topics(settings, portfolio);
  const fetched = await Promise.all(all.map(async (t) => ({ topic: t, items: await fetchTopicNews(t, settings).catch((): RawNewsItem[] => []) })));

  const seen = new Set<string>();
  const items: MapNewsItem[] = [];
  let untagged = false;
  let untranslated = false;
  // 같은 기사가 일반 거시 주제와 업계에 함께 걸리면 업계 쪽으로 분류(지도 필터가 내 업계와 맞도록)
  const ordered = [...fetched].sort((a, b) => Number(a.topic.kind !== 'industry') - Number(b.topic.kind !== 'industry'));
  for (const { topic, items: raw } of ordered) {
    const view = decorate(topic, raw, lang);
    if (view.items.some((it) => it.titleT == null)) untranslated = true;
    for (const it of view.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const cachedTag = peek<GeoTag>(geoKey(it.id))?.value;
      if (!cachedTag) untagged = true;
      const tag = cachedTag ?? keywordTag(it.title);
      items.push({ ...it, topicId: topic.id, country: tag.country, city: tag.city, geoSource: cachedTag ? 'llm' : tag.country ? 'keyword' : null });
    }
  }

  const llm = await llmStatus(settings.llm);
  if (llm.online && settings.automation.background) {
    if (untagged) void runJob(GEO_JOB, () => geotag(settings, fetched.flatMap((f) => f.items)));
    if (untranslated) for (const f of fetched) void enrichTopic(f.topic, f.items, settings, lang);
  }

  items.sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
  return {
    lang,
    items,
    topics: all.map(topicInfo),
    pending: llm.online && (untagged || untranslated),
    llmOnline: llm.online,
    job: jobState(GEO_JOB),
  };
}
