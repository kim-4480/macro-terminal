'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import type { AgentAction, AgentDecision, AgentScreen, AgentUi, ChatEvent, ChatSource, Lang, QuoteCheck, ToolTrace } from '@/shared/types';
import { storage } from './storage';

export type ActionState = 'pending' | 'sending' | 'approved' | 'rejected' | 'expired';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  /** 보낸 시각(거래 분석 때 그 무렵 대화를 찾는다) */
  at?: number;
  error?: boolean;
  /** 진행 단계(검색, 기사 읽기, 승인 대기 …) */
  steps?: string[];
  sources?: ChatSource[];
  checks?: QuoteCheck[];
  uncited?: number;
  /** 이 답에서 에이전트가 실제로 부른 도구(다음 질문 때 함께 보낸다) */
  tools?: ToolTrace[];
  /** 승인 카드 */
  actions?: (AgentAction & { state: ActionState })[];
}

/** 대화 세션 하나(제목 = 첫 질문) */
export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  msgs: ChatMsg[];
}

// 대화는 서버(SQLite)에 저장한다. 예전 브라우저 저장분(chat:v4, chat:v3)은 처음 한 번 서버로 옮긴다.
const LOCAL_KEY = 'chat:v4';
const OLD_KEY = 'chat:v3';
const MAX_KEEP = 60;
const HEADERS = { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' };

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const titleOf = (msgs: ChatMsg[]) => msgs.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim().slice(0, 60) ?? '';
const expire = (m: ChatMsg, states: ActionState[]): ChatMsg =>
  (m.actions ? { ...m, actions: m.actions.map((a) => (states.includes(a.state) ? { ...a, state: 'expired' as const } : a)) } : m);

function cleanMsgs(raw: unknown): ChatMsg[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ChatMsg[])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    // 새로고침 전의 승인 카드는 서버에서도 사라졌으므로 만료로
    .map((m) => expire(m, ['pending', 'sending']));
}

function parseSessions(raw: unknown): ChatSession[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ChatSession[])
    .filter((s) => s && typeof s.id === 'string')
    .map((s) => ({ id: s.id, title: String(s.title ?? ''), updatedAt: Number(s.updatedAt) || 0, msgs: cleanMsgs(s.msgs) }))
    .filter((s) => s.msgs.length);
}

/** 이 브라우저에 남아 있던 대화(서버로 옮길 것) */
function localSessions(): ChatSession[] {
  try {
    const raw = JSON.parse(storage.get(LOCAL_KEY) ?? 'null') as unknown;
    if (Array.isArray(raw)) return parseSessions(raw);
    const old = cleanMsgs(JSON.parse(storage.get(OLD_KEY) ?? '[]'));
    return old.length ? [{ id: newId(), title: titleOf(old), updatedAt: Date.now(), msgs: old }] : [];
  } catch {
    return [];
  }
}

const forStore = (s: ChatSession): ChatSession => ({ ...s, msgs: s.msgs.filter((m) => !m.error).slice(-MAX_KEEP) });

async function postChats(body: unknown): Promise<void> {
  const res = await fetch('/api/chats', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`chats ${res.status}`);
}

