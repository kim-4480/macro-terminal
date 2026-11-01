import type { StoredChat } from '@/shared/journal';
import { journalDb } from './db';

// 대화 세션 저장(이전에는 브라우저 localStorage). 서버에 두어야 앱·브라우저 어디서든 같은 대화가 보이고,
// 거래를 분석할 때 그 무렵 나눈 대화를 근거로 쓸 수 있다.

const MAX_SESSIONS = 200;
const MAX_JSON = 400_000;

interface Row { id: string; title: string; updated_at: number; msgs: string }

const toChat = (r: Row): StoredChat => ({ id: r.id, title: r.title, updatedAt: r.updated_at, msgs: JSON.parse(r.msgs) as unknown[] });

export function listChats(): StoredChat[] {
  const rows = journalDb().prepare('SELECT id, title, updated_at, msgs FROM chats ORDER BY updated_at DESC LIMIT ?').all(MAX_SESSIONS) as unknown as Row[];
  return rows.map(toChat);
}

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function validChat(raw: unknown): StoredChat | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id) || !Array.isArray(o.msgs)) return null;
  const msgs = o.msgs.filter((m) => !!m && typeof m === 'object' && ['user', 'assistant'].includes((m as { role?: string }).role ?? '') && typeof (m as { content?: unknown }).content === 'string');
  if (JSON.stringify(msgs).length > MAX_JSON) return null;
  return { id: o.id, title: String(o.title ?? '').slice(0, 120), updatedAt: Number(o.updatedAt) || Date.now(), msgs };
}

export function saveChat(c: StoredChat): void {
  journalDb().prepare(`INSERT INTO chats (id, title, updated_at, msgs) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at, msgs = excluded.msgs`)
    .run(c.id, c.title, c.updatedAt, JSON.stringify(c.msgs));
}

export function deleteChat(id: string): void {
  journalDb().prepare('DELETE FROM chats WHERE id = ?').run(id);
}

/** 거래 분석용: 그 무렵(기본 7일) 사용자가 한 말 중 종목을 언급한 것 */
export function chatExcerptsAbout(terms: string[], since: number, until: number, max = 6): { at: number; text: string }[] {
  const words = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  if (!words.length) return [];
  const rows = journalDb().prepare('SELECT updated_at, msgs FROM chats WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 60').all(since) as unknown as Row[];
  const out: { at: number; text: string }[] = [];
  for (const r of rows) {
    const msgs = JSON.parse(r.msgs) as { role: string; content: string; at?: number }[];
    for (const m of msgs) {
      if (m.role !== 'user') continue;
      const at = typeof m.at === 'number' ? m.at : r.updated_at;
      if (at < since || at > until) continue;
      const lc = m.content.toLowerCase();
      if (words.some((w) => lc.includes(w))) out.push({ at, text: m.content.slice(0, 500) });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, max);
}
