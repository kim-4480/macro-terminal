'use client';

import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { niceTicks, withUnit } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { useWidth } from '@/lib/useWidth';
import type { Point } from '@/shared/types';

const BASE = { r: 14, t: 12, b: 26 };

/** trendLine: 선 색도 기간 등락(초록·빨강)으로. 격자·말풍선 색은 --chart-grid / --chart-tip 로 바꿀 수 있다(밝은 화면용) */
export function LineChart({ points, unit, height = 380, trendLine = false }: { points: Point[]; unit?: string; height?: number; trendLine?: boolean }) {
  const { T } = useLang();
  const [ref, measured] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(320, measured - 16);
  const H = height;

  // 왼쪽 여백은 가장 긴 눈금 글자에 맞춘다(1,800,000 같은 큰 값이 잘리지 않게)
  const M = useMemo(() => {
    const ys = points.map((p) => p[1]);
    const longest = Math.max(...[Math.min(...ys), Math.max(...ys)].map((v) => withUnit(v, undefined, T.locale).length), 4);
    return { ...BASE, l: Math.round(longest * 6.6 + 14) };
  }, [points, T.locale]);

  const geo = useMemo(() => {
    const xs = points.map((p) => Date.parse(p[0]));
    const ys = points.map((p) => p[1]);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.06;
    y0 -= pad; y1 += pad;
    const x0 = xs[0] ?? 0;
    const x1 = xs.at(-1) ?? 1;
    const X = (t: number) => M.l + ((t - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
    const Y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * (H - M.t - M.b);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]!).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    return { xs, ys, x0, x1, y0, y1, X, Y, d };
  }, [points, W, H, M]);

  if (points.length < 2) return <div ref={ref} className="empty">{T.gp.short}</div>;

  const { xs, ys, x0, x1, y0, y1, X, Y, d } = geo;
  const color = ys.at(-1)! >= ys[0]! ? 'var(--up)' : 'var(--down)';

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const t = x0 + ((e.clientX - rect.left - M.l) / (W - M.l - M.r)) * (x1 - x0);
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid]! < t) lo = mid; else hi = mid; }
    setHover(Math.abs(xs[lo]! - t) < Math.abs(xs[hi]! - t) ? lo : hi);
  };

  const hoverBox = hover != null ? (() => {
    const px = X(xs[hover]!);
    const py = Y(ys[hover]!);
    const label = `${points[hover]![0]}  ${withUnit(ys[hover], unit, T.locale)}`;
    const tw = label.length * 6.4 + 12;
    const lx = Math.min(Math.max(px - tw / 2, M.l), W - M.r - tw);
    return (
      <g pointerEvents="none">
        <line x1={px} x2={px} y1={M.t} y2={H - M.b} stroke="var(--chart-cross, #555)" strokeDasharray="3 3" />
        <circle cx={px} cy={py} r={3.5} fill={trendLine ? color : 'var(--accent)'} />
        <rect x={lx} y={M.t} width={tw} height={20} fill="var(--chart-tip, #000)" stroke="var(--accent-dim)" />
        <text x={lx + 6} y={M.t + 14} style={{ fill: 'var(--chart-tip-text, #fff)' }}>{label}</text>
      </g>
    );
  })() : null;

  return (
    <div ref={ref}>
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="chart">
        {niceTicks(y0, y1).map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={Y(v)} y2={Y(v)} stroke="var(--chart-grid, #1d1d1d)" />
            <text x={M.l - 6} y={Y(v) + 3} textAnchor="end">{withUnit(v, undefined, T.locale)}</text>
          </g>
        ))}
        {(W < 560 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => {
          const i = Math.round(f * (points.length - 1));
          return <text key={f} x={X(xs[i]!)} y={H - 8} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{points[i]![0]}</text>;
        })}
        <path d={`${d}L${X(x1)},${H - M.b}L${X(x0)},${H - M.b}Z`} fill={color} opacity={0.07} />
        <path d={d} fill="none" stroke={trendLine ? color : 'var(--accent)'} strokeWidth={1.6} />
        {hoverBox}
        <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
    </div>
  );
}
