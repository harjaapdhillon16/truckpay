import { cancelLoad } from "@/server/agent";
import { companyRoute, originOf } from "@/server/http";
import { companyLoadView } from "@/server/views";

export const POST = companyRoute(async (req, ctx: RouteContext<"/api/v1/loads/[id]/cancel">) => {
  const { id } = await ctx.params;
  return Response.json(await companyLoadView(await cancelLoad(id), originOf(req)));
});
