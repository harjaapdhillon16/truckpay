import "server-only";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

/**
 * Local state for the demo: loads, the events on their timeline, payouts and uploaded proofs.
 * Agent Connect remains the source of truth for money; this database is the broker's TMS.
 */

const globalForDb = globalThis as unknown as { __loadDb?: DatabaseSync };

function open() {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(`${config.dataDir}/loads.db`);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS loads (
      id TEXT PRIMARY KEY,
      ref TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      data TEXT NOT NULL,
      wallet TEXT NOT NULL DEFAULT '{}',
      driver_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      load_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS events_load ON events(load_id, id);
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      load_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      amount_atomic TEXT NOT NULL,
      destination TEXT NOT NULL,
      status TEXT NOT NULL,
      correlation_id TEXT,
      idempotency_key TEXT NOT NULL,
      error_code TEXT,
      error_detail TEXT,
      trigger_proof_id TEXT,
      created_at TEXT NOT NULL,
      settled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS payouts_load ON payouts(load_id, created_at);
    CREATE TABLE IF NOT EXISTS proofs (
      id TEXT PRIMARY KEY,
      load_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      lat REAL,
      lng REAL,
      distance_m REAL,
      simulated_location INTEGER NOT NULL DEFAULT 0,
      files TEXT NOT NULL DEFAULT '{}',
      data TEXT NOT NULL DEFAULT '{}',
      verdict TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proofs_load ON proofs(load_id, created_at);
  `);
  return db;
}

export function db() {
  globalForDb.__loadDb ??= open();
  return globalForDb.__loadDb;
}

export function kvGet(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function kvSet(key: string, value: string) {
  db()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
