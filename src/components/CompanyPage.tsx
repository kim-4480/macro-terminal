'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchJson, qs, useApi } from '@/lib/api';
import { fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { marketOf } from '@/shared/markets';
import type { CompanyView, Point } from '@/shared/types';
import { LineChart } from './charts/LineChart';
import { CompanyProfile } from './CompanyProfile';
import { Change, ErrorBox, Loading, Markdown } from './ui';
import { NewsLink } from './ArticleReader';

const RANGES = ['1m', '3m', '6m', '1y', '3y', '5y', '10y'] as const;
const POLL_MS = 5000;

/** 회사 한 곳을 한 페이지로: 큰 주가 차트(가로 전체) → 지표 → AI 브리핑(토글) → 기업 개요 → 관련 뉴스 */
export function CompanyPage({ symbol, entity, hint, onBack, onAddToPortfolio }: {
  /** 상장사 티커(비상장이면 null) */
  symbol: string | null;
  /** 비상장 기업 영어 이름 */
  entity: string | null;
  hint: string | null;
  onBack: () => void;
  onAddToPortfolio: (symbol: string, name: string, nameEn: string) => void;
}) {
  const { T, lang, pick } = useLang();
  const [range, setRange] = useState<string>(() => storage.get('coRange') ?? '1y');
  const [briefOn, setBriefOn] = useState<boolean>(() => storage.get('coBriefing') === '1');
  const autoStarted = useRef<string | null>(null);

  const target = symbol ? { symbol } : { entity };
  const { data: c, error, mutate } = useApi<CompanyView>(`/api/company?${qs({ ...target, name: hint, lang })}`, {
    refreshInterval: (latest) => {
      const busy = latest?.newsPending || latest?.briefingJob?.state === 'running' || latest?.briefingJob?.state === 'waiting-network';
      return busy ? POLL_MS : 5 * 60e3;
    },
    keepPreviousData: false,
  });
  const { data: points, error: chartError } = useApi<Point[]>(symbol ? `/api/series?${qs({ id: `yahoo:${symbol}`, range })}` : null, { refreshInterval: 0 });

  const briefState = c?.briefingJob?.state;
  const writing = briefState === 'running' || briefState === 'waiting-network';

  const generate = async () => {
    await fetchJson(`/api/company/briefing?${qs({ ...target, name: hint, lang })}`, { method: 'POST' }).catch(() => undefined);
    await mutate();
  };

  // 토글이 켜져 있고 오늘 만든 브리핑이 없으면 자동으로 한 번 생성
  useEffect(() => {
    if (!briefOn || !c || !c.llmOnline || writing) return;
    const key = `${symbol ?? entity}:${lang}`;
    const fresh = c.briefing && new Date(c.briefing.generatedAt).toDateString() === new Date().toDateString();
    if (!fresh && autoStarted.current !== key) {
      autoStarted.current = key;
      void generate();
    }
  }, [briefOn, c?.briefing?.generatedAt, c?.llmOnline, writing, symbol, entity, lang]);

  const toggle = () => {
    const next = !briefOn;
    storage.set('coBriefing', next ? '1' : '0');
    setBriefOn(next);
  };

  if (!c) return <div className="co-page">{error ? <ErrorBox error={error} /> : <Loading />}</div>;

  const name = pick(c.nameKo, c.nameEn);
  const other = lang === 'ko' ? c.nameEn : c.nameKo;
  const ago = (t: number | null) => (t ? T.ago(Math.max(0, Math.round((Date.now() - t) / 60e3))) : '');
  const first = points?.[0]?.[1];
  const last = points?.at(-1)?.[1];
  const rangeChange = first != null && last != null && first !== 0 ? (last / first - 1) * 100 : null;

  return (
    <div className="co-page">
      <div className="co-head">
        <button className="co-back" onClick={onBack}>{T.co.back}</button>
        <div className="co-title">
          <h1>{name}</h1>
          <div className="co-sub">
            {c.symbol ? <span className="sym">{c.symbol}</span> : <span className="badge muted">{T.co.unlisted}</span>}
            {c.symbol && marketOf(c.symbol) ? <span className="mkt">{pick(marketOf(c.symbol)!.ko, marketOf(c.symbol)!.en)}</span> : null}
            {other && other !== name ? <span>{other}</span> : null}
            {c.holding ? <span className="badge">{T.co.holding} · {pick(c.holding.industryLabel, c.holding.industryLabelEn)}{c.holding.qty ? ` · ${T.co.qty} ${c.holding.qty}` : ''}</span> : null}
          </div>
        </div>
        {c.listed ? (
          <div className="co-price">
            <span className="px">{c.quote ? fmtVal(c.quote.value, T.locale) : '—'}<small>{c.currency ?? ''}</small></span>
            {c.quote ? <Change v={c.quote.chg.d1} chip /> : null}
          </div>
        ) : null}
        {c.symbol && !c.holding ? <button className="btn ghost" onClick={() => onAddToPortfolio(c.symbol!, c.nameKo, c.nameEn)}>{T.co.addToPortfolio}</button> : null}
      </div>

      {!c.listed ? <div className="banner co-note">{T.co.unlistedNote}</div> : null}

      {c.listed ? <>
      <div className="summary co-stats">
        <div><span className="k">1D</span><span className="v"><Change v={c.quote?.chg.d1} /></span></div>
        <div><span className="k">1M</span><span className="v"><Change v={c.quote?.chg.m1} /></span></div>
        <div><span className="k">YTD</span><span className="v"><Change v={c.quote?.chg.ytd} /></span></div>
        <div><span className="k">1Y</span><span className="v"><Change v={c.quote?.chg.y1} /></span></div>
        <div><span className="k">{T.co.range52}</span><span className="v">{c.range52w ? `${fmtVal(c.range52w.low, T.locale)} – ${fmtVal(c.range52w.high, T.locale)}` : '—'}</span></div>
        <div><span className="k">{T.co.last}</span><span className="v">{c.quote?.date ?? '—'}</span></div>
      </div>

      <section className="co-chart">
        <div className="co-chart-head">
          <b>{T.co.chart}</b>
          <span className="dim">{range.toUpperCase()}</span> <Change v={rangeChange} />
          <div className="ranges">
            {RANGES.map((r) => (
              <button key={r} className={r === range ? 'active' : ''} onClick={() => { storage.set('coRange', r); setRange(r); }}>{r.toUpperCase()}</button>
            ))}
          </div>
        </div>
        {points ? <LineChart points={points} height={460} /> : chartError ? <ErrorBox error={chartError} /> : <Loading />}
        {c.quoteError ? <div className="empty err">{c.quoteError}</div> : null}
      </section>
      </> : null}

      <section className="co-brief">
        <div className="co-section-head">
          <label className="switch">
            <input type="checkbox" checked={briefOn} onChange={toggle} />
            <span className="track"><span className="knob" /></span>
            <b>{T.co.toggle}</b>
          </label>
          {briefOn && c.briefing ? <span className="dim">{T.co.generated} {ago(c.briefing.generatedAt)}</span> : null}
          {briefOn ? (
            <button className="btn" onClick={() => void generate()} disabled={writing || !c.llmOnline}>
              {c.briefing ? T.co.regenerate : T.co.generate}
            </button>
          ) : null}
        </div>
        {briefOn ? (
          <div className="co-brief-body">
            {briefState === 'running' ? <div className="legend spin">{T.co.writing}</div> : null}
            {briefState === 'waiting-network' ? <div className="legend">{T.co.waitingNet}</div> : null}
            {briefState === 'error' ? <div className="legend err">{c.briefingJob?.error}</div> : null}
            {!c.llmOnline ? <div className="legend err">{T.co.offline}</div> : null}
            {c.briefing ? <Markdown className="md" source={c.briefing.markdown} /> : !writing ? <div className="empty">{T.co.noBriefing}</div> : null}
          </div>
        ) : null}
      </section>

      {c.symbol ? <CompanyProfile symbol={c.symbol} className="co-profile" /> : null}

      <section className="co-news">
        <div className="co-section-head">
          <b>{T.co.news}</b>
          <span className="dim">{c.news.length}</span>
          {c.newsPending ? <span className="dim spin">{T.co.newsWorking}</span> : null}
        </div>
        {c.digest ? <Markdown className="digest" source={c.digest} /> : null}
        {c.newsError ? <div className="empty err">{c.newsError}</div> : null}
        <ul className="news">
          {c.news.length ? c.news.map((it) => (
            <li key={it.id}>
              <NewsLink item={it}>
                <div className="ko"><span className="tag">{it.lang.toUpperCase()}</span>{it.titleT ?? it.title}</div>
                {it.lang !== lang && it.titleT ? <div className="orig">{it.title}</div> : null}
                <div className="meta">{it.source} · {ago(it.published)}</div>
              </NewsLink>
            </li>
          )) : <li className="dim">{T.co.noNews}</li>}
        </ul>
      </section>
    </div>
  );
}
