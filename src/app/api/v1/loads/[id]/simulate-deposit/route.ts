import { simulateDeposit } from "@/server/agent";
import { companyRoute, originOf } from "@/server/http";
import { companyLoadView } from "@/server/views";

/** Simulated mode only. */
export const POST = companyRoute(async (req, ctx: RouteContext<"/api/v1/loads/[id]/simulate-deposit">) => {
  const { id } = await ctx.params;
  return Response.json(await companyLoadView(await simulateDeposit(id), originOf(req)));
});
