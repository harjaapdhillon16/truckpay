import { fraudTest } from "@/server/agent";
import { companyRoute } from "@/server/http";

/** Demo only. Returns the blocked payment attempt; moves no money. */
export const POST = companyRoute(async (_req, ctx: RouteContext<"/api/v1/loads/[id]/fraud-test">) => {
  const { id } = await ctx.params;
  return Response.json({ attempt: await fraudTest(id) });
});
