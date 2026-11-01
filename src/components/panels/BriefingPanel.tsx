'use client';

import { useEffect, useState } from 'react';
import { fetchJson, qs, useApi } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { BRIEFING_KINDS, type BriefingKind, type BriefingResponse } from '@/shared/types';
import { ErrorBox, Loading, Markdown, Panel } from '../ui';

/** 파일 이름 → 표시: 2026-10-27_1530.md → 2026-10-27 15:30 / 2026-W44_2026-10-27_1530.md → 2026-W44 · 10-27 15:30 */
function fileLabel(f: string): string {
  const base = f.replace(/(_en)?\.md$/, '');
  const periodic = base.match(/^(\d{4}-W\d{2}|\d{4}-\d{2})_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$/);
  if (periodic) return `${periodic[1]} · ${periodic[2]!.slice(5)} ${periodic[3]}:${periodic[4]}`;
  return base.replace('_', ' ').replace(/(\d{2})(\d{2})$/, '$1:$2');
}

const readKind = (): BriefingKind => {
  const v = storage.get('briefKind') as BriefingKind | null;
  return v && BRIEFING_KINDS.includes(v) ? v : 'daily';
};

export function BriefingPanel() {
  const { T, lang } = useLang();
  const [kind, setKind] = useState<BriefingKind>('daily');
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => { setKind(readKind()); }, []);

  const { data: b, error, mutate } = useApi<BriefingResponse>(`/api/briefing?${qs({ kind, lang, file })}`, {
    refreshInterval: (latest) => (latest?.job?.state === 'running' || latest?.job?.state === 'waiting-network' ? 5000 : 5 * 60e3),
  });
  const [busy, setBusy] = useState(false);
  const state = b?.kind === kind ? b.job?.state : undefined;
  const running = state === 'running' || state === 'waiting-network';
  const kindName = T.brief.kinds[kind];

  const choose = (k: BriefingKind) => {
    storage.set('briefKind', k);
    setFile(null);
    setKind(k);
  };

  const generate = async () => {
    setBusy(true);
    try {
      await fetchJson(`/api/briefing?${qs({ kind, lang })}`, { method: 'POST' });
      setFile(null);
      await mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs = (
    <div className="seg" role="tablist" aria-label={T.panels.BRIEF}>
      {BRIEFING_KINDS.map((k) => (
        <button key={k} role="tab" aria-selected={k === kind} className={k === kind ? 'active' : ''} onClick={() => choose(k)}>{T.brief.kinds[k]}</button>
      ))}
    </div>
  );

  if (!b) return <Panel code="BRIEF" meta={tabs}>{error ? <ErrorBox error={error} /> : <Loading />}</Panel>;

  return (
    <Panel code="BRIEF" meta={tabs}>
      <div className="toolbar">
        <button className="btn" onClick={generate} disabled={running || busy}>{T.brief.generateKind[kind]}</button>
        {b.files.length ? (
          <select aria-label={T.brief.past} value={b.file ?? ''} onChange={(e) => setFile(e.target.value)}>
            {b.files.map((f) => <option key={f} value={f}>{fileLabel(f)}</option>)}
          </select>
        ) : null}
        {state === 'running' ? <span className="spin dim">{T.brief.writingKind(kindName)}</span> : null}
        {state === 'waiting-network' ? <span className="dim">{T.brief.waitingNet}</span> : null}
        {state === 'error' ? <span className="err">{b.job?.error}</span> : null}
      </div>
      {b.markdown && b.kind === kind ? <Markdown className="md" source={b.markdown} /> : <div className="empty">{T.brief.noneKind(kindName)}</div>}
    </Panel>
  );
}
