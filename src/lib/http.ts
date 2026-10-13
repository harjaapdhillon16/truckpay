import "server-only";
import { AgentRefusal } from "./agent";
import { describeError } from "./wallet";

export function originOf(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function errorResponse(error: unknown, status = 400) {
  if (error instanceof AgentRefusal) return Response.json({ error: { code: error.code, detail: error.message } }, { status: 409 });
  const described = describeError(error);
  console.error("[api]", described.code, described.detail);
  return Response.json({ error: described }, { status });
}
