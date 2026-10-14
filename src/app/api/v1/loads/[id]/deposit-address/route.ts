import { advance } from "@/server/agent";
import { companyRoute, fail } from "@/server/http";
import { getLoad } from "@/server/store";

/** The load wallet's deposit address. Issued automatically during wallet setup; this returns it. */
export const POST = companyRoute(async (_req, ctx: RouteContext<"/api/v1/loads/[id]/deposit-address">) => {
  const { id } = await ctx.params;
  let load = await getLoad(id);
  if (!load) return fail("not_found", "No such load.", 404);
  if (!load.wallet.deposit) {
    await advance(id);
    load = (await getLoad(id))!;
  }
  if (!load.wallet.deposit) return fail("wallet_not_ready", "The wallet is still being set up. Try again in a few seconds.", 409);
  return Response.json({ deposit: load.wallet.deposit, amountAtomic: load.rateAtomic });
});
