import { TERMINAL_LOAD_STATUSES } from "@/lib/domain";
import { advance } from "@/server/agent";
import { fail, publicRoute } from "@/server/http";
import { runtime } from "@/server/runtime";
import { getLoadByDriverToken } from "@/server/store";
import { driverView } from "@/server/views";

/** Driver scope: the token in the link is the credential and opens exactly one load. */
export const GET = publicRoute(async (_req, ctx: RouteContext<"/api/v1/driver/[token]">) => {
  const { token } = await ctx.params;
  const load = await getLoadByDriverToken(token);
  if (!load) return fail("not_found", "This driver link is not valid.", 404);
  if (!TERMINAL_LOAD_STATUSES.includes(load.status)) (await runtime()).waitUntil(advance(load.id));
  return Response.json(await driverView(load));
});
