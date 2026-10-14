import "server-only";
import { z } from "zod";
import { AgentRefusal } from "./agent";
import { secrets } from "./config";
import { GatewayError } from "./gateway";

/** Stable JSON errors: `{ error: { code, detail } }`. Clients branch on `code`. */
export function fail(code: string, detail: string, status = 400) {
  return Response.json({ error: { code, detail } }, { status });
}

export function handleError(error: unknown) {
  if (error instanceof AgentRefusal) return fail(error.code, error.message, error.status);
  if (error instanceof z.ZodError) return fail("validation_error", error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), 400);
  if (error instanceof GatewayError) return fail(error.code, error.detail, error.retryable ? 503 : 409);
  console.error("[api]", error);
  return fail("internal_error", error instanceof Error ? error.message : "Unexpected error", 500);
}

export function originOf(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

// ── company session ────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = "lw_session";

async function sessionToken(passcode: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("loadwallet-company-v1")));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sessionCookieFor(passcode: string) {
  const value = await sessionToken(passcode);
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Company scope: a session cookie from the passcode screen, or `Authorization: Bearer <passcode>`
 * for scripts and agent harnesses. With no passcode configured (local dev) everything is open.
 */
export async function isCompany(req: Request) {
  const passcode = await secrets.passcode();
  if (!passcode) return true;
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (bearer && constantTimeEqual(bearer, passcode)) return true;
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([a-f0-9]+)`))?.[1];
  return Boolean(cookie && constantTimeEqual(cookie, await sessionToken(passcode)));
}

export async function checkPasscode(candidate: string) {
  const passcode = await secrets.passcode();
  return !passcode || constantTimeEqual(candidate, passcode);
}

/** Wraps a company-scoped handler with auth and error handling. */
export function companyRoute<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    if (!(await isCompany(req))) return fail("unauthorized", "Sign in with the company passcode.", 401);
    try {
      return await handler(req, ctx);
    } catch (error) {
      return handleError(error);
    }
  };
}

export function publicRoute<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return handleError(error);
    }
  };
}
