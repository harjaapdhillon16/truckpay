import { TERMINAL_LOAD_STATUSES } from "@/lib/domain";
import { advance } from "@/server/agent";
import { companyRoute, fail, originOf } from "@/server/http";
import { runtime } from "@/server/runtime";
import { getLoad } from "@/server/store";
import { companyLoadView } from "@/server/views";

export const GET = companyRoute(async (req, ctx: RouteContext<"/api/v1/loads/[id]">) => {
  const { id } = await ctx.params;
  const load = await getLoad(id);
  if (!load) return fail("not_found", "No such load.", 404);
  // Reading a load nudges it forward; the response shows the state as of now.
  if (!TERMINAL_LOAD_STATUSES.includes(load.status)) (await runtime()).waitUntil(advance(id));
  return Response.json(await companyLoadView(load, originOf(req)));
});
