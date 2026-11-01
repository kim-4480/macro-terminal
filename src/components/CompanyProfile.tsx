'use client';

import { qs, useApi } from '@/lib/api';
import { compact, fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { CompanyProfile as Profile } from '@/shared/types';
import { Loading } from './ui';

/** yfinance 기업 개요(업종·시가총액·PER·배당·사업 설명). 한국어 화면이면 설명을 모델이 번역. */
export function CompanyProfile({ symbol, className = 'gp-profile' }: { symbol: string; className?: string }) {
  const { T, lang } = useLang();
  const { data: p, error } = useApi<Profile>(`/api/profile?${qs({ symbol, lang })}`, {
    refreshInterval: (latest) => (latest?.summaryPending ? 4000 : 0),
  });

  if (error) return <div className={className}><div className="empty dim">{T.prof.none}</div></div>;
  if (!p) return <div className={className}><Loading /></div>;
  if (!p.longName && !p.sector && !p.marketCap) return null;

  const site = p.website && /^https?:\/\//.test(p.website) ? p.website : null;
  const cell = (k: string, v: string) => <div><span className="k">{k}</span><span className="v">{v}</span></div>;
  return (
    <div className={className}>
      <div className="legend">
        {T.prof.title} — {p.longName ?? p.shortName ?? symbol}
        {site ? <> · <a href={site} target="_blank" rel="noopener noreferrer">{site.replace(/^https?:\/\//, '')}</a></> : null}
      </div>
      <div className="summary">
        {cell(T.prof.sector, [p.sector, p.industry].filter(Boolean).join(' · ') || '—')}
        {cell(T.prof.country, p.country ?? '—')}
        {cell(T.prof.cap, compact(p.marketCap, T.locale, p.currency))}
        {cell(T.prof.pe, [p.trailingPE, p.forwardPE].map((v) => (v == null ? '—' : fmtVal(v, T.locale, 1))).join(' / '))}
        {cell(T.prof.pb, p.priceToBook == null ? '—' : fmtVal(p.priceToBook, T.locale, 2))}
        {cell(T.prof.div, p.dividendYield == null ? '—' : `${fmtVal(p.dividendYield, T.locale, 2)}%`)}
        {cell(T.prof.emp, p.fullTimeEmployees == null ? '—' : p.fullTimeEmployees.toLocaleString(T.locale))}
      </div>
      {p.summary ? <p className="prof-sum">{p.summary}</p> : null}
      {p.summaryPending ? <div className="legend spin">{T.prof.translating}</div> : null}
    </div>
  );
}
