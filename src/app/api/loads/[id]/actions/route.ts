import type { NextRequest } from "next/server";
import { z } from "zod";
import { attemptOvercap, attemptRedirect, brokerReview, closeLoad } from "@/lib/agent";
import { errorResponse, originOf } from "@/lib/http";
import { getLoad } from "@/lib/store";
import { loadDetail } from "@/lib/views";
import { createDeposit, isProvisioning, provisionWallet, simulateDeposit, syncWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deposit_address") }),
  z.object({ action: z.literal("simulate_deposit") }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("retry_provisioning") }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("fraud_redirect"), address: z.string().min(2).max(64).optional() }),
  z.object({ action: z.literal("overcap") }),
  z.object({
    action: z.literal("review"),
    proofId: z.string(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().max(500).default(""),
  }),
]);

export async function POST(req: NextRequest, ctx: RouteContext<"/api/loads/[id]/actions">) {
  const { id } = await ctx.params;
  const load = getLoad(id);
  if (!load) return Response.json({ error: { code: "not_found", detail: "No such load" } }, { status: 404 });
  try {
    const body = Action.parse(await req.json());
    switch (body.action) {
      case "deposit_address":
        await createDeposit(id);
        break;
      case "simulate_deposit":
        simulateDeposit(id);
        break;
      case "sync":
        await syncWallet(id);
        break;
      case "retry_provisioning":
        if (load.status !== "provisioning" && load.status !== "failed")
          return Response.json({ error: { code: "already_provisioned", detail: "This wallet is already set up." } }, { status: 409 });
        if (isProvisioning(id))
          return Response.json({ error: { code: "provisioning_in_progress", detail: "Wallet setup is still running." } }, { status: 409 });
        void provisionWallet(id);
        break;
      case "close":
        await closeLoad(load);
        break;
      case "fraud_redirect":
        await attemptRedirect(load, {
          kind: "transfer",
          label: "Attacker (spoofed bank change)",
          address: body.address ?? "carrier-payments-update.near",
        });
        break;
      case "overcap":
        await attemptOvercap(load);
        break;
      case "review":
        await brokerReview(load, body.proofId, body.decision, body.note);
        break;
    }
    return Response.json(loadDetail(getLoad(id)!, originOf(req)));
  } catch (error) {
    return errorResponse(error);
  }
}
