'use client';

import { Fragment, useState, type FormEvent } from 'react';
import { useApi } from '@/lib/api';
import { withUnit } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { MacroRow } from '@/shared/types';
import { useActions } from '../actions';
import { Change, ErrorBox, Loading, Panel, Sparkline } from '../ui';

export function EcoPanel() {
  const { T, pick } = useLang();
  const { openChart, openChat } = useActions();
  const [request, setRequest] = useState('');
  const { data, error } = useApi<MacroRow[]>('/api/macro');

  let body;
  if (!data) body = error ? <ErrorBox error={error} /> : <Loading />;
  else {
    body = (
      <table className="t">
        <thead>
          <tr>
            <th>{T.th.indicator}</th><th>{T.th.value}</th><th className="hide-sm">{T.th.asOf}</th>
            <th>{T.th.prior}</th><th>1M</th><th>1Y</th><th className="hide-sm">{T.th.trend}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => {
            const label = pick(r.label, r.labelEn);
            const groupRow = r.group !== data[i - 1]?.group
              ? <tr className="group"><td colSpan={7}>{T.groups[r.group] ?? pick(r.group, r.groupEn)}</td></tr>
              : null;
            if (r.error || !r.chg) {
              return (
                <Fragment key={r.id}>
                  {groupRow}
                  <tr>
                    <td className="name">{label}</td>
                    <td colSpan={6} style={{ textAlign: 'left' }}>
                      {r.keyRequired ? <span className="dim">{T.ecosKey}</span> : <span className="err">{r.error}</span>}
                    </td>
                  </tr>
                </Fragment>
              );
            }
            return (
              <Fragment key={r.id}>
                {groupRow}
                <tr className="click" onClick={() => openChart({ id: r.id, title: label, unit: r.unit })}>
                  <td className="name" title={r.id}>{label}</td>
                  <td className="num">{withUnit(r.value, r.unit, T.locale)}</td>
                  <td className="sub hide-sm">{r.date?.slice(2)}</td>
                  <td><Change v={r.chg.d1} mode={r.mode} chip /></td>
                  <td><Change v={r.chg.m1} mode={r.mode} /></td>
                  <td><Change v={r.chg.y1} mode={r.mode} /></td>
                  <td className="hide-sm"><Sparkline points={r.spark} /></td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  }
  const ask = (e: FormEvent) => {
    e.preventDefault();
    if (!request.trim()) return;
    openChat(T.eco.ask(request.trim()));
    setRequest('');
  };
  return (
    <Panel code="ECO" meta="FRED · IMF · AGENT">
      {body}
      <form className="eco-add" onSubmit={ask}>
        <input value={request} placeholder={T.eco.addPlaceholder} aria-label={T.eco.addPlaceholder} onChange={(e) => setRequest(e.target.value)} />
        <button type="submit" className="btn ghost" disabled={!request.trim()}>{T.eco.add}</button>
      </form>
    </Panel>
  );
}
