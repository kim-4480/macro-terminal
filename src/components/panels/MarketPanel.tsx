'use client';

import { useApi } from '@/lib/api';
import { fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { MarketRow } from '@/shared/types';
import { useActions } from '../actions';
import { Change, ErrorBox, Loading, Panel, Sparkline } from '../ui';

export function MarketPanel() {
  const { T, pick } = useLang();
  const { openChart } = useActions();
  const { data, error } = useApi<MarketRow[]>('/api/markets');

  let body;
  if (!data) body = error ? <ErrorBox error={error} /> : <Loading />;
  else {
    body = (
      <table className="t">
        <thead>
          <tr>
            <th>{T.th.market}</th><th>{T.th.last}</th><th>1D</th><th>1M</th><th>YTD</th>
            <th className="hide-sm">1Y</th><th className="hide-sm">{T.th.trend}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => {
            const label = pick(r.label, r.labelEn);
            if (r.error || !r.chg) {
              return <tr key={r.symbol}><td className="name">{label}</td><td colSpan={6} className="err">{r.error}</td></tr>;
            }
            return (
              <tr key={r.symbol} className="click" onClick={() => openChart({ id: `yahoo:${r.symbol}`, title: `${label} (${r.symbol})` })}>
                <td className="name" title={r.symbol}>{label}</td>
                <td className="num">{fmtVal(r.value, T.locale)}</td>
                <td><Change v={r.chg.d1} chip /></td>
                <td><Change v={r.chg.m1} /></td>
                <td><Change v={r.chg.ytd} /></td>
                <td className="hide-sm"><Change v={r.chg.y1} /></td>
                <td className="hide-sm"><Sparkline points={r.spark} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return <Panel code="MKT" meta="YAHOO">{body}</Panel>;
}
