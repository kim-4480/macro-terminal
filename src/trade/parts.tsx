'use client';

import { useState } from 'react';
import { fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { type CoachView, EMOTIONS, type Emotion, type Outcome, type PlanFollowed, STRATEGIES, type Strategy, type Trade } from '@/shared/journal';
import { Markdown } from '@/components/ui';
import { useJournalPost, useTR } from './journal-api';

export const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
export const tone = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'up' : 'down');

/** 점검 질문(근거 [T#]는 비슷한 과거 매매 번호) */
export function CoachBox({ view }: { view: CoachView }) {
  const R = useTR();
  return (
    <div className="coach">
      <h4>{R.coach.title}</h4>
      {view.markdown ? <Markdown source={view.markdown} className="md" /> : <p className="note warn">{view.error ?? R.coach.fail}</p>}
      <h5>{R.coach.similar}</h5>
      {view.similar.length ? (
        <ol>
          {view.similar.map((s, i) => (
            <li key={s.trade.id}>
              <b>T{i + 1}</b> {s.trade.date} {s.trade.side === 'buy' ? R.order.buy : R.order.sell} {s.trade.name}
              <span className="dim"> · {s.reasons.join(', ')}</span>
            </li>
          ))}
        </ol>
      ) : <p className="note">{R.coach.none}</p>}
    </div>
  );
}

