import { z } from "zod";
import { reviewProof } from "@/server/agent";
import { companyRoute, originOf } from "@/server/http";
import { companyLoadView } from "@/server/views";

const Review = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).default("") });

export const POST = companyRoute(async (req, ctx: RouteContext<"/api/v1/loads/[id]/proofs/[proofId]/review">) => {
  const { id, proofId } = await ctx.params;
  const { decision, note } = Review.parse(await req.json());
  const load = await reviewProof(id, proofId, decision, note);
  return Response.json(await companyLoadView(load, originOf(req)));
});
