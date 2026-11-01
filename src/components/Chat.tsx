'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LangSwitch } from './LangSwitch';
import { useLang } from '@/lib/i18n';
import type { ChatMsg, ChatState } from '@/lib/useChat';
import { NAV_CODES, type AgentDecision, type ViewCode } from '@/shared/types';
import { Markdown } from './ui';

/**
 * AI 에이전트 대화. mode="drawer" 는 오른쪽 창, mode="full" 은 화면 전체(가운데 대화 열 + 아래 입력창).
 * 대화 상태(useChat)는 Terminal 이 들고 있어 두 모드가 같은 대화를 보여 준다.
 * pending: 열면서 바로 보낼 질문(명령창의 "?질문" 등)
 */
export function Chat({ chat, mode, open = true, pending, onPendingSent, onClose, onToggleMode, llmOnline }: {
  chat: ChatState;
  mode: 'drawer' | 'full';
  open?: boolean;
  pending?: string | null;
  onPendingSent?: () => void;
  onClose?: () => void;
  onToggleMode: () => void;
  llmOnline: boolean | undefined;
}) {
  const { T, lang } = useLang();
  const { msgs, streaming, busy, send, decide, stop } = chat;
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  // 전체 화면: 위쪽 막대(배너 포함) 아래부터 화면 끝까지 채운다
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (mode !== 'full' || !el) return;
    // 사이드바와 함께 있으면 둘을 감싼 칸(.ai-shell) 높이를 맞춘다
    const box = el.parentElement?.classList.contains('ai-shell') ? el.parentElement : el;
    const fit = () => box.style.setProperty('--chrome-h', `${Math.round(box.getBoundingClientRect().top + window.scrollY)}px`);
    fit();
    window.addEventListener('resize', fit);
    const ro = new ResizeObserver(fit);
    if (box.parentElement) ro.observe(box.parentElement);
    return () => { window.removeEventListener('resize', fit); ro.disconnect(); };
  }, [mode, open]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open, mode]);

  // 명령창에서 넘어온 질문은 열자마자 보낸다
  useEffect(() => {
    if (open && pending && !busy) { void send(pending); onPendingSent?.(); }
  }, [open, pending, busy, send, onPendingSent]);

  const submit = () => { if (input.trim() && !busy) { void send(input); setInput(''); } };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && mode === 'drawer') onClose?.();
  };

  if (!open) return null;
  const full = mode === 'full';
  return (
    <aside ref={rootRef} className={`chat ${full ? 'chat-full' : ''}`} role={full ? 'region' : 'dialog'} aria-label={T.chat.title}>
      <div className="chat-head">
        <b>AI</b>
        <span className="chat-title">{full ? chat.sessions.find((x) => x.id === chat.currentId)?.title || T.chat.newChat : T.chat.title}</span>
        <span className={`pill ${llmOnline ? 'on' : 'off'}`}>{llmOnline ? 'AGENT' : 'OFFLINE'}</span>
        {!full ? <button className="link" onClick={chat.newChat} disabled={!msgs.length}>{T.chat.clear}</button> : null}
        <button className="link mode" onClick={onToggleMode} title={full ? T.chat.collapse : T.chat.expand}>{full ? `⤡ ${T.chat.collapse}` : `⤢ ${T.chat.expand}`}</button>
        {!full ? <button className="x" onClick={onClose} aria-label={T.chat.close}>✕</button> : null}
      </div>

      <div className="chat-list" ref={listRef}>
        <div className="chat-col">
          {!msgs.length ? (
            <div className="chat-empty">
              <p className="dim">{T.chat.hint}</p>
              <p className="dim small">{T.chat.sandbox}</p>
            </div>
          ) : msgs.map((m, i) => (m.role === 'user'
            ? <div key={i} className="msg user"><p>{m.content}</p></div>
            : <AssistantMessage key={i} m={m} live={streaming && i === msgs.length - 1} busy={busy} onDecide={(d) => void decide(d)} />))}
        </div>
      </div>

      <div className="chat-input">
        <div className="chat-col">
          {!llmOnline ? <div className="legend err">{T.chat.offline}</div> : null}
          <div className="chat-box">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={T.chat.placeholder}
              rows={full ? 2 : 3}
              lang={lang}
            />
            {streaming
              ? <button className="btn" onClick={stop}>{T.chat.stop}</button>
              : <button className="btn" onClick={submit} disabled={!input.trim() || !llmOnline || busy}>{T.chat.send}</button>}
          </div>
        </div>
      </div>
    </aside>
  );
}

