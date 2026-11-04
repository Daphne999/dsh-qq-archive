/**
 * store.js —— 归档用的本地 SQLite。
 *
 * 用 node:sqlite（Node 22+ 内置，无需编译），单文件、无服务、可随时删。
 * 去重靠 (session_id, role, at, text) 的唯一索引。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openStore(dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      at INTEGER,
      text TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_unique ON messages(session_id, role, IFNULL(at, 0), text);
    CREATE INDEX IF NOT EXISTS idx_messages_at ON messages(at);
  `);
  return db;
}

export function insertMessages(db, rows) {
  if (!rows.length) return 0;
  const stmt = db.prepare('INSERT OR IGNORE INTO messages (session_id, role, at, text, imported_at) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const info = stmt.run(r.sessionId, r.role, r.at ?? null, r.text, now);
      if (info.changes) n++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

export function search(db, query, limit = 20) {
  const q = `%${String(query).replace(/[%_]/g, (m) => '\\' + m)}%`;
  const stmt = db.prepare(
    `SELECT session_id, role, at, text FROM messages
     WHERE text LIKE ? ESCAPE '\\' ORDER BY IFNULL(at, 0) DESC LIMIT ?`,
  );
  const rows = stmt.all(q, Math.max(1, Math.min(100, Number(limit) || 20)));
  const needle = String(query);
  return rows.map((r) => ({ ...r, snippet: snippet(r.text, needle) }));
}

/** 命中点前后各留一点上下文：长消息里关键词可能在很后面，直接截前 400 字会看不到 */
function snippet(text, needle, radius = 90) {
  const flat = String(text).replace(/\s+/g, ' ');
  const idx = flat.toLowerCase().indexOf(String(needle).toLowerCase());
  if (idx <= radius) return flat.slice(0, radius * 2 + needle.length) + (flat.length > radius * 2 + needle.length ? '…' : '');
  const start = idx - radius;
  const end = idx + needle.length + radius;
  return '…' + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

export function stats(db) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  const byRole = db.prepare('SELECT role, COUNT(*) AS c FROM messages GROUP BY role').all();
  const bySession = db.prepare('SELECT session_id, COUNT(*) AS c, MIN(at) AS first, MAX(at) AS last FROM messages GROUP BY session_id ORDER BY c DESC LIMIT 10').all();
  const range = db.prepare('SELECT MIN(at) AS first, MAX(at) AS last FROM messages').get();
  return { total, byRole, bySession, range };
}
