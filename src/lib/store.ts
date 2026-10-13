import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./db";
import type {
  Load,
  LoadEvent,
  LoadStatus,
  Payout,
  PayoutDestination,
  PayoutKind,
  Proof,
  ProofKind,
  RateCon,
  Verdict,
  WalletState,
} from "./types";

const now = () => new Date().toISOString();

type LoadRow = {
  id: string;
  ref: string;
  status: LoadStatus;
  mode: "live" | "simulated";
  data: string;
  wallet: string;
  driver_token: string;
  created_at: string;
  updated_at: string;
};

const toLoad = (row: LoadRow): Load => ({
  id: row.id,
  ref: row.ref,
  status: row.status,
  mode: row.mode,
  rateCon: JSON.parse(row.data),
  wallet: JSON.parse(row.wallet),
  driverToken: row.driver_token,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function createLoad(rateCon: RateCon, mode: Load["mode"]): Load {
  const id = randomUUID();
  const driverToken = randomBytes(16).toString("base64url");
  const ts = now();
  db()
    .prepare(
      "INSERT INTO loads (id, ref, status, mode, data, wallet, driver_token, created_at, updated_at) VALUES (?, ?, 'provisioning', ?, ?, '{}', ?, ?, ?)",
    )
    .run(id, rateCon.loadNumber, mode, JSON.stringify(rateCon), driverToken, ts, ts);
  return getLoad(id)!;
}

export function getLoad(id: string): Load | undefined {
  const row = db().prepare("SELECT * FROM loads WHERE id = ?").get(id) as LoadRow | undefined;
  return row && toLoad(row);
}

export function getLoadByDriverToken(token: string): Load | undefined {
  const row = db().prepare("SELECT * FROM loads WHERE driver_token = ?").get(token) as LoadRow | undefined;
  return row && toLoad(row);
}

export function listLoads(): Load[] {
  return (db().prepare("SELECT * FROM loads ORDER BY created_at DESC").all() as LoadRow[]).map(toLoad);
}

export function setStatus(id: string, status: LoadStatus) {
  db().prepare("UPDATE loads SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
}

/** Merges into the stored wallet state. Reads and writes in one statement batch per call. */
export function patchWallet(id: string, patch: Partial<WalletState>): WalletState {
  const load = getLoad(id);
  if (!load) throw new Error(`load ${id} not found`);
  const wallet = { ...load.wallet, ...patch };
  db().prepare("UPDATE loads SET wallet = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(wallet), now(), id);
  return wallet;
}

export function recordIntent(id: string, entry: NonNullable<WalletState["intents"]>[number]) {
  const load = getLoad(id)!;
  const intents = (load.wallet.intents ?? []).filter((i) => i.correlationId !== entry.correlationId);
  patchWallet(id, { intents: [...intents, entry] });
}

// ── events ─────────────────────────────────────────────────────────────────────────────────

export function addEvent(
  loadId: string,
  actor: LoadEvent["actor"],
  type: string,
  title: string,
  detail: Record<string, unknown> = {},
) {
  db()
    .prepare("INSERT INTO events (load_id, ts, actor, type, title, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .run(loadId, now(), actor, type, title, JSON.stringify(detail));
  db().prepare("UPDATE loads SET updated_at = ? WHERE id = ?").run(now(), loadId);
}

export function listEvents(loadId: string): LoadEvent[] {
  const rows = db().prepare("SELECT * FROM events WHERE load_id = ? ORDER BY id ASC").all(loadId) as {
    id: number;
    load_id: string;
    ts: string;
    actor: LoadEvent["actor"];
    type: string;
    title: string;
    detail: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    loadId: r.load_id,
    ts: r.ts,
    actor: r.actor,
    type: r.type,
    title: r.title,
    detail: JSON.parse(r.detail),
  }));
}

export function countBlockedAttempts(): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM payouts WHERE status = 'BLOCKED'")
    .get() as { n: number };
  return row.n;
}

// ── payouts ────────────────────────────────────────────────────────────────────────────────

type PayoutRow = {
  id: string;
  load_id: string;
  kind: PayoutKind;
  amount_usd: number;
  amount_atomic: string;
  destination: string;
  status: string;
  correlation_id: string | null;
  idempotency_key: string;
  error_code: string | null;
  error_detail: string | null;
  trigger_proof_id: string | null;
  created_at: string;
  settled_at: string | null;
};

const toPayout = (r: PayoutRow): Payout => ({
  id: r.id,
  loadId: r.load_id,
  kind: r.kind,
  amountUsd: r.amount_usd,
  amountAtomic: r.amount_atomic,
  destination: JSON.parse(r.destination),
  status: r.status,
  correlationId: r.correlation_id,
  idempotencyKey: r.idempotency_key,
  errorCode: r.error_code,
  errorDetail: r.error_detail,
  triggerProofId: r.trigger_proof_id,
  createdAt: r.created_at,
  settledAt: r.settled_at,
});

/** Persist before dispatch: the idempotency key exists before the request is sent. */
export function createPayout(input: {
  loadId: string;
  kind: PayoutKind;
  amountUsd: number;
  amountAtomic: string;
  destination: PayoutDestination;
  triggerProofId?: string | null;
}): Payout {
  const id = randomUUID();
  const idempotencyKey = `load-${input.loadId.slice(0, 8)}-${input.kind}-${id.slice(0, 8)}`;
  db()
    .prepare(
      `INSERT INTO payouts (id, load_id, kind, amount_usd, amount_atomic, destination, status, idempotency_key, trigger_proof_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PREPARED', ?, ?, ?)`,
    )
    .run(
      id,
      input.loadId,
      input.kind,
      input.amountUsd,
      input.amountAtomic,
      JSON.stringify(input.destination),
      idempotencyKey,
      input.triggerProofId ?? null,
      now(),
    );
  return getPayout(id)!;
}

export function getPayout(id: string): Payout | undefined {
  const row = db().prepare("SELECT * FROM payouts WHERE id = ?").get(id) as PayoutRow | undefined;
  return row && toPayout(row);
}

export function updatePayout(
  id: string,
  patch: Partial<Pick<Payout, "status" | "correlationId" | "errorCode" | "errorDetail" | "settledAt">>,
) {
  const current = getPayout(id)!;
  const next = { ...current, ...patch };
  db()
    .prepare(
      "UPDATE payouts SET status = ?, correlation_id = ?, error_code = ?, error_detail = ?, settled_at = ? WHERE id = ?",
    )
    .run(next.status, next.correlationId, next.errorCode, next.errorDetail, next.settledAt, id);
  return getPayout(id)!;
}

export function listPayouts(loadId?: string): Payout[] {
  const rows = loadId
    ? db().prepare("SELECT * FROM payouts WHERE load_id = ? ORDER BY created_at ASC").all(loadId)
    : db().prepare("SELECT * FROM payouts ORDER BY created_at ASC").all();
  return (rows as PayoutRow[]).map(toPayout);
}

// ── proofs ─────────────────────────────────────────────────────────────────────────────────

type ProofRow = {
  id: string;
  load_id: string;
  kind: ProofKind;
  lat: number | null;
  lng: number | null;
  distance_m: number | null;
  simulated_location: number;
  files: string;
  data: string;
  verdict: string | null;
  created_at: string;
};

const toProof = (r: ProofRow): Proof => ({
  id: r.id,
  loadId: r.load_id,
  kind: r.kind,
  lat: r.lat,
  lng: r.lng,
  distanceM: r.distance_m,
  simulatedLocation: r.simulated_location === 1,
  files: JSON.parse(r.files),
  data: JSON.parse(r.data),
  verdict: r.verdict ? JSON.parse(r.verdict) : null,
  createdAt: r.created_at,
});

export function createProof(input: Omit<Proof, "createdAt" | "verdict"> & { verdict?: Verdict | null }) {
  db()
    .prepare(
      `INSERT INTO proofs (id, load_id, kind, lat, lng, distance_m, simulated_location, files, data, verdict, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.loadId,
      input.kind,
      input.lat,
      input.lng,
      input.distanceM,
      input.simulatedLocation ? 1 : 0,
      JSON.stringify(input.files),
      JSON.stringify(input.data),
      input.verdict ? JSON.stringify(input.verdict) : null,
      now(),
    );
  return getProof(input.id)!;
}

export function getProof(id: string): Proof | undefined {
  const row = db().prepare("SELECT * FROM proofs WHERE id = ?").get(id) as ProofRow | undefined;
  return row && toProof(row);
}

export function setVerdict(id: string, verdict: Verdict) {
  db().prepare("UPDATE proofs SET verdict = ? WHERE id = ?").run(JSON.stringify(verdict), id);
}

export function listProofs(loadId: string): Proof[] {
  return (
    db().prepare("SELECT * FROM proofs WHERE load_id = ? ORDER BY created_at ASC").all(loadId) as ProofRow[]
  ).map(toProof);
}

export function latestProof(loadId: string, kind: ProofKind): Proof | undefined {
  const row = db()
    .prepare("SELECT * FROM proofs WHERE load_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1")
    .get(loadId, kind) as ProofRow | undefined;
  return row && toProof(row);
}

/** The most recent proof of a kind that the agent (or broker) approved. */
export function latestApprovedProof(loadId: string, kind: ProofKind): Proof | undefined {
  return listProofs(loadId)
    .filter((p) => p.kind === kind && p.verdict?.decision === "approve")
    .at(-1);
}