/**
 * 전체 화면 에이전트의 왼쪽 사이드바(데스크톱 Claude 앱처럼): 새 대화, 다른 화면 메뉴, 최근 대화 목록, 언어.
 */
export function ChatSidebar({ chat, onView }: { chat: ChatState; onView: (v: ViewCode) => void }) {
  const { T, lang, setLang } = useLang();
  const sorted = [...chat.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <nav className="ai-side" aria-label={T.chat.menu}>
      <div className="brand"><b>MACRO</b><span>TERMINAL</span></div>
      <button type="button" className="ai-new" onClick={chat.newChat} aria-pressed={!chat.currentId}>
        <span aria-hidden>＋</span>{T.chat.newChat}
      </button>
      <div className="ai-menu">
        <div className="ai-label">{T.chat.menu}</div>
        {[...NAV_CODES.filter((c) => c !== 'AI'), 'HELP' as const].map((c) => (
          <button key={c} type="button" onClick={() => onView(c)}><b>{c}</b>{T.views[c]}</button>
        ))}
      </div>
      <div className="ai-label">{T.chat.recent}</div>
      <ul className="ai-sessions">
        {!sorted.length ? <li className="dim small">{T.chat.noSessions}</li> : sorted.map((s) => (
          <li key={s.id} className={s.id === chat.currentId ? 'active' : ''}>
            <button type="button" className="ai-sess" onClick={() => chat.select(s.id)} title={s.title}>
              {s.id === chat.streamingId ? <span className="ai-live" title={T.chat.answering} /> : null}
              <span>{s.title || T.chat.newChat}</span>
            </button>
            <button type="button" className="ai-del" onClick={() => chat.remove(s.id)} aria-label={T.chat.remove} title={T.chat.remove}>✕</button>
          </li>
        ))}
      </ul>
      <div className="ai-foot">
        <LangSwitch />
      </div>
    </nav>
  );
}

