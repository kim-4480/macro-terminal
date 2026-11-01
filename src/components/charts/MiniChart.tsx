'use client';

import { useId } from 'react';
import { useWidth } from '@/lib/useWidth';
import type { Point } from '@/shared/types';

/** 카드용 작은 면적 차트(축 없음, 폭에 맞춰 늘어남). 오르면 초록, 내리면 빨강. */
export function MiniChart({ points, height = 110 }: { points?: Point[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(300);
  const gid = useId().replace(/:/g, '');
  if (!points || points.length < 2) return <div ref={ref} className="mini-chart empty-chart" style={{ height }} />;

  const W = Math.max(120, width);
  const H = height;
  const ys = points.map((p) => p[1]);
  const lo = Math.min(...ys);
  const span = Math.max(...ys) - lo || 1;
  const X = (i: number) => (i / (ys.length - 1)) * W;
  const Y = (v: number) => 4 + (1 - (v - lo) / span) * (H - 8);
  const line = ys.map((y, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join('');
  const up = ys.at(-1)! >= ys[0]!;
  const color = up ? 'var(--up)' : 'var(--down)';

  return (
    <div ref={ref} className="mini-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.8} />
        <circle cx={X(ys.length - 1)} cy={Y(ys.at(-1)!)} r={3} fill={color} />
      </svg>
    </div>
  );
}
