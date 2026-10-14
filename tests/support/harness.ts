import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bucket } from "@/server/runtime";
import { setRuntimeForTests } from "@/server/runtime";
import type { SqlDatabase, SqlStatement } from "@/server/sql";
import { simulator } from "@/server/gateway/simulated";
import { type AiReview, setAiReviewerForTests } from "@/server/verifier";

/**
 * Drives LoadWallet through its HTTP API v1, exactly as the UI or an agent harness would, with
 * D1 replaced by node:sqlite, R2 by memory, Agent Connect by the simulated gateway and the
 * model call by a fixture verdict.
 */

function d1(db: DatabaseSync): SqlDatabase {
  const statement = (sql: string, params: unknown[] = []): SqlStatement => ({
    bind: (...values) => statement(sql, values),
    first: async <T,>() => (db.prepare(sql).get(...(params as never[])) as T) ?? null,
    all: async <T,>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(params as never[])).changes) } }),
  });
  return { prepare: (sql) => statement(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

function memoryBucket(): Bucket {
  const objects = new Map<string, { data: Uint8Array; type?: string }>();
  return {
    put: async (key, value, options) => {
      objects.set(key, { data: new Uint8Array(value as ArrayBuffer), type: options?.httpMetadata?.contentType });
    },
    get: async (key) => {
      const o = objects.get(key);
      return o ? { arrayBuffer: async () => o.data.slice().buffer, httpMetadata: { contentType: o.type }, size: o.data.length } : null;
    },
  };
}

export const DELIVERY = { name: "Lone Star Grocers", address: "2501 Irving Blvd, Dallas, TX 75207", lat: 32.7922, lng: -96.8461 };
export const CARRIER = { name: "Swift Lane Trucking", payout: { kind: "transfer", account: "swiftlane-trucking.near" } };

export function setup(env: Record<string, string> = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(path.resolve(__dirname, "../../migrations/0001_init.sql"), "utf8"));
  const pending: Promise<unknown>[] = [];
  simulator.reset();
  setRuntimeForTests({
    env: {
      AGENT_CONNECT_MODE: "simulated",
      BROKER_OWNER_EVM_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      GRANT_SEALING_KEY: Buffer.alloc(32, 7).toString("base64"),
      COMPANY_REFUND_NEAR_ACCOUNT: "acme-refunds.near",
      SETTLEMENT_SCALE: "0.001",
      DEMO_FEATURES: "true",
      ...env,
    },
    db: d1(sqlite),
    bucket: memoryBucket(),
    waitUntil: (p) => void pending.push(p),
  });
  let verdict: AiReview = { decision: "approve", confidence: 0.95, summary: "Signed BOL for this load.", checks: [] };
  setAiReviewerForTests(async () => verdict);
  return {
    setAiVerdict(next: Partial<AiReview>) {
      verdict = { ...verdict, ...next };
    },
    /** Waits for every background step the requests started. */
    async settle() {
      while (pending.length) await Promise.allSettled(pending.splice(0));
    },
  };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(handler: Handler, init: { method?: string; url?: string; params?: Record<string, string>; json?: unknown; form?: FormData; headers?: Record<string, string> } = {}) {
  const req = new Request(init.url ?? "https://loadwallet.test/api/v1/x", {
    method: init.method ?? (init.json || init.form ? "POST" : "GET"),
    headers: { ...(init.json ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.json ? JSON.stringify(init.json) : init.form,
  });
  const res = await handler(req, { params: Promise.resolve(init.params ?? {}) });
  // Tests read response fields freely; the assertions are the type check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

export function proofForm(at: { lat: number; lng: number }) {
  const form = new FormData();
  form.set("lat", String(at.lat));
  form.set("lng", String(at.lng));
  form.set("accuracy_m", "12");
  form.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "bol.jpg", { type: "image/jpeg" }));
  return form;
}
