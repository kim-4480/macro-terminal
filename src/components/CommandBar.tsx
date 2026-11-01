'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { fetchJson, qs } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import { STRINGS } from '@/lib/strings';
import { VIEW_CODES, type SearchResponse, type SearchResult, type ViewCode } from '@/shared/types';
import { marketOf } from '@/shared/markets';
import { isCompanySymbol } from '@/shared/symbols';
import { useActions } from './actions';

const DEBOUNCE_MS = 300;

// 화면 코드의 한국어 별칭
const ALIASES: Record<string, ViewCode> = {
  거시: 'ECO', 경제: 'ECO', 지표: 'ECO', 시장: 'MKT', 금리곡선: 'GC', 국채: 'GC', 포트: 'PORT', 포트폴리오: 'PORT',
  뉴스: 'N', NEWS: 'N', 지도: 'MAP', 세계지도: 'MAP', 뉴스지도: 'MAP', 브리핑: 'BRIEF', 리포트: 'BRIEF', 도움말: 'HELP', '?': 'HELP', 홈: 'HOME',
};

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

// AI 질문 창을 여는 말
const CHAT_WORDS = ['chat', 'ai', 'ask', '챗', '챗봇', '질문', '물어보기', '에이아이'];

/** 화면 코드·이름(한·영) 일치 */
function viewMatches(q: string, title: (c: ViewCode) => string): SearchResult[] {
  const up = q.toUpperCase();
  const n = squash(q);
  return VIEW_CODES.filter((c) => {
    if (c === up || ALIASES[q] === c || ALIASES[up] === c) return true;
    const names = [STRINGS.ko.views[c], STRINGS.en.views[c], c !== 'HOME' ? STRINGS.ko.panels[c] : '', c !== 'HOME' ? STRINGS.en.panels[c] : ''];
    return names.some((s) => s && squash(s).startsWith(n));
  }).map((c) => ({ key: `fn:${c}`, kind: 'fn' as const, code: c, title: `${c} ${title(c)}`, score: 200 }));
}

const isChatWord = (q: string) => CHAT_WORDS.some((w) => w.startsWith(squash(q)) && squash(q).length >= 2) || CHAT_WORDS.includes(squash(q));

export interface CommandBarHandle {
  focus: () => void;
}