/** 7·30·90일 성과 */
export function Outcomes({ list }: { list: Outcome[] }) {
  const R = useTR();
  if (!list.length) return <p className="note">{R.out.none}</p>;
  return (
    <table className="outs">
      <thead><tr><th /><th>{R.th.price}</th><th>{R.out.market}</th><th>{R.out.edge}</th></tr></thead>
      <tbody>
        {list.map((o) => (
          <tr key={o.horizon}>
            <th>{o.horizon}D <small>{o.final ? R.out.final : R.out.soFar}</small></th>
            <td className={tone(o.ret)}>{pct(o.ret)}</td>
            <td className={tone(o.benchRet)}>{pct(o.benchRet)}</td>
            <td className={`b ${tone(o.edge)}`}>{pct(o.edge)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 판단 분석(근거·감정 후보·출처·전략) + 확인/고치기 */
export function DecisionCard({ t }: { t: Trade }) {
  const { lang } = useLang();
  const R = useTR();
  const post = useJournalPost();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Emotion[]>([]);
  const [strategy, setStrategy] = useState<Strategy>('other');
  const d = t.decision;
  if (t.source === 'initial') return <p className="note">{R.dec.initial}</p>;
  // 메모는 있는데 분석이 없으면(모델이 꺼져 있었음) 다시 시작할 수 있게
  if (!d) return t.note ? <p className="note">{R.dec.waiting} <button className="text-btn" onClick={() => void post({ action: 'analyze', tradeId: t.id, lang }).catch(() => undefined)}>{R.dec.retry}</button></p> : null;
  if (d.status === 'pending') return <p className="note spin">{R.dec.pending}</p>;
  if (d.status === 'error' && !d.data) {
    return <p className="note warn">{R.dec.error}: {d.error} <button className="text-btn" onClick={() => void post({ action: 'analyze', tradeId: t.id, lang })}>{R.dec.retry}</button></p>;
  }
  const data = d.data;
  if (!data) return null;
  const startEdit = () => { setPicked(data.emotions.map((e) => e.label)); setStrategy(data.strategy); setEditing(true); };
  const save = async () => { await post({ action: 'confirm', tradeId: t.id, emotions: picked, strategy }); setEditing(false); };

  return (
    <div className="decision">
      <h4>{R.dec.title} {d.confirmed ? <span className="tag ok">✓ {R.dec.confirmed}</span> : null}</h4>
      {data.rationale.length ? <><h5>{R.dec.rationale}</h5><ul>{data.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul></> : null}
      <h5>{R.dec.emotions}</h5>
      {editing ? (
        <div className="chips edit">
          {EMOTIONS.map((e) => (
            <button key={e} className={`chip${picked.includes(e) ? ' on' : ''}`} aria-pressed={picked.includes(e)} onClick={() => setPicked((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]))}>{R.emotion[e]}</button>
          ))}
        </div>
      ) : data.emotions.length ? (
        <ul className="emos">
          {data.emotions.map((e) => (
            <li key={e.label}>
              <span className={`chip${e.verified ? ' on' : ' unv'}`}>{R.emotion[e.label]}</span>
              {e.evidence ? <q>{e.evidence}</q> : null}
              {!e.verified ? <small className="dim"> {R.dec.unverified}</small> : null}
            </li>
          ))}
        </ul>
      ) : <p className="note">{R.dec.none}</p>}
      <dl>
        <div><dt>{R.dec.strategy}</dt><dd>{editing ? (
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as Strategy)}>{STRATEGIES.map((s) => <option key={s} value={s}>{R.strategy[s]}</option>)}</select>
        ) : R.strategy[data.strategy]}</dd></div>
        <div><dt>{R.dec.horizon}</dt><dd>{R.horizon[data.horizon]}</dd></div>
        {data.sources.length ? <div><dt>{R.dec.sources}</dt><dd>{data.sources.map((s) => R.source[s]).join(', ')}</dd></div> : null}
      </dl>
      {d.chatExcerpts ? <p className="note">{R.dec.chatUsed.replace('{n}', String(d.chatExcerpts))}</p> : null}
      <div className="row-btns">
        {editing ? (
          <><button className="pri-btn" onClick={() => void save()}>{R.dec.confirm}</button><button className="text-btn" onClick={() => setEditing(false)}>×</button></>
        ) : (
          <>
            {!d.confirmed ? <button className="pri-btn" onClick={() => void post({ action: 'confirm', tradeId: t.id, emotions: data.emotions.filter((e) => e.verified).map((e) => e.label), strategy: data.strategy })}>{R.dec.confirm}</button> : null}
            <button className="ghost-btn" onClick={startEdit}>{R.dec.edit}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** 거래 직후 메모 시트(여러 건이면 차례로) */
export function CaptureSheet({ trade, rest, onNext }: { trade: Trade | null; rest: number; onNext: () => void }) {
  const { T, lang } = useLang();
  const R = useTR();
  const C = R.cap;
  const post = useJournalPost();
  const [memo, setMemo] = useState(trade?.note?.memo ?? '');
  const [plan, setPlan] = useState(trade?.note?.plan ?? '');
  const [followed, setFollowed] = useState<PlanFollowed | null>(trade?.note?.planFollowed ?? null);
  const [target, setTarget] = useState(trade?.note?.target != null ? String(trade.note.target) : '');
  const [stop, setStop] = useState(trade?.note?.stop != null ? String(trade.note.stop) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!trade) return null;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await post({ action: 'note', tradeId: trade.id, memo, plan, planFollowed: followed, target, stop, lang });
      onNext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onNext(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="cap-title">
        <div className="sheet-grip" />
        <h3 id="cap-title">{C.title}{rest > 0 ? <small> +{rest}</small> : null}</h3>
        <div className={`fill-line ${trade.side}`}>
          <b>{trade.side === 'buy' ? R.order.buy : R.order.sell}</b>
          <span>{trade.name}</span>
          <span className="dim">{fmtVal(trade.qty, T.locale, trade.qty % 1 ? 2 : 0)} × {fmtVal(trade.price, T.locale)} {trade.currency}</span>
        </div>
        <p className="note">{C.subtitle}</p>
        <label className="field"><span>{C.memo}</span><textarea rows={3} value={memo} placeholder={C.memoHint} onChange={(e) => setMemo(e.target.value)} /></label>
        <label className="field"><span>{C.plan}</span><input value={plan} placeholder={C.planHint} onChange={(e) => setPlan(e.target.value)} /></label>
        <div className="field">
          <span>{C.followed}</span>
          <div className="seg3">
            {(['yes', 'partial', 'no'] as const).map((v) => <button key={v} className={followed === v ? 'on' : ''} aria-pressed={followed === v} onClick={() => setFollowed(followed === v ? null : v)}>{C[v]}</button>)}
          </div>
        </div>
        {trade.side === 'buy' ? (
          <div className="two">
            <label className="field"><span>{C.target}</span><input type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
            <label className="field"><span>{C.stop}</span><input type="number" inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} /></label>
          </div>
        ) : null}
        {error ? <p className="note warn">{error}</p> : null}
        <div className="row-btns">
          <button className="pri-btn wide" disabled={saving || (!memo.trim() && !plan.trim() && !followed)} onClick={() => void save()}>{saving ? C.saving : C.save}</button>
          <button className="text-btn" onClick={onNext}>{C.skip}</button>
        </div>
        <p className="note center">{C.later}</p>
      </div>
    </div>
  );
}
