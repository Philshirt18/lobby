import { DatabaseSync } from 'node:sqlite'
import { cfg } from './config'

export const db = new DatabaseSync(cfg.dbPath)

db.exec(`
CREATE TABLE IF NOT EXISTS held (
  receiver TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  originator TEXT NOT NULL,
  memo TEXT NOT NULL,
  memo_text TEXT NOT NULL,
  blocked_at INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  block INTEGER NOT NULL,
  receipt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',
  resolved_tx TEXT,
  resolved_to TEXT,
  PRIMARY KEY (receiver, nonce)
);
CREATE TABLE IF NOT EXISTS credited (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  token TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  amount TEXT NOT NULL,
  memo TEXT,
  memo_text TEXT,
  block INTEGER NOT NULL,
  ts INTEGER,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS known (
  address TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  paid_tx TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`)

export function getMeta(k: string): string | undefined {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined
  return row?.v
}

export function setMeta(k: string, v: string) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v)
}
