-- LoadWallet: one row per load, plus its owner intents, payments, proofs and timeline.
CREATE TABLE loads (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  rate_usd REAL NOT NULL,
  rate_atomic TEXT NOT NULL,
  delivery TEXT NOT NULL,
  carrier TEXT NOT NULL,
  wallet TEXT NOT NULL DEFAULT '{}',
  driver_token TEXT NOT NULL UNIQUE,
  create_key TEXT UNIQUE,
  lease_until INTEGER NOT NULL DEFAULT 0,
  failure TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX loads_status ON loads(status);

CREATE TABLE owner_intents (
  correlation_id TEXT PRIMARY KEY,
  load_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX owner_intents_load ON owner_intents(load_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  load_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  amount_atomic TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL,
  correlation_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  error_code TEXT,
  error_detail TEXT,
  proof_id TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE INDEX payments_load ON payments(load_id, created_at);
-- At most one carrier payment and one refund per load, ever.
CREATE UNIQUE INDEX payments_once ON payments(load_id, kind) WHERE kind IN ('payment', 'refund');

CREATE TABLE proofs (
  id TEXT PRIMARY KEY,
  load_id TEXT NOT NULL,
  status TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy_m REAL,
  distance_m REAL NOT NULL,
  files TEXT NOT NULL DEFAULT '{}',
  verdict TEXT,
  idempotency_key TEXT UNIQUE,
  verify_started_at INTEGER NOT NULL DEFAULT 0,
  review_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX proofs_load ON proofs(load_id, created_at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX events_load ON events(load_id, id);
