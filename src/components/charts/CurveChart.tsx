'use client';

import { niceTicks } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { useWidth } from '@/lib/useWidth';
import type { CurveLine, YieldCurve } from '@/shared/types';
import { Change } from '../ui';

const M = { l: 40, r: 12, t: 12, b: 24 };
const STYLE: Record<CurveLine['key'], { color: string; dash: string; width: number }> = {
  now: { color: 'var(--accent)', dash: '', width: 2 },
  m1: { color: '#9a9a9a', dash: '4 3', width: 1.2 },
  y1: { color: 'var(--blue)', dash: '2 3', width: 1.2 },
};

export function CurveChart({ curve }: { curve: YieldCurve }) {
  const { T } = useLang();
  const [ref, measured] = useWidth<HTMLDivElement>();
  const W = Math.max(300, measured - 16);
  const H = 230;
  const all = curve.lines.flatMap((l) => l.values).filter((v): v is number => v != null);
  const pad = (Math.max(...all) - Math.min(...all)) * 0.1 || 0.5;
  const y0 = Math.min(...all) - pad;
  const y1 = Math.max(...all) + pad;
  const n = curve.tenors.length;
  const X = (i: number) => M.l + (i / (n - 1)) * (W - M.l - M.r);
  const Y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * (H - M.t - M.b);

  const now = curve.lines.find((l) => l.key === 'now')?.values ?? [];
  const at = (t: string) => now[curve.tenors.indexOf(t)] ?? null;
  const diff = (a: string, b: string) => { const x = at(a); const y = at(b); return x != null && y != null ? x - y : null; };
  const spread = diff('10Y', '2Y');
  const shape = spread == null ? '—' : spread < 0 ? T.curve.inverted : spread < 0.25 ? T.curve.flat : T.curve.normal;

  return (
    <div ref={ref}>
      <div className="legend">
        {curve.lines.map((l) => <span key={l.key}><i style={{ background: STYLE[l.key].color }} />{T.curve[l.key]} ({l.date})</span>)}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="yield curve">
        {niceTicks(y0, y1).map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={Y(v)} y2={Y(v)} stroke="#1d1d1d" />
            <text x={M.l - 5} y={Y(v) + 3} textAnchor="end">{v.toFixed(2)}</text>
          </g>
        ))}
        {curve.tenors.map((t, i) => <text key={t} x={X(i)} y={H - 8} textAnchor="middle">{t}</text>)}
        {curve.lines.map((l) => {
          const s = STYLE[l.key];
          const d = l.values.map((v, i) => (v == null ? '' : `${i && l.values[i - 1] != null ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join('');
          return (
            <g key={l.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} />
              {l.key === 'now' && l.values.map((v, i) => v != null && (
                <circle key={i} cx={X(i)} cy={Y(v)} r={2.5} fill={s.color}><title>{`${curve.tenors[i]} ${v.toFixed(2)}%`}</title></circle>
              ))}
            </g>
          );
        })}
      </svg>
      <table className="t compact">
        <tbody>
          <tr><th>{T.th.tenor}</th>{curve.tenors.map((t) => <th key={t}>{t}</th>)}</tr>
          {curve.lines.map((l) => (
            <tr key={l.key}>
              <td className="sub">{T.curve[l.key]}</td>
              {l.values.map((v, i) => <td key={i} className={l.key === 'now' ? 'num' : 'dim'}>{v == null ? '—' : v.toFixed(2)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="summary">
        <div><span className="k">10Y-2Y</span><span className="v"><Change v={spread} mode="diff" /></span></div>
        <div><span className="k">10Y-3M</span><span className="v"><Change v={diff('10Y', '3M')} mode="diff" /></span></div>
        <div><span className="k">{T.curve.shape}</span><span className="v">{shape}</span></div>
      </div>
    </div>
  );
}