export const CommandBar = forwardRef<CommandBarHandle>(function CommandBar(_, ref) {
  const { T, lang, pick } = useLang();
  const { openChart, setView, selectTopic, openChat, openCompany, openEntity } = useActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState<{ kind: 'searching' | 'none' | 'via' | 'error'; text?: string } | null>(null);
  const searched = useRef<{ q: string; items: SearchResult[] } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const viewTitle = useCallback((c: ViewCode) => (c === 'HOME' ? T.views.HOME : T.panels[c]), [T]);
  // "챗봇"·"AI" 등을 치면 맨 위에 AI 질문 항목
  const withChat = useCallback((q: string, list: SearchResult[]): SearchResult[] =>
    (isChatWord(q) ? [{ key: 'fn:CHAT', kind: 'fn' as const, code: 'CHAT', title: `AI ${T.chat.title}`, score: 300 }, ...list] : list), [T]);

  const runSearch = useCallback(async (q: string): Promise<SearchResult[]> => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const views = withChat(q, viewMatches(q, viewTitle));
    setItems(views);
    setActive(0);
    setNote({ kind: 'searching' });
    setOpen(true);
    try {
      const current = () => inputRef.current?.value.trim() === q;
      const show = (res: SearchResponse, more: boolean) => {
        const all = [...views, ...res.results];
        searched.current = { q, items: all };
        if (!current()) return all;
        setItems(all);
        if (more) setNote({ kind: 'searching' });
        else setNote(res.translated ? { kind: 'via', text: res.translated } : all.length ? null : { kind: 'none' });
        return all;
      };
      // 1) 빠른 결과(로컬·KRX·전에 확인해 둔 결과)를 먼저 보여 주고
      const quick = await fetchJson<SearchResponse>(`/api/search?${qs({ q, deep: '0' })}`, { signal: ctl.signal });
      const first = show(quick, quick.deepAvailable);
      if (!quick.deepAvailable) return first;
      // 2) 모델·Yahoo 결과가 오면 이어 붙인다
      const full = await fetchJson<SearchResponse>(`/api/search?${qs({ q })}`, { signal: ctl.signal });
      return show(full, false);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setNote({ kind: 'error', text: (err as Error).message });
      return views;
    }
  }, [viewTitle]);

  const onChange = (q: string) => {
    setValue(q);
    if (timer.current) clearTimeout(timer.current);
    const t = q.trim();
    if (!t) { setOpen(false); setItems([]); setNote(null); return; }
    setItems(withChat(t, viewMatches(t, viewTitle)));
    setActive(0);
    setNote({ kind: 'searching' });
    setOpen(true);
    timer.current = setTimeout(() => void runSearch(t), DEBOUNCE_MS);
  };

  const close = () => { setOpen(false); setNote(null); };

  const choose = (r: SearchResult | undefined) => {
    close();
    setValue('');
    inputRef.current?.blur();
    if (!r) return;
    const title = pick(r.title, r.titleEn);
    if (r.kind === 'fn' && r.code === 'CHAT') openChat();
    else if (r.kind === 'fn' && r.code) setView(r.code as ViewCode);
    else if (r.kind === 'topic' && r.topic) { setView('N'); selectTopic(r.topic); }
    else if (r.kind === 'entity' && r.entity) openEntity(r.entity, r.title);
    else if (r.symbol && (r.kind === 'stock' || r.kind === 'holding') && isCompanySymbol(r.symbol)) openCompany(r.symbol, title);
    else if (r.id) openChart({ id: r.id, title: r.symbol && r.symbol !== title ? `${title} (${r.symbol})` : title, unit: r.unit });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    // "?질문" 은 바로 AI 에게
    if (q.startsWith('?') && q.length > 1) { close(); setValue(''); inputRef.current?.blur(); openChat(q.slice(1)); return; }
    const up = q.toUpperCase().replace(/\s+GO$/, '');
    if ((VIEW_CODES as readonly string[]).includes(up)) return choose({ key: up, kind: 'fn', code: up, title: up, score: 0 });
    if (timer.current) clearTimeout(timer.current);
    // 검색이 끝난 상태면 고른 항목, 아니면 지금 검색해서 첫 항목
    const list = searched.current?.q === q ? searched.current.items : await runSearch(q);
    if (list.length) return choose(list[Math.min(active, list.length - 1)]);
    // 결과가 없고 티커처럼 생겼으면 그대로 차트 시도
    if (/^[\w.^=-]+$/.test(q)) choose({ key: up, kind: 'stock', id: `yahoo:${up}`, symbol: up, title: up, score: 0 });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === 'Escape') { close(); inputRef.current?.blur(); }
  };

  // 선택된 항목이 보이도록 스크롤
  useEffect(() => {
    document.getElementById(`sugg-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const sub = (r: SearchResult) => (r.kind === 'macro' ? T.groups[r.sub ?? ''] ?? r.sub : r.sub === r.symbol ? '' : r.sub);
  const showList = open && (items.length > 0 || note);

  return (
    <form className="cmd" autoComplete="off" role="search" onSubmit={onSubmit}>
      <span className="prompt">&gt;</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(close, 150)}
        onFocus={() => { if (value.trim()) setOpen(true); }}
        placeholder={T.cmdPlaceholder}
        aria-label={T.cmdLabel}
        spellCheck={false}
        role="combobox"
        aria-expanded={!!showList}
        aria-controls="suggest"
        aria-activedescendant={showList && items.length ? `sugg-${active}` : undefined}
        lang={lang}
      />
      <button type="submit" className="go">GO</button>
      {showList ? (
        <ul id="suggest" className="suggest" role="listbox">
          {items.map((r, i) => {
            const title = r.kind === 'fn' ? r.title : pick(r.title, r.titleEn);
            return (
              <li
                key={r.key}
                id={`sugg-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); choose(r); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={`kind ${r.kind === 'fn' ? 'fn' : ''}`}>{T.search.kinds[r.kind]}</span>
                <span className="ttl">{title}</span>
                {r.koUnverified && lang === 'ko' ? <span className="unv" title={T.search.unverifiedHint}>{T.search.unverified}</span> : null}
                {r.symbol && r.symbol !== title ? <span className="sym">{r.symbol}</span> : null}
                {r.symbol && marketOf(r.symbol) ? <span className="mkt">{pick(marketOf(r.symbol)!.ko, marketOf(r.symbol)!.en)}</span> : null}
                <span className="sub">{sub(r)}</span>
              </li>
            );
          })}
          {note ? (
            <li className="note">
              {note.kind === 'searching' ? <span className="spin">{T.search.searching}</span>
                : note.kind === 'via' ? T.search.via(note.text ?? '')
                  : note.kind === 'none' ? T.search.none : note.text}
            </li>
          ) : null}
        </ul>
      ) : null}
    </form>
  );
});
