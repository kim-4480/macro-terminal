'use client';

import { useEffect, useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { fmtVal } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { CoachView, Position, TradeSide } from '@/shared/journal';
import type { Point, PortfolioView } from '@/shared/types';
import { CoachBox } from './parts';
import { useJournalPost, useTR } from './journal-api';

/**
 * 주문(모의): 증권사 앱처럼 매수(빨강)·매도(파랑) 탭, 시장가, 수량(±·비율), 주문금액.
 * 체결하면 포트폴리오 수량이 바뀌고(터미널에도 반영) → 거래 메모 시트가 뜬다.
 */
export function OrderPanel({ symbol, setSymbol, positions, p, onFilled }: {
  symbol: string;
  setSymbol: (s: string) => void;
  positions: Position[];
  p: PortfolioView;
  onFilled: (tradeIds: number[]) => void;
}) {
  const { T, lang, pick, money } = useLang();
  const R = useTR();
  const J = R.order;
  const post = useJournalPost();
  const [side, setSide] = useState<TradeSide>('buy');
  const [qty, setQty] = useState('1');
  const [industry, setIndustry] = useState('');
  const [input, setInput] = useState(symbol);
  const [stage, setStage] = useState<'idle' | 'confirm' | 'working'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [coach, setCoach] = useState<CoachView | 'loading' | null>(null);

  useEffect(() => { setInput(symbol); setStage('idle'); setError(null); setCoach(null); setDone(false); }, [symbol]);

  const sym = symbol.trim().toUpperCase();
  const held = positions.find((x) => x.symbol === sym);
  const row = p.rows.find((r) => r.symbol.toUpperCase() === sym);
  // 포트폴리오에 없는 종목은 최근 시세를 따로 받는다
  const { data: pts } = useApi<Point[]>(sym && !row ? `/api/series?${qs({ id: `yahoo:${sym}`, range: '1m' })}` : null, { refreshInterval: 0 });
  const price = row?.value ?? held?.last ?? pts?.at(-1)?.[1] ?? null;
  const currency = row?.currency ?? held?.currency ?? null;
  const fx = currency ? (p.fx[currency] ?? null) : null;
  const n = Number(qty);
  const qtyOk = Number.isFinite(n) && n > 0 && (side === 'buy' || (!!held && n <= held.qty + 1e-9));
  const isNew = side === 'buy' && !row;
  const amount = price != null && qtyOk ? price * n : null;
  const canSubmit = !!sym && qtyOk && price != null && (!isNew || !!industry) && stage !== 'working';

  const submit = async () => {
    if (stage !== 'confirm') { setStage('confirm'); return; }
    setStage('working');
    setError(null);
    try {
      const out = await post<{ trades: number[] }>({ action: 'order', symbol: sym, side, qty: n, industry: isNew ? industry : null, lang });
      setDone(true);
      setStage('idle');
      if (out.trades.length) onFilled(out.trades);
    } catch (err) {
      setError((err as Error).message);
      setStage('idle');
    }
  };

  const check = async () => {
    setCoach('loading');
    try {
      setCoach(await post<CoachView>({ action: 'coach', symbol: sym, side, lang }));
    } catch (err) {
      setCoach({ symbol: sym, side, similar: [], markdown: null, error: (err as Error).message });
    }
  };

  const stepQty = (d: number) => { setStage('idle'); setQty((q) => String(Math.max(0, (Number(q) || 0) + d))); };

  return (
    <section className={`order ${side}`}>
      <div className="order-tabs" role="tablist">
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={side === s} className={`${s}${side === s ? ' active' : ''}`} onClick={() => { setSide(s); setStage('idle'); setDone(false); }}>
            {s === 'buy' ? J.buy : J.sell}
          </button>
        ))}
      </div>

      <label className="field">
        <span>{J.symbol}</span>
        <input
          value={input}
          placeholder={J.symbolHint}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => setSymbol(input.trim().toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') setSymbol(input.trim().toUpperCase()); }}
          spellCheck={false}
          autoCapitalize="characters"
        />
      </label>

      {sym ? (
        <div className="order-quote">
          <div className="nm"><b>{row ? pick(row.name, row.nameEn) : held?.name ?? sym}</b><span className="sym">{sym}</span></div>
          <div className="px">
            {price == null ? '—' : fmtVal(price, T.locale)}<small>{currency ?? ''}</small>
            {row?.chg?.d1 != null ? <span className={row.chg.d1 >= 0 ? 'up' : 'down'}>{row.chg.d1 >= 0 ? '+' : ''}{row.chg.d1.toFixed(2)}%</span> : null}
          </div>
        </div>
      ) : null}

      <div className="field">
        <span>{J.price}</span>
        <div className="static">{J.market}</div>
      </div>

      <div className="field">
        <span>{J.qty}{held ? <em> · {J.held} {fmtVal(held.qty, T.locale, held.qty % 1 ? 2 : 0)}</em> : null}</span>
        <div className="qty">
          <button type="button" onClick={() => stepQty(-1)} aria-label="-1">−</button>
          <input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => { setQty(e.target.value); setStage('idle'); }} />
          <button type="button" onClick={() => stepQty(1)} aria-label="+1">+</button>
        </div>
        {side === 'sell' && held ? (
          <div className="pcts">
            {[10, 25, 50, 100].map((pct) => (
              <button key={pct} type="button" onClick={() => { setStage('idle'); setQty(String(pct === 100 ? held.qty : Math.max(1, Math.floor((held.qty * pct) / 100)))); }}>{pct}%</button>
            ))}
          </div>
        ) : null}
      </div>

      {isNew && sym ? (
        <label className="field">
          <span>{J.newSymbol}</span>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="" disabled>{J.pickIndustry}</option>
            {p.industries.map((i) => <option key={i.id} value={i.id}>{pick(i.label, i.labelEn)}</option>)}
          </select>
        </label>
      ) : null}
      {side === 'sell' && sym && !held ? <p className="note warn">{J.noHolding}</p> : null}

      <div className="order-amount">
        <span>{J.amount}</span>
        <b>{amount == null ? '—' : `${fmtVal(amount, T.locale)} ${currency ?? ''}`}</b>
        {amount != null && fx && currency !== p.baseCurrency ? <em>≈ {money(amount * fx)}</em> : null}
      </div>

      <button className={`submit ${side}${stage === 'confirm' ? ' confirm' : ''}`} disabled={!canSubmit} onClick={() => void submit()}>
        {stage === 'working' ? J.working : stage === 'confirm' ? J.confirm : side === 'buy' ? J.submitBuy : J.submitSell}
      </button>
      {stage === 'confirm' ? <button className="text-btn" onClick={() => setStage('idle')}>{T.pe.cancel}</button> : null}
      {done ? <p className="note ok">✓ {J.done}</p> : null}
      {error ? <p className="note warn">{error}</p> : null}
      <p className="note">{J.mock}</p>

      <button className="ghost-btn" disabled={!sym || coach === 'loading'} onClick={() => void check()}>
        {coach === 'loading' ? J.checking : J.check}
      </button>
      {coach && coach !== 'loading' ? <CoachBox view={coach} /> : null}
    </section>
  );
}
