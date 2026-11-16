import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Make sure the folder for the database file exists
// SQLite creates the file but not the folder, so create the folder first
// (on Docker the folder is the mounted volume)
fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

export const db = new Database(config.DB_PATH);

// WAL + FULL: a committed write is on disk before replying (D-23)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS charges (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_key    TEXT NOT NULL UNIQUE,
    amount_rupees  INTEGER NOT NULL CHECK (amount_rupees >= 0),
    status         TEXT NOT NULL CHECK (status IN ('processing','succeeded','failed')),
    reason         TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS refunds (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    refund_key     TEXT NOT NULL UNIQUE,
    payment_key    TEXT NOT NULL REFERENCES charges(payment_key),
    amount_rupees  INTEGER NOT NULL CHECK (amount_rupees >= 0),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS refund_attempts (
    refund_key     TEXT PRIMARY KEY,
    attempts       INTEGER NOT NULL DEFAULT 0
  );
`);

export function closeDb(): void {
  db.close();
}
