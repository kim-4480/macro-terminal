'use client';

import { useApi } from '@/lib/api';
import type { YieldCurve } from '@/shared/types';
import { CurveChart } from '../charts/CurveChart';
import { ErrorBox, Loading, Panel } from '../ui';

export function CurvePanel() {
  const { data, error } = useApi<YieldCurve>('/api/curve');
  return (
    <Panel code="GC" meta={data ? `FRED · ${data.date}` : 'FRED'}>
      {data ? <CurveChart curve={data} /> : error ? <ErrorBox error={error} /> : <Loading />}
    </Panel>
  );
}
