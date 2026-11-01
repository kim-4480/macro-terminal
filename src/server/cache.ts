import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './paths';

// node:sqlite 는 번들러가 해석하지 못하므로 런타임 내장 모듈로 불러온다.
const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

interface CacheState {
  db: DatabaseSync;
  inflight: Map<string, Promise<unknown>>;
}

// 개발 서버의 모듈 재로딩에도 연결을 하나만 유지
const g = globalThis as typeof globalThis & { __macroCache?: CacheState };

function state(): CacheState {
  if (!g.__macroCache) {
    const db = new sqlite.DatabaseSync(path.join(DATA_DIR, 'cache.db'));
    db.exec(`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    g.__macroCache = { db, inflight: new Map() };
  }
  return g.__macroCache;
}

export function peek<T>(key: string): { value: T; updatedAt: number } | null {
  const row = state().db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key) as
    | { value: string; updated_at: number }
    | undefined;
  return row ? { value: JSON.parse(row.value) as T, updatedAt: row.updated_at } : null;
}

export function put(key: string, value: unknown): void {
  state().db
    .prepare(`INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), Date.now());
}

export function removeWhere(prefix: string): void {
  state().db.prepare('DELETE FROM kv WHERE key LIKE ?').run(`${prefix}%`);
}

/**
 * TTL 안이면 캐시를 쓰고, 새로 받다가 실패하면 마지막 캐시를 돌려준다
 * (인터넷이 끊겨도 마지막으로 본 화면을 유지).
 */
export function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = peek<T>(key);
  if (hit && Date.now() - hit.updatedAt < ttlMs) return Promise.resolve(hit.value);
  const { inflight } = state();
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => {
    try {
      const value = await fetcher();
      put(key, value);
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
