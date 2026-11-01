'use client';

import type { ReactNode } from 'react';
import { useLang } from '@/lib/i18n';
import type { ChangeMode, Point, ViewCode } from '@/shared/types';

/** 변화율(+1.23%) 또는 차이(+0.12%p)를 색과 함께 */
export function Change({ v, mode = 'pct', chip = false }: { v: number | null | undefined; mode?: ChangeMode; chip?: boolean }) {
  if (v == null || !Number.isFinite(v)) return <span className={chip ? 'chip flat' : 'flat'}>—</span>;
  const cls = Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'up' : 'down';
  return <span className={chip ? `chip ${cls}` : cls}>{`${v > 0 ? '+' : ''}${v.toFixed(2)}${mode === 'diff' ? 'p' : '%'}`}</span>;
}

export function Sparkline({ points, width = 84, height = 20 }: { points?: Point[]; width?: number; height?: number }) {
  if (!points || points.length < 2) return null;
  const ys = points.map((p) => p[1]);
  const lo = Math.min(...ys);
  const span = Math.max(...ys) - lo || 1;
  const pts = ys.map((y, i) => `${((i / (ys.length - 1)) * width).toFixed(1)},${(height - 2 - ((y - lo) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const color = ys.at(-1)! >= ys[0]! ? 'var(--up)' : 'var(--down)';
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth={1.2} points={pts} />
    </svg>
  );
}

export function Panel({ code, children, className, meta }: {
  code: Exclude<ViewCode, 'HOME'>;
  children: ReactNode;
  className?: string;
  /** 제목 오른쪽 보조 정보(기준일, 출처 등) */
  meta?: ReactNode;
}) {
  const { T } = useLang();
  return (
    <section className="panel" data-fn={code}>
      <h2><b>{code}</b> <span>{T.panels[code]}</span>{meta ? <span className="meta-r">{meta}</span> : null}</h2>
      <div className={`body ${className ?? ''}`}>{children}</div>
    </section>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { T } = useLang();
  return <div className="empty err">{T.loadFail}: {error instanceof Error ? error.message : String(error)}</div>;
}

export function Loading({ label }: { label?: string }) {
  const { T } = useLang();
  return <div className="empty spin">{label ?? T.gp.loading}</div>;
}

// ---- 아주 작은 마크다운(제목, 글머리표, 굵게, 코드). HTML을 주입하지 않고 React 요소로 만든다. ----

function inline(text: string, links?: Map<string, string>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([SN]\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const ref = m[3];
    const href = ref ? links?.get(ref) : undefined;
    if (ref) out.push(href ? <a key={m.index} className="cite-link" href={href} target="_blank" rel="noopener noreferrer">[{ref} ↗]</a> : m[0]);
    else out.push(m[1] != null ? <strong key={m.index}>{inline(m[1], links)}</strong> : <code key={m.index}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** links: 근거 번호([S2]·[N3]) → 기사 주소. 주면 그 번호가 링크가 된다 */
export function Markdown({ source, className, links }: { source: string; className?: string; links?: Map<string, string> }) {
  const blocks: ReactNode[] = [];
  const open: { list: { kind: 'ul' | 'ol'; items: string[] } | null } = { list: null };
  const flush = () => {
    const { list } = open;
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, links)}</li>);
    blocks.push(list.kind === 'ul' ? <ul key={blocks.length}>{items}</ul> : <ol key={blocks.length}>{items}</ol>);
    open.list = null;
  };
  for (const line of source.split('\n')) {
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) {
      flush();
      const level = Math.min(h[1]!.length + 1, 4);
      const content = inline(h[2]!, links);
      blocks.push(level === 2 ? <h2 key={blocks.length}>{content}</h2> : level === 3 ? <h3 key={blocks.length}>{content}</h3> : <h4 key={blocks.length}>{content}</h4>);
    } else if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (open.list?.kind !== kind) { flush(); open.list = { kind, items: [] }; }
      open.list!.items.push((ul ?? ol)![1]!);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line, links)}</p>);
    }
  }
  flush();
  return <div className={className}>{blocks}</div>;
}
