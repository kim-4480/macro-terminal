'use client';

import { useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { marketOf } from '@/shared/markets';
import type { AiScore, JournalView, Position, Trade } from '@/shared/journal';
import type { HoldingRow, Point, PortfolioView } from '@/shared/types';
import { LineChart } from '@/components/charts/LineChart';
import { useJournalPost, useTR } from './journal-api';
import { CoachBox, DecisionCard, Outcomes, pct, tone } from './parts';
import type { CoachView } from '@/shared/journal';

export const RANGES = ['1m', '3m', '6m', '1y'] as const;

/** 잔고: 위쪽 합계 + 종목마다 한 줄(포트폴리오 "한 줄씩" 보기와 같은 구성: 정보 + 큰 주가 그래프) */
export function Balance({ p, j, range, setRange, onPick }: { p: PortfolioView; j: JournalView; range: string; setRange: (r: string) => void; onPick: (symbol: string) => void }) {
  const { T, money } = useLang();
  const R = useTR();
  const L = j.ledger;
  const pos = new Map(L.positions.map((x) => [x.symbol, x]));
  return (
    <div className="balance">
      <div className="sum">
        <div className="sum-main">
          <span>{R.sum.value}</span>
          <b>{money(L.valueBase)}</b>
          <span className={tone(L.unrealizedBase)}>{L.unrealizedBase == null ? '—' : `${L.unrealizedBase >= 0 ? '+' : ''}${money(L.unrealizedBase)}`} ({pct(L.unrealizedPct, 2)})</span>
        </div>
        <dl>
          <div><dt>{R.sum.cost}</dt><dd>{money(L.costBase)}</dd></div>
          <div><dt>{R.sum.realized}</dt><dd className={tone(L.realizedBase)}>{L.realizedBase >= 0 ? '+' : ''}{money(L.realizedBase)}</dd></div>
          <div><dt>{T.dayPnl}</dt><dd className={tone(p.dayPnlBase)}>{p.dayPnlBase == null ? '—' : `${p.dayPnlBase >= 0 ? '+' : ''}${money(p.dayPnlBase)}`}</dd></div>
        </dl>
        {L.since ? <p className="note">{R.sum.since} {new Date(L.since).toLocaleDateString(T.locale)}</p> : <p className="note">{R.sum.notStarted}</p>}
      </div>
      <div className="ranges" role="tablist">
        {RANGES.map((r) => <button key={r} role="tab" aria-selected={r === range} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r.toUpperCase()}</button>)}
      </div>
      {!p.rows.length ? <p className="note">{T.pe.empty}</p> : null}
      <div className="hold-rows">
        {p.rows.map((r) => <HoldingLine key={r.symbol} r={r} pos={pos.get(r.symbol.toUpperCase())} range={range} onPick={onPick} />)}
      </div>
    </div>
  );
}

function HoldingLine({ r, pos, range, onPick }: { r: HoldingRow; pos?: Position; range: string; onPick: (s: string) => void }) {
  const { T, pick, money } = useLang();
  const R = useTR();
  const { data: points } = useApi<Point[]>(`/api/series?${qs({ id: `yahoo:${r.symbol}`, range })}`, { refreshInterval: 0 });
  const m = marketOf(r.symbol);
  const first = points?.[0]?.[1];
  const last = points?.at(-1)?.[1];
  const rangeChg = first && last ? (last / first - 1) * 100 : null;
  return (
    <article className="hold">
      <button className="hold-info" onClick={() => onPick(r.symbol)}>
        <div className="hold-name">
          <b>{pick(r.name, r.nameEn)}</b>
          <span className="sym">{r.symbol}</span>
          {m ? <span className="mkt">{pick(m.ko, m.en)}</span> : null}
        </div>
        <div className="hold-px">
          <span className="px">{fmtVal(r.value, T.locale)}<small>{r.currency ?? ''}</small></span>
          <span className={`chip ${tone(r.chg?.d1)}`}>{pct(r.chg?.d1, 2)}</span>
        </div>
        <dl className="hold-stats">
          <div><dt>{R.th.qty}</dt><dd>{fmtVal(pos?.qty ?? r.qty ?? null, T.locale, (pos?.qty ?? 0) % 1 ? 2 : 0)}</dd></div>
          <div><dt>{R.th.avg}</dt><dd>{fmtVal(pos?.avgPrice ?? null, T.locale)}</dd></div>
          <div><dt>{R.th.pnl}</dt><dd className={tone(pos?.pnlBase)}>{pos?.pnlBase == null ? '—' : `${pos.pnlBase >= 0 ? '+' : ''}${money(pos.pnlBase)}`}</dd></div>
          <div><dt>{R.th.pct}</dt><dd className={tone(pos?.pnlPct)}>{pct(pos?.pnlPct, 2)}</dd></div>
          <div><dt>{range.toUpperCase()}</dt><dd className={tone(rangeChg)}>{pct(rangeChg, 2)}</dd></div>
          <div><dt>{T.th.weight}</dt><dd>{fmtVal(r.weight, T.locale, 1)}%</dd></div>
        </dl>
      </button>
      <div className="hold-chart">{points ? <LineChart points={points} height={170} trendLine /> : <div className="chart-ph" />}</div>
    </article>
  );
}

