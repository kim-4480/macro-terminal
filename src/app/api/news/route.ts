import type { NewsResponse } from '@/shared/types';
import { HttpStatusError, pickLang, route } from '@/server/api';
import { jobState } from '@/server/jobs';
import { llmStatus } from '@/server/llm';
import { decorate, enrichJobName, enrichTopic, fetchTopicNews, topicInfo, topics } from '@/server/news-intel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ settings, portfolio, url }): Promise<NewsResponse> => {
  const topic = topics(settings, portfolio).find((t) => t.id === url.searchParams.get('topic'));
  if (!topic) throw new HttpStatusError(404, '알 수 없는 주제');
  const lang = pickLang(url.searchParams.get('lang'));
  const items = await fetchTopicNews(topic, settings);
  const view = decorate(topic, items, lang);
  const llm = await llmStatus(settings.llm);
  // 번역·요약이 아직이면 백그라운드로 시작(화면은 폴링)
  const enrich = settings.automation.background || url.searchParams.get('enrich') === '1';
  const job = jobState(enrichJobName(lang, topic.id));
  if (view.pending && llm.online && enrich) void enrichTopic(topic, items, settings, lang);
  // 자동 호출이 꺼져 있으면 사용자가 누를 때까지 기다리고 있다고 알린다
  return { topic: topicInfo(topic), lang, ...view, pending: view.pending && (enrich || job?.state === 'running'), manualEnrich: view.pending && !enrich && job?.state !== 'running', llmOnline: llm.online, job: jobState(enrichJobName(lang, topic.id)) };
});
