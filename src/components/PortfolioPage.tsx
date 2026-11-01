'use client';

import { useEffect, useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { marketOf } from '@/shared/markets';
import type { HoldingRow, Point, PortfolioView } from '@/shared/types';
import { useActions } from './actions';
import { LineChart } from './charts/LineChart';
import { MiniChart } from './charts/MiniChart';
import { Change, ErrorBox, Loading } from './ui';

type Mode = 'grid' | 'rows';
const RANGES = ['1m', '3m', '6m', '1y', '3y', '5y'] as const;

/**
 * PORT 화면: 기본은 홈처럼 3열 카드(종목마다 가격·변화·1년 그래프),
 * 모드 전환하면 종목마다 한 줄씩 큰 주가 그래프. 추가·수정은 위쪽 "편집".
 */
export function PortfolioPage() {
  const { T, pick, money } = useLang();
  const { openPortfolioEditor } = useActions();
  const { data: p, error } = useApi<PortfolioView>('/api/portfolio');
  const [mode, setMode] = useState<Mode>('grid');
  const [range, setRange] = useState<string>('1y');
  useEffect(() => {
    const m = storage.get('portMode');
    if (m === 'grid' || m === 'rows') setMode(m);
    const r = storage.get('portRange');
    if (r && (RANGES as readonly string[]).includes(r)) setRange(r);
  }, []);

  const chooseMode = (m: Mode) => { storage.set('portMode', m); setMode(m); };
  const chooseRange = (r: string) => { storage.set('portRange', r); setRange(r); };

  if (!p) return <div className="pf-page">{error ? <ErrorBox error={error} /> : <Loading />}</div>;

  return (
    <div className="pf-page">
      <div className="pf-head">
        <div className="pf-title">
          <b>PORT</b>
          <h1>{T.panels.PORT}</h1>
          <span className="dim">{p.rows.length} {T.pf.holdings}</span>
        </div>
        <div className="pf-controls">
          {mode === 'rows' ? (
            <div className="seg" aria-label={T.pf.range}>
              {RANGES.map((r) => <button key={r} className={r === range ? 'active' : ''} onClick={() => chooseRange(r)}>{r.toUpperCase()}</button>)}
            </div>
          ) : null}
          <div className="seg" role="tablist" aria-label={T.pf.mode}>
            <button role="tab" aria-selected={mode === 'grid'} className={mode === 'grid' ? 'active' : ''} onClick={() => chooseMode('grid')}>▦ {T.pf.grid}</button>
            <button role="tab" aria-selected={mode === 'rows'} className={mode === 'rows' ? 'active' : ''} onClick={() => chooseMode('rows')}>☰ {T.pf.rows}</button>
          </div>
          <button className="btn ghost sm" onClick={() => openPortfolioEditor()}>✎ {T.pe.edit}</button>
        </div>
      </div>

      <div className="summary pf-kpis">
        <div><span className="k">{T.total}</span><span className="v lg">{money(p.totalBase)}</span></div>
        <div>
          <span className="k">{T.dayPnl}</span>
          <span className="v lg">{p.dayPnlBase == null ? '—' : <span className={p.dayPnlBase >= 0 ? 'up' : 'down'}>{p.dayPnlBase >= 0 ? '+' : ''}{money(p.dayPnlBase)}</span>}</span>
        </div>
        <div><span className="k">1D</span><span className="v"><Change v={p.chg.d1} /></span></div>
        <div><span className="k">1M</span><span className="v"><Change v={p.chg.m1} /></span></div>
        <div><span className="k">YTD</span><span className="v"><Change v={p.chg.ytd} /></span></div>
        <div><span className="k">1Y</span><span className="v"><Change v={p.chg.y1} /></span></div>
      </div>

      <div className="pf-industries">
        {p.industries.map((i) => (
          <div key={i.id} className="pf-ind">
            <span className="nm">{pick(i.label, i.labelEn)}</span>
            <span className="w">{fmtVal(i.weight, T.locale, 1)}%</span>
            <Change v={i.chg.m1} chip />
            {i.benchmark ? <span className="bm">{i.benchmark.symbol} <Change v={i.benchmark.chg.m1} /></span> : null}
          </div>
        ))}
      </div>

      {!p.rows.length ? <div className="empty">{T.pe.empty}</div> : null}

      {mode === 'grid' ? (
        <div className="pf-grid">
          {p.rows.map((r) => <HoldingCard key={r.symbol} r={r} />)}
        </div>
      ) : (
        <div className="pf-rows">
          {p.rows.map((r) => <HoldingRowView key={r.symbol} r={r} range={range} />)}
        </div>
      )}

      <FxLegend p={p} />
    </div>
  );
}

/** 종목 머리(이름·티커·거래소·업계) — 카드와 한 줄 보기가 함께 쓴다 */
function HoldingHead({ r }: { r: HoldingRow }) {
  const { pick } = useLang();
  const m = marketOf(r.symbol);
  return (
    <div className="pf-name">
      <b>{pick(r.name, r.nameEn)}</b>
      <span className="sym">{r.symbol}</span>
      {m ? <span className="mkt">{pick(m.ko, m.en)}</span> : null}
      <span className="dim ind">{pick(r.industryLabel, r.industryLabelEn)}</span>
    </div>
  );
}

function HoldingCard({ r }: { r: HoldingRow }) {
  const { T, pick, money } = useLang();
  const { openCompany } = useActions();
  return (
    <button className="pf-card" onClick={() => openCompany(r.symbol, pick(r.name, r.nameEn))}>
      <HoldingHead r={r} />
      {r.error || !r.chg ? <div className="err">{r.error}</div> : (
        <>
          <div className="pf-price">
            <span className="px">{fmtVal(r.value, T.locale)}<small>{r.currency ?? ''}</small></span>
            <Change v={r.chg.d1} chip />
          </div>
          <MiniChart points={r.spark} height={120} />
          <div className="pf-stats">
            <span><i>1M</i><Change v={r.chg.m1} /></span>
            <span><i>YTD</i><Change v={r.chg.ytd} /></span>
            <span><i>1Y</i><Change v={r.chg.y1} /></span>
            <span><i>{T.th.weight}</i>{fmtVal(r.weight, T.locale, 1)}%</span>
          </div>
        </>
      )}
    </button>
  );
}

function HoldingRowView({ r, range }: { r: HoldingRow; range: string }) {
  const { T, pick, money } = useLang();
  const { openCompany } = useActions();
  const { data: points, error } = useApi<Point[]>(`/api/series?${qs({ id: `yahoo:${r.symbol}`, range })}`, { refreshInterval: 0 });
  const first = points?.[0]?.[1];
  const last = points?.at(-1)?.[1];
  const rangeChg = first != null && last != null && first !== 0 ? (last / first - 1) * 100 : null;

  return (
    <div className="pf-row">
      <button className="pf-row-info" onClick={() => openCompany(r.symbol, pick(r.name, r.nameEn))}>
        <HoldingHead r={r} />
        {r.error || !r.chg ? <div className="err">{r.error}</div> : (
          <>
            <div className="pf-price">
              <span className="px">{fmtVal(r.value, T.locale)}<small>{r.currency ?? ''}</small></span>
              <Change v={r.chg.d1} chip />
            </div>
            <div className="pf-stats col">
              <span><i>{range.toUpperCase()}</i><Change v={rangeChg} /></span>
              <span><i>YTD</i><Change v={r.chg.ytd} /></span>
              <span><i>{T.th.weight}</i>{fmtVal(r.weight, T.locale, 1)}%</span>
              {r.valueBase != null ? <span><i>{T.total}</i>{money(r.valueBase)}</span> : null}
            </div>
          </>
        )}
      </button>
      <div className="pf-row-chart">
        {points ? <LineChart points={points} height={220} /> : error ? <ErrorBox error={error} /> : <Loading />}
      </div>
    </div>
  );
}

/** 기준 통화로 환산한 환율 안내(외화 종목이 있을 때만) */
export function FxLegend({ p }: { p: PortfolioView }) {
  const { T } = useLang();
  const pair = Object.entries(p.fx).find(([c, r]) => c !== p.baseCurrency && r);
  return pair ? <div className="legend">{T.fxNote(`${pair[0]}/${p.baseCurrency}`, fmtVal(pair[1], T.locale), p.baseCurrency)}</div> : null;
}
