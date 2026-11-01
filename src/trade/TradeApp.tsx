'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { LangSwitch } from '@/components/LangSwitch';
import type { PortfolioView } from '@/shared/types';
import { useJournal, useTR } from './journal-api';
import { OrderPanel } from './OrderPanel';
import { CaptureSheet } from './parts';
import { Analysis, Balance, Fills, RANGES } from './views';

type Tab = 'balance' | 'order' | 'fills' | 'analysis';
const TABS: Tab[] = ['balance', 'order', 'fills', 'analysis'];

/**
 * 모의 매매 앱(/trade): 흰 바탕·검정 UI의 작은 창(스마트폰~태블릿).
 * 터미널과 같은 서버·데이터를 쓴다 — 여기서 주문하면 포트폴리오 수량이 바뀌고, 터미널에서 수량을 바꾸면 여기 매매로 잡힌다.
 */
export function TradeApp() {
  const { T, lang, setLang } = useLang();
  const R = useTR();
  const [tab, setTab] = useState<Tab>('balance');
  const [symbol, setSymbol] = useState('');
  const [range, setRange] = useState<string>('3m');
  const [queue, setQueue] = useState<number[]>([]);
  const { data: p, error: pErr } = useApi<PortfolioView>('/api/portfolio', { refreshInterval: 60_000, revalidateOnFocus: true });
  const { data: j, error: jErr } = useJournal();

  useEffect(() => {
    const t = storage.get('tradeTab');
    if (t && (TABS as string[]).includes(t)) setTab(t as Tab);
    const r = storage.get('tradeRange');
    if (r && (RANGES as readonly string[]).includes(r)) setRange(r);
  }, []);
  const go = (t: Tab) => { storage.set('tradeTab', t); setTab(t); window.scrollTo({ top: 0 }); };
  const pickRange = (r: string) => { storage.set('tradeRange', r); setRange(r); };

  const capture = queue.length && j ? j.trades.find((t) => t.id === queue[0]) ?? null : null;
  const err = pErr ?? jErr;

  return (
    <div className="tw">
      <header className="tw-top">
        <div className="brand"><b>MACRO</b><span>{lang === 'ko' ? '모의 매매' : 'Paper trading'}</span></div>
        <LangSwitch />
      </header>

      <main className="tw-main">
        {err && !(p && j) ? <p className="note warn pad">{T.loadFail}: {(err as Error).message}</p> : null}
        {!p || !j ? (!err ? <p className="note pad spin">…</p> : null) : (
          <>
            {tab === 'balance' ? <Balance p={p} j={j} range={range} setRange={pickRange} onPick={(s) => { setSymbol(s); go('order'); }} /> : null}
            {tab === 'order' ? <OrderPanel symbol={symbol} setSymbol={setSymbol} positions={j.ledger.positions} p={p} onFilled={(ids) => setQueue((q) => [...q, ...ids])} /> : null}
            {tab === 'fills' ? <Fills j={j} onMemo={(id) => setQueue((q) => [id, ...q.filter((x) => x !== id)])} /> : null}
            {tab === 'analysis' ? <Analysis j={j} /> : null}
          </>
        )}
      </main>

      <nav className="tw-tabs" aria-label="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} aria-current={t === tab ? 'page' : undefined} onClick={() => go(t)}>
            {t === 'order' ? R.order.title : R.tabs[t === 'balance' ? 'balance' : t === 'fills' ? 'fills' : 'analysis']}
            {t === 'fills' && j ? <i>{j.trades.filter((x) => x.source !== 'initial' && !x.note).length || ''}</i> : null}
          </button>
        ))}
      </nav>

      {capture ? <CaptureSheet key={capture.id} trade={capture} rest={queue.length - 1} onNext={() => setQueue((q) => q.slice(1))} /> : null}
    </div>
  );
}