async function loadSessions(): Promise<ChatSession[]> {
  const res = await fetch('/api/chats');
  if (!res.ok) throw new Error(`chats ${res.status}`);
  const server = parseSessions(((await res.json()) as { chats?: unknown }).chats);
  const local = localSessions();
  const known = new Set(server.map((s) => s.id));
  const move = local.filter((s) => !known.has(s.id));
  if (move.length) {
    await postChats({ chats: move.map(forStore) });
    storage.remove(LOCAL_KEY);
    storage.remove(OLD_KEY);
  }
  return [...server, ...move].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 대화 세션들과 /api/chat 스트림 처리(옆 창·전체 화면이 함께 쓴다) */
export function useChat({ lang, messages: T, onUi, getScreen }: {
  lang: Lang;
  messages: { failed: string; offline: string };
  onUi: (ui: AgentUi) => void;
  /** 지금 화면(질문·승인마다 에이전트에 알린다) */
  getScreen: () => AgentScreen;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  /** null = 아직 보내지 않은 새 대화 */
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** 답을 받고 있는 세션(한 번에 하나) */
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const onUiRef = useRef(onUi);
  onUiRef.current = onUi;
  const screenRef = useRef(getScreen);
  screenRef.current = getScreen;
  const { mutate } = useSWRConfig();

  // 불러오기 전에는 저장하지 않는다(빈 목록으로 덮어쓰지 않게)
  const [loaded, setLoaded] = useState(false);
  /** 서버에 마지막으로 저장한 모습(바뀐 세션만 보낸다) */
  const savedJson = useRef(new Map<string, string>());
  useEffect(() => {
    let alive = true;
    loadSessions()
      .catch(() => localSessions()) // 서버가 안 되면 이 브라우저 것만이라도
      .then((list) => {
        if (!alive) return;
        for (const s of list) savedJson.current.set(s.id, JSON.stringify(forStore(s)));
        setSessions(list);
        setCurrentId(list[0]?.id ?? null);
        setLoaded(true);
      });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!loaded || streamingId) return;
    const changed = sessions.map(forStore).filter((s) => s.msgs.length && savedJson.current.get(s.id) !== JSON.stringify(s));
    if (!changed.length) return;
    const t = setTimeout(() => {
      postChats({ chats: changed })
        .then(() => { for (const s of changed) savedJson.current.set(s.id, JSON.stringify(s)); })
        .catch(() => { /* 다음 변경 때 다시 보낸다 */ });
    }, 400);
    return () => clearTimeout(t);
  }, [sessions, streamingId, loaded]);

  const update = useCallback((id: string, fn: (s: ChatSession) => ChatSession) =>
    setSessions((cur) => cur.map((s) => (s.id === id ? fn(s) : s))), []);

  /** 그 세션의 마지막 답 메시지를 고친다 */
  const patch = useCallback((id: string, fn: (m: ChatMsg) => ChatMsg) => update(id, (s) => {
    if (s.msgs.at(-1)?.role !== 'assistant') return s;
    const msgs = [...s.msgs];
    msgs[msgs.length - 1] = fn(msgs.at(-1)!);
    return { ...s, msgs, updatedAt: Date.now() };
  }), [update]);

  /** 스트림을 읽어 그 세션의 마지막 답 메시지에 반영 */
  const stream = useCallback(async (id: string, body: unknown) => {
    setStreamingId(id);
    const ctl = new AbortController();
    abort.current = ctl;
    const p = (fn: (m: ChatMsg) => ChatMsg) => patch(id, fn);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' },
        body: JSON.stringify({ ...(body as object), screen: screenRef.current() }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(res.status === 503 ? T.offline : err.error ?? T.failed);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as ChatEvent;
          if (e.t === 'status') p((m) => ({ ...m, steps: [...(m.steps ?? []), e.text] }));
          else if (e.t === 'source') p((m) => ({ ...m, sources: [...(m.sources ?? []).filter((s) => s.id !== e.source.id), e.source] }));
          else if (e.t === 'answer') p((m) => ({ ...m, content: e.text }));
          else if (e.t === 'checks') p((m) => ({ ...m, checks: e.checks, uncited: e.uncited }));
          else if (e.t === 'trace') p((m) => ({ ...m, tools: e.calls }));
          else if (e.t === 'confirm') p((m) => ({ ...m, actions: [...(m.actions ?? []), { ...e.action, state: 'pending' }] }));
          else if (e.t === 'decided') p((m) => ({ ...m, actions: m.actions?.map((a) => (a.id === e.id ? { ...a, state: e.approved ? 'approved' : 'rejected' } : a)) }));
          else if (e.t === 'changed') void mutate((key) => typeof key === 'string' && (key.startsWith('/api/macro') || key.startsWith('/api/strip') || key.startsWith('/api/portfolio') || key.startsWith('/api/company')));
          else if (e.t === 'ui') onUiRef.current(e.ui);
          else if (e.t === 'error') p((m) => ({ ...m, content: `${T.failed}: ${e.text}`, error: true }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') p((m) => ({ ...m, content: `${T.failed}: ${(err as Error).message}`, error: true }));
    } finally {
      setStreamingId(null);
      abort.current = null;
    }
  }, [T, patch, mutate]);

  const current = sessions.find((s) => s.id === currentId) ?? null;
  const msgs = current?.msgs ?? [];

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || streamingId) return;
    const asked: ChatMsg = { role: 'user', content: q, at: Date.now() };
    // 승인을 기다리던 카드는 새 질문을 하면 만료
    const history: ChatMsg[] = [...msgs.filter((m) => !m.error), asked].map((m) => expire(m, ['pending']));
    const next: ChatMsg[] = [...history, { role: 'assistant', content: '', sources: [], steps: [] }];
    let id = current?.id;
    if (id) update(id, (s) => ({ ...s, msgs: next, updatedAt: Date.now() }));
    else {
      id = newId();
      const created: ChatSession = { id, title: titleOf(next), updatedAt: Date.now(), msgs: next };
      setSessions((cur) => [created, ...cur]);
      setCurrentId(id);
    }
    await stream(id, { chatId: id, messages: history.map(({ role, content, tools }) => ({ role, content, ...(tools?.length ? { tools } : {}) })), lang });
  }, [msgs, current, streamingId, lang, stream, update]);

  /** 승인 카드 결정 → 같은 답 메시지에 이어서 */
  const decide = useCallback(async (d: AgentDecision) => {
    if (streamingId) return;
    const owner = sessions.find((s) => s.msgs.some((m) => m.actions?.some((a) => a.id === d.id)));
    if (!owner) return;
    update(owner.id, (s) => ({ ...s, msgs: s.msgs.map((m) => (m.actions?.some((a) => a.id === d.id) ? { ...m, actions: m.actions.map((a) => (a.id === d.id ? { ...a, state: 'sending' as const } : a)) } : m)) }));
    await stream(owner.id, { chatId: owner.id, resume: d, lang });
  }, [sessions, streamingId, lang, stream, update]);

  const stop = useCallback(() => abort.current?.abort(), []);
  /** 새 대화(첫 질문을 보내면 목록에 생긴다) */
  const newChat = useCallback(() => setCurrentId(null), []);
  const select = useCallback((id: string) => setCurrentId(id), []);
  const remove = useCallback((id: string) => {
    if (id === streamingId) abort.current?.abort();
    setSessions((cur) => cur.filter((s) => s.id !== id));
    setCurrentId((c) => (c === id ? null : c));
    savedJson.current.delete(id);
    void postChats({ delete: id }).catch(() => { /* 서버가 꺼져 있으면 남는다 */ });
  }, [streamingId]);
  /** 지금 대화 지우기 */
  const clear = useCallback(() => { if (currentId) remove(currentId); }, [currentId, remove]);

  return {
    sessions,
    currentId,
    msgs,
    /** 지금 보는 대화가 답을 받는 중 */
    streaming: !!streamingId && streamingId === currentId,
    /** 어느 대화든 답을 받는 중(새 질문은 하나씩) */
    busy: !!streamingId,
    streamingId,
    send,
    decide,
    stop,
    clear,
    newChat,
    select,
    remove,
  };
}

export type ChatState = ReturnType<typeof useChat>;