/** 진행 단계 + 승인 카드 + 답 + 근거 목록 + 원문 대조 결과 */
function AssistantMessage({ m, live, busy, onDecide }: { m: ChatMsg; live: boolean; busy: boolean; onDecide: (d: AgentDecision) => void }) {
  const { T, lang } = useLang();
  const checks = m.checks ?? [];
  const quotes = checks.filter((c) => c.kind === 'quote');
  const numbers = checks.filter((c) => c.kind === 'number');
  const failed = checks.filter((c) => !c.ok);
  const cited = new Set([...(m.content.matchAll(/\[([SN]\d+)\]/g))].map((x) => x[1]));
  const links = new Map((m.sources ?? []).filter((s) => s.url && /^https?:\/\//.test(s.url)).map((s) => [s.id, s.url!]));
  const sources = (m.sources ?? []).filter((s) => cited.has(s.id) || !m.content);
  const date = (t?: number | null) => (t ? new Date(t).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US') : '');

  return (
    <div className={`msg assistant${m.error ? ' error' : ''}`}>
      <Steps steps={m.steps ?? []} live={live} />

      {m.actions?.map((a) => <ActionCard key={a.id} a={a} busy={busy} onDecide={onDecide} />)}

      {m.content ? <Markdown source={m.content} className="md chat-md" links={links} /> : null}

      {checks.length || m.uncited ? (
        <div className={`chat-verify ${failed.length || m.uncited ? 'warn' : 'ok'}`}>
          {failed.length || m.uncited ? '⚠ ' : '✓ '}
          {T.chat.verified([quotes.filter((c) => c.ok).length, quotes.length], [numbers.filter((c) => c.ok).length, numbers.length])}
          {m.uncited ? <div>{T.chat.uncited(m.uncited)}</div> : null}
          {failed.length ? (
            <ul>
              {failed.map((c, i) => <li key={i}><b>[{c.sourceId}]</b> {c.kind === 'quote' ? `“${c.quote}”` : c.quote} — {T.chat.notFound}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {sources.length ? (
        <div className="chat-sources">
          <b>{T.chat.sources}</b>
          <ol>
            {sources.map((s) => (
              <li key={s.id} id={`src-${s.id}`}>
                <span className="sid">{s.id}</span>
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : <span>{s.title}</span>}
                <span className="dim"> · {[s.publisher, date(s.published)].filter(Boolean).join(' · ')}{s.partial ? ` · ${T.chat.partial}` : ''}{s.unread ? ` · ${T.chat.unread}` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** 작업 단계: 진행 중엔 펼쳐 두고, 끝나면 "작업 n단계"로 접는다 */
function Steps({ steps, live }: { steps: string[]; live: boolean }) {
  const { T } = useLang();
  const [open, setOpen] = useState(false);
  if (!steps.length) return live ? <div className="chat-status spin">{T.chat.working}</div> : null;
  const show = live || open;
  return (
    <div className={`steps${live ? ' live' : ''}`}>
      {!live ? <button className="steps-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? '▾' : '▸'} {T.chat.steps(steps.length)}</button> : null}
      {show ? (
        <ol>
          {steps.map((s, i) => {
            const current = live && i === steps.length - 1;
            return <li key={i} className={current ? 'current' : ''}><span className="mark">{current ? '' : '✓'}</span><span className={current ? 'spin' : ''}>{s}</span></li>;
          })}
        </ol>
      ) : null}
    </div>
  );
}

/** 승인 카드: 바뀌는 내용을 보여 주고, 수량·업계는 고쳐서 승인할 수 있다 */
function ActionCard({ a, busy, onDecide }: { a: NonNullable<ChatMsg['actions']>[number]; busy: boolean; onDecide: (d: AgentDecision) => void }) {
  const { T } = useLang();
  const [qty, setQty] = useState<string>(a.qty != null ? String(a.qty) : '');
  const [industry, setIndustry] = useState<string>(a.industry ?? '');
  const editable = a.state === 'pending' && (a.kind === 'add_holding' || a.kind === 'update_holding');
  const needsIndustry = a.kind === 'add_holding' && !industry;
  const q = Number(qty);
  const qtyOk = !editable || qty === '' || (Number.isFinite(q) && q > 0);
  const stateText = { pending: '', sending: T.chat.sending, approved: `✓ ${T.chat.approved}`, rejected: `✕ ${T.chat.rejected}`, expired: T.chat.expired }[a.state];

  return (
    <div className={`act-card ${a.state}`}>
      <div className="act-head">
        <b>{a.state === 'pending' ? T.chat.needApproval : stateText}</b>
        <span>{a.title}</span>
      </div>
      {a.detail.length ? (
        <dl>{a.detail.map((d) => <div key={d.label}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>
      ) : null}
      {editable ? (
        <div className="act-edit">
          <label>{T.chat.qty}<input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          {a.industries?.length ? (
            <label>{T.chat.industry}
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option value="" disabled>{T.chat.pickIndustry}</option>
                {a.industries.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {a.state === 'pending' ? (
        <div className="act-btns">
          <button className="btn" disabled={busy || needsIndustry || !qtyOk} onClick={() => onDecide({ id: a.id, approved: true, qty: qty === '' ? null : q, industry: industry || null })}>{T.chat.approve}</button>
          <button className="btn ghost" disabled={busy} onClick={() => onDecide({ id: a.id, approved: false })}>{T.chat.reject}</button>
        </div>
      ) : null}
    </div>
  );
}
