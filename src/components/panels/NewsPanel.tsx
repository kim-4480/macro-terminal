'use client';

import { useApi, qs } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import type { NewsResponse, TopicInfo } from '@/shared/types';
import { ErrorBox, Loading, Markdown, Panel } from '../ui';
import { NewsLink } from '../ArticleReader';

const POLL_MS = 8000;

export function NewsPanel({ topicId, onSelectTopic }: { topicId: string | null; onSelectTopic: (id: string) => void }) {
  const { T, lang, pick } = useLang();
  const { data: topics, error: topicsError } = useApi<TopicInfo[]>('/api/topics');
  const current = topics?.some((t) => t.id === topicId) ? topicId : topics?.[0]?.id ?? null;

  const { data: n, error, mutate } = useApi<NewsResponse>(current ? `/api/news?${qs({ topic: current, lang })}` : null, {
    // 번역·요약이 진행 중이면 자주 확인, 끝나면 기본 주기로
    refreshInterval: (latest) => (latest?.pending && latest.llmOnline && latest.job?.state !== 'error' ? POLL_MS : 5 * 60e3),
    keepPreviousData: false,
  });

  const ago = (t: number | null) => (t ? T.ago(Math.max(0, Math.round((Date.now() - t) / 60e3))) : '');

  let digest;
  if (n?.digest) digest = <Markdown className="digest" source={n.digest} />;
  else if (n && !n.llmOnline) digest = <div className="digest dim">{T.news.llmOff}</div>;
  else if (n?.manualEnrich) digest = <div className="digest dim">{T.news.autoOff} <button type="button" className="btn ghost" onClick={() => void fetch(`/api/news?${qs({ topic: n.topic.id, lang, enrich: '1' })}`).then(() => mutate())}>{T.news.enrichNow}</button></div>;
  else if (n?.job?.state === 'waiting-network') digest = <div className="digest dim">{T.news.waitingNet}</div>;
  else if (n?.job?.state === 'error') digest = <div className="digest err">{T.news.fail}: {n.job.error}</div>;
  else if (n) digest = <div className="digest dim spin">{T.news.working}</div>;

  const holdings = n ? (lang !== 'ko' ? n.topic.holdingsEn : n.topic.holdings) : [];

  return (
    <Panel code="N" meta="GOOGLE NEWS · AGENT">
      {topicsError ? <ErrorBox error={topicsError} /> : null}
      <div className="tabs" role="tablist">
        {topics?.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current} className={t.id === current ? 'active' : ''} onClick={() => onSelectTopic(t.id)}>
            {pick(t.label, t.labelEn)}
          </button>
        ))}
      </div>
      {!n ? (error ? <ErrorBox error={error} /> : <Loading label={T.news.loading} />) : (
        <>
          {holdings.length ? <div className="legend">{T.news.related}: {holdings.join(', ')}</div> : null}
          {digest}
          <ul className="news">
            {n.items.length ? n.items.map((it) => (
              <li key={it.id}>
                <NewsLink item={it}>
                  <div className="ko"><span className="tag">{it.lang.toUpperCase()}</span>{it.titleT ?? it.title}</div>
                  {it.lang !== lang && it.titleT ? <div className="orig">{it.title}</div> : null}
                  <div className="meta">{it.source} · {ago(it.published)}</div>
                </NewsLink>
              </li>
            )) : <li className="dim">{T.news.none}</li>}
          </ul>
        </>
      )}
    </Panel>
  );
}
