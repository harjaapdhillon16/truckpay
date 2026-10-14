import { advance } from "@/server/agent";
import { secrets } from "@/server/config";
import { fail, publicRoute } from "@/server/http";
import { listLoadsInFlight } from "@/server/store";

/** Called by the Worker cron every minute: advances every load still in flight. */
export const POST = publicRoute(async (req) => {
  const secret = await secrets.tickSecret();
  if (!secret || req.headers.get("x-tick-secret") !== secret) return fail("forbidden", "Not allowed.", 403);
  const loads = await listLoadsInFlight();
  await Promise.allSettled(loads.map((l) => advance(l.id)));
  return Response.json({ advanced: loads.length });
});
