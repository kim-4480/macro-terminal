'use client';

import { useEffect, useRef, useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import type { ChartTarget, Point } from '@/shared/types';
import { isCompanySymbol } from '@/shared/symbols';
import { CompanyProfile } from './CompanyProfile';
import { LineChart } from './charts/LineChart';
import { Change, ErrorBox, Loading } from './ui';

const RANGES = ['3m', '6m', '1y', '3y', '5y', '10y'] as const;

export function ChartModal({ target, onClose }: { target: ChartTarget; onClose: () => void }) {
  const { T, lang } = useLang();
  const [range, setRange] = useState<string>(() => storage.get('gpRange') ?? '1y');
  const { data: points, error } = useApi<Point[]>(`/api/series?${qs({ id: target.id, range })}`, { refreshInterval: 0 });
  const symbol = target.id.startsWith('yahoo:') ? target.id.slice(6) : null;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);

  const rate = target.unit === '%' || target.unit === '%p';
  const first = points?.[0]?.[1];
  const last = points?.at(-1)?.[1];
  const change = first != null && last != null ? (rate ? last - first : (last / first - 1) * 100) : null;

  return (
    <div className="gp" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gp-box" role="dialog" aria-modal="true" aria-labelledby="gp-title">
        <div className="gp-head">
          <h2 id="gp-title">
            <b>GP</b>{target.title} <span className="dim">{range.toUpperCase()}</span>{' '}
            {points && points.length > 1 ? <Change v={change} mode={rate ? 'diff' : 'pct'} /> : null}
          </h2>
          <div className="ranges">
            {RANGES.map((r) => (
              <button key={r} className={r === range ? 'active' : ''} onClick={() => { storage.set('gpRange', r); setRange(r); }}>{r.toUpperCase()}</button>
            ))}
          </div>
          <button ref={closeRef} className="x" onClick={onClose} aria-label={T.gp.close}>✕</button>
        </div>
        <div className="gp-chart">
          {points ? <LineChart points={points} unit={target.unit} /> : error ? <ErrorBox error={error} /> : <Loading />}
        </div>
        {isCompanySymbol(symbol) ? <CompanyProfile key={`${symbol}:${lang}`} symbol={symbol} /> : null}
      </div>
    </div>
  );
}
