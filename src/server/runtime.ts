import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SqlDatabase } from "./sql";

/**
 * Everything the server needs from its host: config, secrets, the database, the proof bucket and
 * a way to keep working after the response. On Cloudflare these come from the Worker bindings; in
 * `next dev` OpenNext provides local D1/R2; tests inject their own.
 */

export type Bucket = {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; size: number } | null>;
};

export type Runtime = {
  env: Record<string, unknown>;
  db: SqlDatabase;
  bucket: Bucket;
  waitUntil(promise: Promise<unknown>): void;
};

let testRuntime: Runtime | null = null;

/** Tests only: replace the Cloudflare bindings. */
export function setRuntimeForTests(runtime: Runtime | null) {
  testRuntime = runtime;
}

export async function runtime(): Promise<Runtime> {
  if (testRuntime) return testRuntime;
  const { env, ctx } = await getCloudflareContext({ async: true });
  const bindings = env as unknown as Record<string, unknown>;
  return {
    env: bindings,
    db: bindings.DB as SqlDatabase,
    bucket: bindings.PROOFS as Bucket,
    waitUntil: (p) => ctx.waitUntil(p.catch((error) => console.error("[background]", error))),
  };
}

/** A config value: Worker var or secret first, then process env (`.env.local` in `next dev`). */
export async function setting(name: string): Promise<string | undefined> {
  const { env } = await runtime();
  const value = (typeof env[name] === "string" ? (env[name] as string) : undefined) ?? process.env[name];
  return value?.trim() ? value.trim() : undefined;
}

export async function requiredSetting(name: string): Promise<string> {
  const value = await setting(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
