import "server-only";
import type { Destination, Policy } from "@near-intents-agent-api/sdk";
import { config } from "./config";
import { usdToAtomic } from "./money";
import type { PayoutDestination, RateCon } from "./types";
import { totalCommittedUsd } from "./types";

/** EVM addresses must be canonical lowercase in a policy; other chains keep their case. */
const EVM_CHAINS = new Set(["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "monad", "xlayer", "scroll"]);

export function toDestination(dest: PayoutDestination): Destination {
  if (dest.kind === "transfer") return { action: "transfer", address: dest.address.trim(), confidential: false };
  const address = EVM_CHAINS.has(dest.chain) ? dest.address.trim().toLowerCase() : dest.address.trim();
  return { action: "withdraw", chain: dest.chain, address, memo: dest.memo || null };
}

export function payoutDestinations(rc: RateCon): PayoutDestination[] {
  return [rc.carrier.payout, rc.brokerRefund, ...(rc.lumperService ? [rc.lumperService] : [])];
}

/**
 * The wallet's rulebook for one load, signed by the broker once at booking.
 *
 * Agent Connect enforces these no matter what the load agent asks for:
 * - only USDC, only transfer/withdraw (no swaps, no speculation);
 * - only the carrier's verified account, the approved lumper service and the broker's refund
 *   address; a spoofed "new bank details" email cannot add a destination;
 * - no single payment above the committed total, and a USD budget equal to the committed total.
 *
 * The load-specific rules (30% fuel advance after the pickup geofence, detention after free time,
 * final payment on a verified POD) are enforced by the load agent on top, inside these caps.
 */
export function buildLoadPolicy(rc: RateCon): Policy {
  const asset = config.payoutAsset;
  const destinations = payoutDestinations(rc);
  const total = totalCommittedUsd(rc);
  const totalAtomic = usdToAtomic(total, config.settlementScale, config.payoutAssetDecimals);
  // Budget is valued at the live USDC price (≈ $0.9998), so leave 2% headroom for price drift.
  const budgetUsd = (total * config.settlementScale * 1.02).toFixed(2);

  const actions = new Set<"transfer" | "withdraw">();
  for (const d of destinations) actions.add(d.kind);

  return {
    frozen: false,
    actions: [...actions],
    confidential: false,
    owner_approval: false,
    assets: [asset],
    limits: { per_transaction: { [asset]: totalAtomic.toString() } },
    max_actions_per_hour: 12,
    destinations: { mode: "only", list: destinations.map(toDestination) },
    budget: { daily_usd: budgetUsd, weekly_usd: null, monthly_usd: budgetUsd },
    timelock_ms: 0,
  };
}

export function sameDestination(a: Destination, b: Destination) {
  if (a.action !== b.action) return false;
  if (a.action === "transfer" && b.action === "transfer") return a.address === b.address;
  if (a.action === "withdraw" && b.action === "withdraw")
    return a.chain === b.chain && a.address === b.address && (a.memo ?? null) === (b.memo ?? null);
  return false;
}
