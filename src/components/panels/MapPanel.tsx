'use client';

import { useMemo, useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { countryName } from '@/lib/countries';
import { useLang } from '@/lib/i18n';
import { CITIES } from '@/shared/geo';
import type { NewsMapResponse } from '@/shared/types';
import { WorldMap } from '../charts/WorldMap';
import { ErrorBox, Loading, Panel } from '../ui';
import { NewsLink } from '../ArticleReader';

const POLL_MS = 6000;

export function MapPanel() {
  const { T, lang, pick } = useLang();
  const [topic, setTopic] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const { data, error } = useApi<NewsMapResponse>(`/api/newsmap?${qs({ lang })}`, {
    refreshInterval: (latest) => (latest?.pending ? POLL_MS : 5 * 60e3),
  });

  const items = useMemo(() => (data?.items ?? []).filter((it) => !topic || it.topicId === topic), [data, topic]);
  const located = items.filter((it) => it.country);
  const ranking = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of located) m.set(it.country!, (m.get(it.country!) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [located]);
  const top = ranking[0]?.[1] ?? 1;
  const list = country ? located.filter((it) => it.country === country) : items;
  const ago = (t: number | null) => (t ? T.ago(Math.max(0, Math.round((Date.now() - t) / 60e3))) : '');
  const topicLabel = (id: string) => { const t = data?.topics.find((x) => x.id === id); return t ? pick(t.label, t.labelEn) : id; };

  if (!data) return <Panel code="MAP">{error ? <ErrorBox error={error} /> : <Loading />}</Panel>;

  const status = !data.llmOnline ? T.map.keywordOnly
    : data.job?.state === 'waiting-network' ? T.news.waitingNet
      : data.pending ? T.map.tagging : null;

  return (
    <Panel code="MAP" meta={`${located.length}/${items.length} ${T.map.located.toUpperCase()}`} className="map-body">
      <div className="tabs">
        <button className={!topic ? 'active' : ''} onClick={() => setTopic(null)}>{T.map.all}</button>
        {data.topics.map((t) => (
          <button key={t.id} className={t.id === topic ? 'active' : ''} onClick={() => setTopic(t.id)}>{pick(t.label, t.labelEn)}</button>
        ))}
        {status ? <span className={`map-status dim${data.pending ? ' spin' : ''}`}>{status}</span> : null}
      </div>

      <div className="map-wrap">
        <div className="map-main">
          <WorldMap items={items} selected={country} onSelect={setCountry} />
          <div className="map-rank">
            {ranking.slice(0, 12).map(([c, n]) => (
              <button key={c} className={c === country ? 'active' : ''} onClick={() => setCountry(c === country ? null : c)}>
                <span className="nm">{countryName(c, lang)}</span>
                <span className="bar"><i style={{ width: `${(n / top) * 100}%` }} /></span>
                <span className="n">{n}</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="map-side">
          <div className="map-side-head">
            <b>{country ? countryName(country, lang) : T.map.countries}</b>
            <span className="dim">{list.length} {T.map.stories}</span>
            {country ? <button className="link" onClick={() => setCountry(null)}>{T.map.clear}</button> : null}
          </div>
          {!country ? <div className="legend">{T.map.pick}</div> : null}
          <ul className="news">
            {list.length ? list.map((it) => (
              <li key={it.id}>
                <NewsLink item={it}>
                  <div className="ko">
                    <span className="tag">{it.country ?? '—'}</span>
                    {it.titleT ?? it.title}
                  </div>
                  <div className="meta">
                    {it.city && CITIES[it.city] ? `${lang === 'ko' ? CITIES[it.city]!.ko : it.city} · ` : ''}
                    {topicLabel(it.topicId)} · {it.source} · {ago(it.published)}
                  </div>
                </NewsLink>
              </li>
            )) : <li className="dim">{T.map.noNews}</li>}
          </ul>
        </aside>
      </div>
    </Panel>
  );
}
