'use client';

import { useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { fetchJson, qs } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import type { PortfolioConfig, SearchResponse, SearchResult } from '@/shared/types';
import { ErrorBox, Loading } from './ui';

type Holding = PortfolioConfig['holdings'][number] & { key: string };
type Industry = PortfolioConfig['industries'][number] & {
  key: string;
  kwEnText: string;
  kwKoText: string;
  /** 새로 만든 업계: 자동 채우기 때 id 를 영어 이름으로 다시 만든다 */
  autoId?: boolean;
};

interface Suggestion { labelEn: string; benchmark: string | null; en: string[]; ko: string[] }

let seq = 0;
const newKey = () => `k${++seq}`;
const splitKw = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const hasHangul = (s: string) => /[가-힣]/.test(s);

/** 업계 id: 영어 이름에서 만들고, 겹치면 번호를 붙인다 */
function makeId(label: string, labelEn: string | undefined, taken: Set<string>): string {
  const base = (labelEn || label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'industry';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

export interface PortfolioPrefill {
  symbol: string;
  name: string;
  nameEn: string;
}

/** 포트폴리오 편집: 보유 종목(티커·이름·업계·수량)과 업계(이름·지표·뉴스 검색어). 저장하면 config/portfolio.json 에 씀. */
export function PortfolioEditor({ onClose, prefill }: { onClose: () => void; prefill: PortfolioPrefill | null }) {
  const { T } = useLang();
  const { mutate } = useSWRConfig();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [filling, setFilling] = useState<Record<string, 'run' | 'fail'>>({});

  useEffect(() => {
    fetchJson<PortfolioConfig>('/api/portfolio/config').then((p) => {
      const inds = p.industries.map((i) => ({ ...i, key: newKey(), kwEnText: i.en.join(', '), kwKoText: i.ko.join(', ') }));
      const hs = p.holdings.map((h) => ({ ...h, key: newKey() }));
      if (prefill && !hs.some((h) => h.symbol === prefill.symbol)) {
        hs.push({ key: newKey(), symbol: prefill.symbol, name: prefill.name, nameEn: prefill.nameEn, industry: inds[0]?.id ?? '', qty: undefined });
        setDirty(true);
      }
      setIndustries(inds);
      setHoldings(hs);
      setNote(p.note);
    }).catch(setError);
  }, [prefill]);

  const close = () => { if (!dirty || confirm(T.pe.confirmLeave)) onClose(); };
  const editH = (key: string, patch: Partial<Holding>) => { setDirty(true); setHoldings((hs) => hs!.map((h) => (h.key === key ? { ...h, ...patch } : h))); };
  const editI = (key: string, patch: Partial<Industry>) => { setDirty(true); setIndustries((is) => is.map((i) => (i.key === key ? { ...i, ...patch } : i))); };

  const addIndustry = () => {
    setDirty(true);
    setIndustries((is) => {
      const id = makeId('industry', `industry-${is.length + 1}`, new Set(is.map((i) => i.id)));
      return [...is, { key: newKey(), id, label: '', labelEn: '', benchmark: '', en: [], ko: [], kwEnText: '', kwKoText: '', autoId: true }];
    });
  };

  /**
   * 업계 이름 → 에이전트가 영어 이름·대표 지표·뉴스 검색어를 채운다.
   * force=false(이름 칸을 벗어날 때)는 다른 칸이 모두 비어 있을 때만, force=true(버튼)는 덮어쓴다.
   */
  const autoFill = async (ind: Industry, force: boolean) => {
    const label = ind.label.trim();
    if (!label) return;
    if (!force && (ind.labelEn || ind.benchmark || ind.kwEnText || ind.kwKoText)) return;
    setFilling((f) => ({ ...f, [ind.key]: 'run' }));
    try {
      const s = await fetchJson<Suggestion>('/api/portfolio/suggest-industry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' },
        body: JSON.stringify({ label }),
      });
      setDirty(true);
      setIndustries((is) => {
        const cur = is.find((x) => x.key === ind.key);
        if (!cur) return is;
        // 새 업계면 id 를 영어 이름으로(종목이 이미 이 업계를 골랐으면 같이 바꾼다)
        const newId = cur.autoId ? makeId(label, s.labelEn, new Set(is.filter((x) => x.key !== ind.key).map((x) => x.id))) : cur.id;
        if (newId !== cur.id) setHoldings((hs) => hs?.map((h) => (h.industry === cur.id ? { ...h, industry: newId } : h)) ?? hs);
        return is.map((x) => (x.key !== ind.key ? x : {
          ...x,
          id: newId,
          labelEn: s.labelEn,
          benchmark: s.benchmark ?? (force ? '' : x.benchmark),
          kwEnText: s.en.join(', '),
          kwKoText: s.ko.join(', '),
        }));
      });
      setFilling((f) => { const { [ind.key]: _, ...rest } = f; return rest; });
    } catch {
      setFilling((f) => ({ ...f, [ind.key]: 'fail' }));
    }
  };

  const save = async () => {
    if (!holdings) return;
    setSaving(true);
    setError(null);
    try {
      const body: PortfolioConfig = {
        example: false,
        ...(note ? { note } : {}),
        industries: industries.map(({ id, label, labelEn, benchmark, kwEnText, kwKoText }) => ({
          id, label: label.trim() || id, ...(labelEn?.trim() ? { labelEn: labelEn.trim() } : {}),
          ...(benchmark?.trim() ? { benchmark: benchmark.trim() } : {}),
          en: splitKw(kwEnText), ko: splitKw(kwKoText),
        })),
        holdings: holdings.filter((h) => h.symbol.trim()).map(({ symbol, name, nameEn, industry, qty }) => ({
          symbol: symbol.trim().toUpperCase(), industry,
          ...(name?.trim() ? { name: name.trim() } : {}), ...(nameEn?.trim() ? { nameEn: nameEn.trim() } : {}),
          ...(qty && qty > 0 ? { qty } : {}),
        })),
      };
      await fetchJson('/api/portfolio/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' },
        body: JSON.stringify(body),
      });
      // 포트폴리오에 걸린 모든 화면(성과·뉴스 주제·지도·브리핑)을 새로 받는다
      await mutate(() => true);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gp" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="gp-box pe" role="dialog" aria-modal="true" aria-labelledby="pe-title">
        <div className="gp-head">
          <h2 id="pe-title"><b>PORT</b>{T.pe.title}</h2>
          <button className="btn ghost" onClick={close}>{T.pe.cancel}</button>
          <button className="btn" onClick={() => void save()} disabled={saving || !holdings}>{saving ? T.pe.saving : T.pe.save}</button>
        </div>
        {error ? <ErrorBox error={error} /> : null}
        {!holdings ? <Loading /> : (
          <div className="pe-body">
            <section>
              <div className="co-section-head"><b>{T.pe.holdings}</b><span className="dim">{holdings.length}</span></div>
              <p className="legend">{T.pe.qtyHint}</p>
              <table className="t pe-table">
                <thead>
                  <tr><th>{T.pe.symbol}</th><th>{T.pe.name}</th><th>{T.pe.nameEn}</th><th>{T.pe.industry}</th><th>{T.pe.qty}</th><th /></tr>
                </thead>
                <tbody>
                  {holdings.length ? holdings.map((h) => (
                    <tr key={h.key}>
                      <td><SymbolInput value={h.symbol} onChange={(symbol) => editH(h.key, { symbol })} onPick={(r) => editH(h.key, {
                        symbol: r.symbol!, ...(hasHangul(r.title) ? { name: r.title } : { nameEn: r.title }),
                      })} /></td>
                      <td><input value={h.name ?? ''} onChange={(e) => editH(h.key, { name: e.target.value })} /></td>
                      <td><input value={h.nameEn ?? ''} onChange={(e) => editH(h.key, { nameEn: e.target.value })} /></td>
                      <td>
                        <select value={h.industry} onChange={(e) => editH(h.key, { industry: e.target.value })}>
                          {!industries.some((i) => i.id === h.industry) ? <option value="">—</option> : null}
                          {industries.map((i) => <option key={i.key} value={i.id}>{i.label || i.id}</option>)}
                        </select>
                      </td>
                      <td><input type="number" min="0" step="any" value={h.qty ?? ''} onChange={(e) => editH(h.key, { qty: e.target.value === '' ? undefined : Number(e.target.value) })} className="qty" /></td>
                      <td><button className="link danger" onClick={() => { setDirty(true); setHoldings((hs) => hs!.filter((x) => x.key !== h.key)); }}>{T.pe.remove}</button></td>
                    </tr>
                  )) : <tr><td colSpan={6} className="dim">{T.pe.empty}</td></tr>}
                </tbody>
              </table>
              <button className="btn ghost" onClick={() => { setDirty(true); setHoldings((hs) => [...hs!, { key: newKey(), symbol: '', industry: industries[0]?.id ?? '' }]); }}>{T.pe.add}</button>
            </section>

            <section>
              <div className="co-section-head"><b>{T.pe.industries}</b><span className="dim">{industries.length}</span></div>
              <p className="legend">{T.pe.industryHint}</p>
              <div className="pe-industries">
                {industries.map((i) => {
                  const used = holdings.some((h) => h.industry === i.id);
                  return (
                    <div key={i.key} className="pe-card">
                      <label>{T.pe.label}<input value={i.label} onChange={(e) => editI(i.key, { label: e.target.value })} onBlur={() => void autoFill(i, false)} placeholder={T.pe.labelHint} /></label>
                      <label>{T.pe.labelEn}<input value={i.labelEn ?? ''} onChange={(e) => editI(i.key, { labelEn: e.target.value })} /></label>
                      <label>{T.pe.benchmark}<input value={i.benchmark ?? ''} onChange={(e) => editI(i.key, { benchmark: e.target.value })} placeholder="^SOX" /></label>
                      <label className="wide">{T.pe.kwEn}<input value={i.kwEnText} onChange={(e) => editI(i.key, { kwEnText: e.target.value })} /></label>
                      <label className="wide">{T.pe.kwKo}<input value={i.kwKoText} onChange={(e) => editI(i.key, { kwKoText: e.target.value })} /></label>
                      <div className="pe-card-foot">
                        <code>{i.id}</code>
                        <button className="link" disabled={!i.label.trim() || filling[i.key] === 'run'} onClick={() => void autoFill(i, true)}>✨ {T.pe.autofill}</button>
                        {filling[i.key] === 'run' ? <span className="dim spin">{T.pe.filling}</span> : null}
                        {filling[i.key] === 'fail' ? <span className="err">{T.pe.fillFail}</span> : null}
                        <button className="link danger" disabled={used} title={used ? T.pe.industryHint : undefined}
                          onClick={() => { setDirty(true); setIndustries((is) => is.filter((x) => x.key !== i.key)); }}>{T.pe.remove}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button className="btn ghost" onClick={addIndustry}>{T.pe.addIndustry}</button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** 티커 입력 + 종목명 검색(한국어·영어). 고르면 티커와 이름을 채운다. */
function SymbolInput({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (r: SearchResult) => void }) {
  const { T, pick } = useLang();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      const res = await fetchJson<SearchResponse>(`/api/search?${qs({ q })}`).catch(() => null);
      setResults((res?.results ?? []).filter((r) => r.symbol && (r.kind === 'stock' || r.kind === 'holding')).slice(0, 8));
      setOpen(true);
    }, 300);
  };

  return (
    <div className="sym-input">
      <input
        value={value}
        placeholder={T.pe.find}
        onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        spellCheck={false}
      />
      {open && results.length ? (
        <ul className="suggest">
          {results.map((r) => (
            <li key={r.key} onMouseDown={(e) => { e.preventDefault(); onPick(r); setOpen(false); }}>
              <span className="ttl">{pick(r.title, r.titleEn)}</span>
              <span className="sym">{r.symbol}</span>
              <span className="sub">{r.sub}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
