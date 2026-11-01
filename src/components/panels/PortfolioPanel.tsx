'use client';

import { useApi } from '@/lib/api';
import { FxLegend } from '../PortfolioPage';
import { fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { PortfolioView } from '@/shared/types';
import { useActions } from '../actions';
import { Change, ErrorBox, Loading, Panel, Sparkline } from '../ui';

export function PortfolioPanel() {
  const { T, pick, money } = useLang();
  const { openCompany, openPortfolioEditor } = useActions();
  const { data: p, error } = useApi<PortfolioView>('/api/portfolio');

  if (!p) return <Panel code="PORT" meta={<button className="btn ghost sm" onClick={() => openPortfolioEditor()}>{T.pe.edit}</button>}>{error ? <ErrorBox error={error} /> : <Loading />}</Panel>;
  return (
    <Panel code="PORT" meta={<button className="btn ghost sm" onClick={() => openPortfolioEditor()}>{T.pe.edit}</button>}>
      <div className="summary">
        <div><span className="k">{T.total}</span><span className="v lg">{money(p.totalBase)}</span></div>
        <div>
          <span className="k">{T.dayPnl}</span>
          <span className="v lg">
            {p.dayPnlBase == null ? '—' : <span className={p.dayPnlBase >= 0 ? 'up' : 'down'}>{p.dayPnlBase >= 0 ? '+' : ''}{money(p.dayPnlBase)}</span>}
          </span>
        </div>
        <div><span className="k">1D</span><span className="v"><Change v={p.chg.d1} /></span></div>
        <div><span className="k">1M</span><span className="v"><Change v={p.chg.m1} /></span></div>
        <div><span className="k">YTD</span><span className="v"><Change v={p.chg.ytd} /></span></div>
      </div>

      <table className="t">
        <thead>
          <tr><th>{T.th.industry}</th><th>{T.th.weight}</th><th>1D</th><th>1M</th><th>YTD</th><th className="hide-sm">{T.th.bench}</th></tr>
        </thead>
        <tbody>
          {p.industries.map((i) => (
            <tr key={i.id}>
              <td className="name">{pick(i.label, i.labelEn)}</td>
              <td>{fmtVal(i.weight, T.locale, 1)}%</td>
              <td><Change v={i.chg.d1} /></td>
              <td><Change v={i.chg.m1} /></td>
              <td><Change v={i.chg.ytd} /></td>
              <td className="hide-sm">{i.benchmark ? <><span className="sub">{i.benchmark.symbol}</span> <Change v={i.benchmark.chg.m1} /></> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="t">
        <thead>
          <tr>
            <th>{T.th.holding}</th><th className="hide-sm">{T.th.industry}</th><th>{T.th.price}</th><th>{T.th.weight}</th>
            <th>1D</th><th>1M</th><th>YTD</th><th className="hide-sm">{T.th.y1}</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => {
            const name = pick(r.name, r.nameEn);
            if (r.error || !r.chg) return <tr key={r.symbol}><td className="name">{name}</td><td colSpan={7} className="err">{r.error}</td></tr>;
            return (
              <tr key={r.symbol} className="click" onClick={() => openCompany(r.symbol, name)}>
                <td className="name" title={r.symbol}>{name}</td>
                <td className="sub hide-sm">{pick(r.industryLabel, r.industryLabelEn)}</td>
                <td className="num">{fmtVal(r.value, T.locale)}</td>
                <td>{fmtVal(r.weight, T.locale, 1)}%</td>
                <td><Change v={r.chg.d1} chip /></td>
                <td><Change v={r.chg.m1} /></td>
                <td><Change v={r.chg.ytd} /></td>
                <td className="hide-sm"><Sparkline points={r.spark} width={70} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <FxLegend p={p} />
    </Panel>
  );
}