/** 체결 내역: 날짜·구분·종목·수량·체결가, 메모·감정·성과. 누르면 펼쳐서 판단 분석·사후 성과 */
export function Fills({ j, onMemo }: { j: JournalView; onMemo: (id: number) => void }) {
  const R = useTR();
  const [open, setOpen] = useState<number | null>(null);
  if (!j.trades.length) return <p className="note pad">{R.an.empty}</p>;
  return (
    <ul className="fills">
      {j.trades.map((t) => <FillRow key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} onMemo={() => onMemo(t.id)} />)}
    </ul>
  );
}

function FillRow({ t, open, onToggle, onMemo }: { t: Trade; open: boolean; onToggle: () => void; onMemo: () => void }) {
  const { T, lang, money } = useLang();
  const R = useTR();
  const post = useJournalPost();
  const [coach, setCoach] = useState<CoachView | 'loading' | null>(null);
  const o30 = t.outcomes.find((o) => o.horizon === 30) ?? t.outcomes.at(-1);
  const emos = t.decision?.data?.emotions.filter((e) => e.verified) ?? [];
  const initial = t.source === 'initial';
  const ask = async () => {
    setCoach('loading');
    try {
      setCoach(await post<CoachView>({ action: 'coach', symbol: t.symbol, side: t.side, memo: t.note?.memo ?? '', emotions: emos.map((e) => e.label), strategy: t.decision?.data?.strategy ?? null, lang }));
    } catch (err) {
      setCoach({ symbol: t.symbol, side: t.side, similar: [], markdown: null, error: (err as Error).message });
    }
  };
  return (
    <li className={`fill${open ? ' open' : ''}${initial ? ' initial' : ''}`}>
      <button className="fill-head" onClick={onToggle} aria-expanded={open}>
        <span className={`side ${t.side}`}>{initial ? '—' : t.side === 'buy' ? R.order.buy : R.order.sell}</span>
        <span className="fill-main">
          <b>{t.name}</b>
          <small>{t.date} · {fmtVal(t.qty, T.locale, t.qty % 1 ? 2 : 0)} × {fmtVal(t.price, T.locale)} {t.currency}</small>
        </span>
        <span className="fill-tags">
          {initial ? <small className="dim">{R.dec.initial}</small> : (
            <>
              {t.realizedPct != null ? <span className={tone(t.realizedPct)}>{pct(t.realizedPct)}</span> : null}
              {o30 ? <span className={`tag ${tone(o30.edge)}`}>{o30.horizon}D {pct(o30.edge)}</span> : null}
              {emos.slice(0, 2).map((e) => <span key={e.label} className="chip on">{R.emotion[e.label]}</span>)}
              {!t.note ? <span className="tag warn">{R.dec.noMemo}</span> : null}
            </>
          )}
        </span>
      </button>
      {open ? (
        <div className="fill-body">
          {!initial ? (
            <>
              {t.note ? (
                <div className="memo">
                  {t.note.memo ? <p>“{t.note.memo}”</p> : null}
                  <dl>
                    {t.note.plan ? <div><dt>{R.cap.plan}</dt><dd>{t.note.plan}</dd></div> : null}
                    {t.note.planFollowed ? <div><dt>{R.cap.followed}</dt><dd>{R.cap[t.note.planFollowed]}</dd></div> : null}
                    {t.note.target != null ? <div><dt>{R.cap.target}</dt><dd>{fmtVal(t.note.target, T.locale)}</dd></div> : null}
                    {t.note.stop != null ? <div><dt>{R.cap.stop}</dt><dd>{fmtVal(t.note.stop, T.locale)}</dd></div> : null}
                    {t.realizedBase != null ? <div><dt>{R.th.realized}</dt><dd className={tone(t.realizedBase)}>{money(t.realizedBase)} · {t.holdDays?.toFixed(0)}{lang === 'ko' ? '일 보유' : 'd held'}</dd></div> : null}
                  </dl>
                </div>
              ) : null}
              <button className="ghost-btn" onClick={onMemo}>{t.note ? R.dec.editMemo : R.dec.writeMemo}</button>
              <DecisionCard t={t} />
              <h4>{R.out.title}</h4>
              <Outcomes list={t.outcomes} />
              <p className="note">{R.out.edgeHint}</p>
              <button className="ghost-btn" disabled={coach === 'loading'} onClick={() => void ask()}>{coach === 'loading' ? R.order.checking : R.coach.title}</button>
              {coach && coach !== 'loading' ? <CoachBox view={coach} /> : null}
            </>
          ) : <p className="note">{R.dec.initial}</p>}
        </div>
      ) : null}
    </li>
  );
}

