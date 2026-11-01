import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../paths';

// 매매일지 DB(data/journal.db). 캐시(cache.db)와 달리 지우면 안 되는 사용자 기록이라 따로 둔다.
// node:sqlite 는 번들러가 해석하지 못하므로 런타임 내장 모듈로 불러온다.
const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

const g = globalThis as typeof globalThis & { __journalDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  msgs TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  initial_base REAL NOT NULL,
  cash_base REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  qty REAL NOT NULL CHECK (qty > 0),
  price REAL NOT NULL CHECK (price > 0),
  currency TEXT NOT NULL,
  fx REAL NOT NULL,
  trade_date TEXT NOT NULL,
  executed_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  prior_move REAL,
  chat_id TEXT
);
CREATE INDEX IF NOT EXISTS trades_symbol ON trades (symbol, executed_at);
CREATE TABLE IF NOT EXISTS notes (
  trade_id INTEGER PRIMARY KEY REFERENCES trades (id) ON DELETE CASCADE,
  memo TEXT NOT NULL,
  plan_followed TEXT,
  plan TEXT NOT NULL,
  target REAL,
  stop REAL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  trade_id INTEGER PRIMARY KEY REFERENCES trades (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  data TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  chat_excerpts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outcomes (
  trade_id INTEGER NOT NULL REFERENCES trades (id) ON DELETE CASCADE,
  horizon INTEGER NOT NULL,
  date TEXT NOT NULL,
  ret REAL NOT NULL,
  bench_symbol TEXT NOT NULL,
  bench_ret REAL,
  measured_at INTEGER NOT NULL,
  PRIMARY KEY (trade_id, horizon)
);
CREATE TABLE IF NOT EXISTS ai_opinions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  created_at INTEGER NOT NULL,
  date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  stance TEXT NOT NULL,
  text TEXT NOT NULL,
  base_price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_outcomes (
  opinion_id INTEGER NOT NULL REFERENCES ai_opinions (id) ON DELETE CASCADE,
  horizon INTEGER NOT NULL,
  date TEXT NOT NULL,
  ret REAL NOT NULL,
  bench_symbol TEXT NOT NULL,
  bench_ret REAL,
  measured_at INTEGER NOT NULL,
  PRIMARY KEY (opinion_id, horizon)
);
`;

/** 경로를 주면 그 파일(테스트는 ':memory:'), 아니면 data/journal.db 하나를 계속 쓴다 */
export function openJournalDb(file?: string): DatabaseSync {
  const db = new sqlite.DatabaseSync(file ?? path.join(DATA_DIR, 'journal.db'));
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function journalDb(): DatabaseSync {
  return (g.__journalDb ??= openJournalDb());
}

/** 테스트용: 메모리 DB로 바꿔 끼운다 */
export function useJournalDb(db: DatabaseSync): void {
  g.__journalDb = db;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
