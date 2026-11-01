'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApi } from '@/lib/api';
import { withUnit } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { StripItem } from '@/shared/types';
import { useActions } from './actions';
import { Change } from './ui';

/** 띠가 움직이는 속도(px/초) — 읽으면서 따라갈 수 있게 천천히 */
const RUN_SPEED = 25;

/** 헤더 아래 주요 지표 띠(설정: settings.json 의 strip). 클릭하면 상세 차트. 화면보다 길면 옆으로 천천히 돈다. */
export function TickerStrip() {
  const { T, pick } = useLang();
  const { openChart } = useActions();
  const { data } = useApi<StripItem[]>('/api/strip', { refreshInterval: 60_000 });
  const box = useRef<HTMLDivElement>(null);
  const set = useRef<HTMLDivElement>(null);
  const [runWidth, setRunWidth] = useState(0);
  const count = data?.length ?? 0;

  useEffect(() => {
    const b = box.current;
    const s = set.current;
    if (!b || !s) return;
    // 움직임 줄이기를 켠 사용자는 돌리지 않고 손으로 넘긴다(.strip 기본 가로 스크롤)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const measure = () => setRunWidth(!still.matches && s.offsetWidth > b.clientWidth + 1 ? s.offsetWidth : 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(s);
    still.addEventListener('change', measure);
    return () => { ro.disconnect(); still.removeEventListener('change', measure); };
  }, [count]);

  if (!data?.length) return <div className="strip" aria-hidden="true" style={{ minHeight: 52 }} />;

  const items = (copy: boolean) => data.map((s) => {
    const label = pick(s.label, s.labelEn);
    return (
      <button key={s.id} role={copy ? undefined : 'listitem'} tabIndex={copy ? -1 : undefined} className="item" title={s.error ?? s.id} onClick={() => openChart({ id: s.id, title: label, unit: s.unit })}>
        <span className="lbl">{label}</span>
        <span className="px">{s.error ? '—' : withUnit(s.value, s.unit, T.locale)}</span>
        {s.chg ? <Change v={s.chg.d1} mode={s.mode} /> : <span className="flat">—</span>}
      </button>
    );
  });

  return (
    <div ref={box} className={`strip${runWidth ? ' run' : ''}`} style={runWidth ? ({ '--strip-time': `${runWidth / RUN_SPEED}s` } as CSSProperties) : undefined}>
      <div ref={set} className="strip-set" role="list">{items(false)}</div>
      {/* 끊김 없이 이어지도록 같은 줄을 한 번 더(읽기 도구·탭 이동에서는 뺀다) */}
      {runWidth ? <div className="strip-set" aria-hidden="true">{items(true)}</div> : null}
    </div>
  );
}
