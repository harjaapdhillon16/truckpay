import type { NextRequest } from "next/server";
import { errorResponse, originOf } from "@/lib/http";
import { getLoad } from "@/lib/store";
import { loadDetail } from "@/lib/views";
import { refreshInFlightPayouts, syncWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";

const SYNC_EVERY_MS = 8_000;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/loads/[id]">) {
  const { id } = await ctx.params;
  let load = getLoad(id);
  if (!load) return Response.json({ error: { code: "not_found", detail: "No such load" } }, { status: 404 });

  // Live wallets are read lazily: balance while waiting for the deposit, statuses of payouts in flight.
  if (load.mode === "live" && load.wallet.agentId) {
    const stale = !load.wallet.balanceCheckedAt || Date.now() - Date.parse(load.wallet.balanceCheckedAt) > SYNC_EVERY_MS;
    try {
      if (stale && load.status !== "closed") load = await syncWallet(id);
      await refreshInFlightPayouts(id);
      load = getLoad(id)!;
    } catch (error) {
      console.error("[sync]", error);
    }
  }
  try {
    return Response.json(loadDetail(load, originOf(req)));
  } catch (error) {
    return errorResponse(error, 500);
  }
}