function ScoreCard({ title, s, unit }: { title: string; s: AiScore; unit: string }) {
  const R = useTR();
  return (
    <div className="score">
      <h5>{title}</h5>
      <b>{s.hitRate30 == null ? '—' : `${(s.hitRate30 * 100).toFixed(0)}%`}</b>
      <span>{R.an.hit}</span>
      <dl>
        <div><dt>{R.an.avgEdge}</dt><dd className={tone(s.avgEdge30)}>{pct(s.avgEdge30)}</dd></div>
        <div><dt>{unit}</dt><dd>{s.opinions}</dd></div>
      </dl>
    </div>
  );
}

/** 매매 분석: 내 판단 vs AI 의견 점수, 행동 패턴, 감정별 결과, AI 자기평가 */
export function Analysis({ j }: { j: JournalView }) {
  const { T } = useLang();
  const R = useTR();
  const P = j.profile;
  return (
    <div className="analysis">
      <div className="scores">
        <ScoreCard title={R.an.you} s={j.user} unit={R.an.decisions} />
        <ScoreCard title={R.an.ai} s={j.ai.score} unit={R.an.opinions} />
      </div>
      <p className="note">{R.an.scoreHint}</p>

      <h4>{R.an.patterns}</h4>
      <div className="patterns">
        {P.patterns.map((x) => {
          const L = R.pattern[x.id];
          return (
            <div key={x.id} className={`pattern${x.flagged ? ' flagged' : ''}${x.enough ? '' : ' thin'}`}>
              <div className="ph"><b>{L.name}</b><span className="tag">{!x.enough ? R.an.notEnough : x.flagged ? R.an.flagged : R.an.clear}</span></div>
              <p>{L.desc}</p>
              {x.metric != null && x.enough ? <p className="metric">{L.metric(x.metric)}</p> : null}
              {x.count ? <p className="note">{x.count}/{x.total} · {R.an.affected} <span className={tone(x.edgeHit)}>{pct(x.edgeHit)}</span> · {R.an.rest} <span className={tone(x.edgeRest)}>{pct(x.edgeRest)}</span></p> : null}
            </div>
          );
        })}
      </div>

      {P.emotions.length ? (
        <>
          <h4>{R.an.emotionsTitle}</h4>
          <table className="tbl">
            <tbody>{P.emotions.map((e) => <tr key={e.label}><th>{R.emotion[e.label]}</th><td>{e.count}</td><td className={tone(e.avgEdge30)}>{pct(e.avgEdge30)}</td></tr>)}</tbody>
          </table>
        </>
      ) : null}

      <h4>{R.an.aiTitle}</h4>
      {j.ai.opinions.length ? (
        <ul className="opinions">
          {j.ai.opinions.map((o) => {
            const last = o.outcomes.at(-1);
            return (
              <li key={o.id}>
                <div className="oh"><span className={`tag ${o.stance === 'up' ? 'up' : o.stance === 'down' ? 'down' : ''}`}>{R.stance[o.stance]}</span><b>{o.symbol}</b><small className="dim">{o.date} · {fmtVal(o.basePrice, T.locale)}</small>
                  {last ? <span className={`tag ${tone(last.edge)}`}>{last.horizon}D {pct(last.edge)}</span> : null}</div>
                <p>{o.text}</p>
              </li>
            );
          })}
        </ul>
      ) : <p className="note">{R.an.noOpinions}</p>}
    </div>
  );
}
