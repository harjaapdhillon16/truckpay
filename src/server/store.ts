import "server-only";
import type {
  Carrier,
  DeliveryStop,
  Destination,
  Load,
  LoadEvent,
  LoadStatus,
  Payment,
  PaymentKind,
  Proof,
  ProofStatus,
  Verdict,
  WalletState,
} from "@/lib/domain";
import { runtime } from "./runtime";

/** Loads, owner intents, payments, proofs and events in D1. Agent Connect stays the source of truth for money. */

const now = () => new Date().toISOString();
const db = async () => (await runtime()).db;
const json = (value: unknown) => JSON.stringify(value ?? {});

// ── loads ──────────────────────────────────────────────────────────────────────────────────

type LoadRow = {
  id: string;
  number: string;
  status: LoadStatus;
  mode: "live" | "simulated";
  rate_usd: number;
  rate_atomic: string;
  delivery: string;
  carrier: string;
  wallet: string;
  driver_token: string;
  failure: string | null;
  created_at: string;
  updated_at: string;
};

const toLoad = (r: LoadRow): Load => ({
  id: r.id,
  number: r.number,
  status: r.status,
  mode: r.mode,
  rateUsd: r.rate_usd,
  rateAtomic: r.rate_atomic,
  delivery: JSON.parse(r.delivery),
  carrier: JSON.parse(r.carrier),
  wallet: JSON.parse(r.wallet),
  driverToken: r.driver_token,
  failure: r.failure,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function insertLoad(input: {
  id: string;
  number: string;
  mode: Load["mode"];
  rateUsd: number;
  rateAtomic: string;
  delivery: DeliveryStop;
  carrier: Carrier;
  driverToken: string;
  createKey: string | null;
  testMoney: boolean;
}) {
  const ts = now();
  await (await db())
    .prepare(
      `INSERT INTO loads (id, number, status, mode, rate_usd, rate_atomic, delivery, carrier, wallet, driver_token, create_key, created_at, updated_at)
       VALUES (?, ?, 'wallet_pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.number,
      input.mode,
      input.rateUsd,
      input.rateAtomic,
      json(input.delivery),
      json(input.carrier),
      json({ phase: "create", testMoney: input.testMoney } satisfies WalletState),
      input.driverToken,
      input.createKey,
      ts,
      ts,
    )
    .run();
}

export async function getLoad(id: string) {
  const row = await (await db()).prepare("SELECT * FROM loads WHERE id = ?").bind(id).first<LoadRow>();
  return row ? toLoad(row) : null;
}

export async function getLoadByCreateKey(key: string) {
  const row = await (await db()).prepare("SELECT * FROM loads WHERE create_key = ?").bind(key).first<LoadRow>();
  return row ? toLoad(row) : null;
}

export async function getLoadByDriverToken(token: string) {
  const row = await (await db()).prepare("SELECT * FROM loads WHERE driver_token = ?").bind(token).first<LoadRow>();
  return row ? toLoad(row) : null;
}

export async function listLoads() {
  const { results } = await (await db()).prepare("SELECT * FROM loads ORDER BY created_at DESC LIMIT 200").all<LoadRow>();
  return results.map(toLoad);
}

export async function listLoadsInFlight() {
  const { results } = await (await db())
    .prepare("SELECT * FROM loads WHERE status NOT IN ('paid', 'cancelled', 'failed', 'funded', 'needs_review') ORDER BY updated_at ASC LIMIT 25")
    .all<LoadRow>();
  return results.map(toLoad);
}

export async function updateLoad(id: string, patch: { status?: LoadStatus; wallet?: WalletState; failure?: string | null }) {
  const current = await getLoad(id);
  if (!current) throw new Error(`load ${id} not found`);
  await (await db())
    .prepare("UPDATE loads SET status = ?, wallet = ?, failure = ?, updated_at = ? WHERE id = ?")
    .bind(
      patch.status ?? current.status,
      json(patch.wallet ?? current.wallet),
      patch.failure === undefined ? current.failure : patch.failure,
      now(),
      id,
    )
    .run();
  return (await getLoad(id))!;
}

export async function patchWallet(id: string, patch: Partial<WalletState>) {
  const current = (await getLoad(id))!;
  return updateLoad(id, { wallet: { ...current.wallet, ...patch } });
}

/** Moves a load between statuses only if it is still in `from`. Returns false if someone else moved it first. */
export async function transition(id: string, from: LoadStatus[], to: LoadStatus, failure?: string | null) {
  const placeholders = from.map(() => "?").join(", ");
  const result = await (await db())
    .prepare(`UPDATE loads SET status = ?, failure = COALESCE(?, failure), updated_at = ? WHERE id = ? AND status IN (${placeholders})`)
    .bind(to, failure ?? null, now(), id, ...from)
    .run();
  return result.meta.changes === 1;
}

/** A short exclusive lease so overlapping ticks never advance the same load twice. */
export async function acquireLease(id: string, ms: number) {
  const nowMs = Date.now();
  const result = await (await db())
    .prepare("UPDATE loads SET lease_until = ? WHERE id = ? AND lease_until < ?")
    .bind(nowMs + ms, id, nowMs)
    .run();
  return result.meta.changes === 1;
}

export async function releaseLease(id: string) {
  await (await db()).prepare("UPDATE loads SET lease_until = 0 WHERE id = ?").bind(id).run();
}

// ── owner intents ──────────────────────────────────────────────────────────────────────────

export type OwnerIntentRecord = { correlationId: string; type: string; status: string; summary: string | null; createdAt: string };

export async function upsertOwnerIntent(loadId: string, intent: { correlationId: string; type: string; status: string; summary?: string | null }) {
  const ts = now();
  await (await db())
    .prepare(
      `INSERT INTO owner_intents (correlation_id, load_id, type, status, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(correlation_id) DO UPDATE SET status = excluded.status, summary = COALESCE(excluded.summary, owner_intents.summary), updated_at = excluded.updated_at`,
    )
    .bind(intent.correlationId, loadId, intent.type, intent.status, intent.summary ?? null, ts, ts)
    .run();
}

export async function listOwnerIntents(loadId: string): Promise<OwnerIntentRecord[]> {
  const { results } = await (await db())
    .prepare("SELECT * FROM owner_intents WHERE load_id = ? ORDER BY created_at ASC")
    .bind(loadId)
    .all<{ correlation_id: string; type: string; status: string; summary: string | null; created_at: string }>();
  return results.map((r) => ({ correlationId: r.correlation_id, type: r.type, status: r.status, summary: r.summary, createdAt: r.created_at }));
}

// ── payments ───────────────────────────────────────────────────────────────────────────────

type PaymentRow = {
  id: string;
  load_id: string;
  kind: PaymentKind;
  amount_usd: number;
  amount_atomic: string;
  destination: string;
  status: string;
  correlation_id: string | null;
  idempotency_key: string;
  error_code: string | null;
  error_detail: string | null;
  proof_id: string | null;
  created_at: string;
  settled_at: string | null;
  test: number;
  policy_check: string | null;
};

const toPayment = (r: PaymentRow): Payment => ({
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
  proofId: r.proof_id,
  createdAt: r.created_at,
  settledAt: r.settled_at,
  test: r.test === 1,
  policyCheck: r.policy_check ? JSON.parse(r.policy_check) : null,
});

/**
 * Persists a payment (with its idempotency key) before anything is sent. For `payment` and
 * `refund` a unique index allows one per load; a second insert returns the existing row.
 */
export async function insertPayment(input: {
  loadId: string;
  kind: PaymentKind;
  amountUsd: number;
  amountAtomic: string;
  destination: Destination;
  proofId?: string | null;
}): Promise<Payment> {
  const id = crypto.randomUUID();
  const key = `lw-${input.kind}-${id}`;
  await (await db())
    .prepare(
      `INSERT INTO payments (id, load_id, kind, amount_usd, amount_atomic, destination, status, idempotency_key, proof_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(id, input.loadId, input.kind, input.amountUsd, input.amountAtomic, json(input.destination), key, input.proofId ?? null, now())
    .run();
  const created = await getPayment(id);
  if (created) return created;
  return (await findPayment(input.loadId, input.kind))!;
}

export async function getPayment(id: string) {
  const row = await (await db()).prepare("SELECT * FROM payments WHERE id = ?").bind(id).first<PaymentRow>();
  return row ? toPayment(row) : null;
}

export async function findPayment(loadId: string, kind: PaymentKind) {
  const row = await (await db())
    .prepare("SELECT * FROM payments WHERE load_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1")
    .bind(loadId, kind)
    .first<PaymentRow>();
  return row ? toPayment(row) : null;
}

export async function listPayments(loadId: string) {
  const { results } = await (await db())
    .prepare("SELECT * FROM payments WHERE load_id = ? ORDER BY created_at ASC")
    .bind(loadId)
    .all<PaymentRow>();
  return results.map(toPayment);
}

export async function updatePayment(
  id: string,
  patch: Partial<Pick<Payment, "status" | "correlationId" | "errorCode" | "errorDetail" | "settledAt" | "test" | "policyCheck">>,
) {
  const current = (await getPayment(id))!;
  const next = { ...current, ...patch };
  await (await db())
    .prepare("UPDATE payments SET status = ?, correlation_id = ?, error_code = ?, error_detail = ?, settled_at = ?, test = ?, policy_check = ? WHERE id = ?")
    .bind(next.status, next.correlationId, next.errorCode, next.errorDetail, next.settledAt, next.test ? 1 : 0, next.policyCheck ? json(next.policyCheck) : null, id)
    .run();
  return (await getPayment(id))!;
}

// ── proofs ─────────────────────────────────────────────────────────────────────────────────

type ProofRow = {
  id: string;
  load_id: string;
  status: ProofStatus;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  distance_m: number;
  files: string;
  verdict: string | null;
  review_note: string | null;
  verify_started_at: number;
  created_at: string;
  decided_at: string | null;
};

const toProof = (r: ProofRow): Proof => ({
  id: r.id,
  loadId: r.load_id,
  status: r.status,
  lat: r.lat,
  lng: r.lng,
  accuracyM: r.accuracy_m,
  distanceM: r.distance_m,
  files: JSON.parse(r.files),
  verdict: r.verdict ? JSON.parse(r.verdict) : null,
  reviewNote: r.review_note,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

export async function insertProof(input: {
  id: string;
  loadId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  distanceM: number;
  files: Proof["files"];
  idempotencyKey: string | null;
}) {
  await (await db())
    .prepare(
      `INSERT INTO proofs (id, load_id, status, lat, lng, accuracy_m, distance_m, files, idempotency_key, verify_started_at, created_at)
       VALUES (?, ?, 'verifying', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.loadId, input.lat, input.lng, input.accuracyM, input.distanceM, json(input.files), input.idempotencyKey, Date.now(), now())
    .run();
  return (await getProof(input.id))!;
}

export async function getProof(id: string) {
  const row = await (await db()).prepare("SELECT * FROM proofs WHERE id = ?").bind(id).first<ProofRow>();
  return row ? toProof(row) : null;
}

export async function getProofByKey(key: string) {
  const row = await (await db()).prepare("SELECT * FROM proofs WHERE idempotency_key = ?").bind(key).first<ProofRow>();
  return row ? toProof(row) : null;
}

export async function latestProof(loadId: string) {
  const row = await (await db())
    .prepare("SELECT * FROM proofs WHERE load_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(loadId)
    .first<ProofRow>();
  return row ? toProof(row) : null;
}

export async function staleVerifyingProof(loadId: string, olderThanMs: number) {
  const row = await (await db())
    .prepare("SELECT * FROM proofs WHERE load_id = ? AND status = 'verifying' AND verify_started_at < ? ORDER BY created_at DESC LIMIT 1")
    .bind(loadId, Date.now() - olderThanMs)
    .first<ProofRow>();
  return row ? toProof(row) : null;
}

export async function markVerifyStarted(id: string) {
  await (await db()).prepare("UPDATE proofs SET verify_started_at = ? WHERE id = ?").bind(Date.now(), id).run();
}

export async function listProofs(loadId: string) {
  const { results } = await (await db())
    .prepare("SELECT * FROM proofs WHERE load_id = ? ORDER BY created_at ASC")
    .bind(loadId)
    .all<ProofRow>();
  return results.map(toProof);
}

export async function decideProof(id: string, status: ProofStatus, verdict: Verdict | null, reviewNote?: string) {
  await (await db())
    .prepare("UPDATE proofs SET status = ?, verdict = COALESCE(?, verdict), review_note = COALESCE(?, review_note), decided_at = ? WHERE id = ?")
    .bind(status, verdict ? json(verdict) : null, reviewNote ?? null, now(), id)
    .run();
  return (await getProof(id))!;
}

// ── events ─────────────────────────────────────────────────────────────────────────────────

export async function addEvent(loadId: string, actor: LoadEvent["actor"], type: string, title: string, detail: Record<string, unknown> = {}) {
  await (await db())
    .prepare("INSERT INTO events (load_id, ts, actor, type, title, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(loadId, now(), actor, type, title, json(detail))
    .run();
}

export async function listEvents(loadId: string): Promise<LoadEvent[]> {
  const { results } = await (await db())
    .prepare("SELECT * FROM events WHERE load_id = ? ORDER BY id ASC")
    .bind(loadId)
    .all<{ id: number; ts: string; actor: LoadEvent["actor"]; type: string; title: string; detail: string }>();
  return results.map((r) => ({ id: r.id, ts: r.ts, actor: r.actor, type: r.type, title: r.title, detail: JSON.parse(r.detail) }));
}
