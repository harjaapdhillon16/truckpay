import "server-only";
import type { Destination as PolicyDestination, Policy } from "@near-intents-agent-api/sdk";
import type { Destination } from "@/lib/domain";

export function toPolicyDestination(d: Destination): PolicyDestination {
  return d.kind === "transfer"
    ? { action: "transfer", address: d.account.trim(), confidential: false }
    : { action: "withdraw", chain: d.chain, address: d.address.trim().toLowerCase(), memo: null };
}

/**
 * The rules one load wallet lives by, signed once by the company key at booking. Agent Connect
 * enforces them on every payment, whatever the load agent asks for:
 * USDC only; pay only the carrier or refund the company; never more than the load rate in one
 * payment; a USD budget of the rate (plus 2% for USDC price drift); a few payouts an hour at most.
 */
export function buildLoadPolicy(input: {
  asset: string;
  rateAtomic: string;
  rateOnChainUsd: number;
  carrier: Destination;
  refund: Destination;
}): Policy {
  const destinations = [input.carrier, input.refund];
  const budgetUsd = (input.rateOnChainUsd * 1.02).toFixed(2);
  return {
    frozen: false,
    actions: [...new Set(destinations.map((d) => d.kind))],
    confidential: false,
    owner_approval: false,
    assets: [input.asset],
    limits: { per_transaction: { [input.asset]: input.rateAtomic } },
    max_actions_per_hour: 6,
    destinations: { mode: "only", list: destinations.map(toPolicyDestination) },
    budget: { daily_usd: budgetUsd, weekly_usd: null, monthly_usd: budgetUsd },
    timelock_ms: 0,
  };
}
