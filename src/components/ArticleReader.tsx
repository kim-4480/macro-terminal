'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { fetchJson } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import type { ArticleTranslation, ArticleView, Lang, NewsItem } from '@/shared/types';
import { useActions } from './actions';
import { Loading } from './ui';

const load = (item: NewsItem) => fetchJson<ArticleView>('/api/article', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' },
  body: JSON.stringify({ link: item.link, title: item.title, lang: item.lang }),
});

const loadTranslation = (item: NewsItem, lang: Lang, retry: boolean) => fetchJson<ArticleTranslation>('/api/article/translate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' },
  body: JSON.stringify({ link: item.link, title: item.title, articleLang: item.lang, lang, retry }),
});

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** 뉴스 보기: 위에 실제 기사 링크, 아래에 본문(원문 그대로) */
export function ArticleReader({ item, onClose }: { item: NewsItem; onClose: () => void }) {
  const { T, lang } = useLang();
  const { data, error } = useSWR(item.link, () => load(item), { revalidateOnFocus: false });
  // 스위치를 켠 동안만 번역을 받아 온다(끝날 때까지 2초마다)
  const [translated, setTranslated] = useState(false);
  const canTranslate = !!data?.text && item.lang !== lang;
  const { data: tr, error: trError, mutate: retranslate } = useSWR(
    translated && canTranslate ? ['/api/article/translate', item.link, lang] as const : null,
    ([, , l]) => loadTranslation(item, l, false),
    { revalidateOnFocus: false, refreshInterval: (d) => (d?.complete || d?.error || d?.llmOnline === false ? 0 : 2000) },
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);

  const title = data?.title || item.title;
  const date = item.published ? new Date(item.published).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  // 본문을 못 읽었거나 원문 주소를 못 얻었으면 목록의 링크라도 준다
  const url = data?.url ?? null;

  return (
    <div className="gp" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gp-box art" role="dialog" aria-modal="true" aria-labelledby="art-title">
        <div className="art-top">
          <div className="gp-head">
            <h2 id="art-title"><b>{T.art.badge}</b>{title}</h2>
            <button ref={closeRef} className="x" onClick={onClose} aria-label={T.art.close}>✕</button>
          </div>

          <div className="art-link">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                <span>{T.art.open} ↗</span>
                <span className="dim">{host(url)}</span>
              </a>
            ) : error ? (
              <a href={item.link} target="_blank" rel="noopener noreferrer"><span>{T.art.open} ↗</span></a>
            ) : <span className="dim spin">{T.art.loading}</span>}
            {canTranslate ? (
              <button type="button" role="switch" aria-checked={translated} className={`art-switch${translated ? ' on' : ''}`} onClick={() => setTranslated((v) => !v)}>
                <span className="track" aria-hidden="true"><span className="thumb" /></span>{T.art.translate}
              </button>
            ) : null}
            <span className="dim">{[item.source, date].filter(Boolean).join(' · ')}</span>
          </div>
        </div>

        {item.titleT && item.titleT !== item.title ? <div className="art-trans dim">{item.titleT}</div> : null}

        <div className="art-body" lang={item.lang}>
          {!data && !error ? <Loading label={T.art.loading} /> : null}
          {error || data?.error ? <div className="empty err">{data?.reason ? T.art.reasons[data.reason] : T.art.fail}</div> : null}
          {data && !data.error && data.partial ? <div className="legend">{T.art.partial}</div> : null}
          {data?.text ? (
            <>
              {translated && canTranslate ? (
                <div className="legend" role="status">
                  {tr?.llmOnline === false ? T.art.transOffline : tr?.error || trError ? (
                    <>{T.art.transFail}: {tr?.error ?? (trError as Error).message} <button type="button" className="link" onClick={() => void retranslate(loadTranslation(item, lang, true), { revalidate: false })}>{T.art.retry}</button></>
                  ) : tr?.complete ? <>{T.art.transNote}{tr.skipped ? ` ${T.art.transSkipped}` : ''}</> : <span className="spin">{T.art.transWorking}</span>}
                </div>
              ) : <div className="legend">{T.art.note}</div>}
              {data.text.split('\n').map((p, i) => {
                const t = translated && canTranslate ? tr?.paragraphs[i] : null;
                return t ? <p key={i} lang={lang}>{t}</p> : <p key={i} className={translated && canTranslate ? 'pending' : undefined}>{p}</p>;
              })}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 뉴스 목록 링크: 누르면 터미널 안에서 기사 보기(⌘/Ctrl·가운데 클릭은 원문을 새 창으로) */
export function NewsLink({ item, children }: { item: NewsItem; children: ReactNode }) {
  const { openArticle } = useActions();
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openArticle(item);
      }}
    >
      {children}
    </a>
  );
}
