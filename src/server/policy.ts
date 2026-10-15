import "server-only";
import type { Destination as PolicyDestination, Policy } from "@near-intents-agent-api/sdk";
import type { Destination, PolicyCheck } from "@/lib/domain";

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


function samePolicyDestination(a: PolicyDestination, b: PolicyDestination) {
  if (a.action !== b.action) return false;
  if (a.action === "transfer" && b.action === "transfer") return a.address === b.address;
  if (a.action === "withdraw" && b.action === "withdraw") return a.chain === b.chain && a.address === b.address && (a.memo ?? null) === (b.memo ?? null);
  return false;
}

/**
 * Evaluates one payment against a signed policy the way Agent Connect does (action, asset,
 * destination, per-payment limit). Used by the simulated wallet, and in test-money mode for
 * payments Agent Connect can't quote (transfers have no dry run).
 */
export type { PolicyCheck };

export function evaluatePolicy(policy: Policy, payment: { asset: string; amountAtomic: string; destination: Destination }): PolicyCheck {
  const dest = toPolicyDestination(payment.destination);
  const perTx = policy.limits.per_transaction?.[payment.asset];
  const checks = [
    { name: "Wallet not frozen", passed: !policy.frozen },
    { name: `${dest.action === "transfer" ? "Transfers" : "Withdrawals"} allowed`, passed: policy.actions.includes(dest.action) },
    { name: "USDC allowed", passed: policy.assets === "any" || policy.assets.includes(payment.asset) },
    { name: "Destination allowed", passed: policy.destinations.mode !== "only" || policy.destinations.list.some((d) => samePolicyDestination(d, dest)) },
    { name: "Within per-payment limit", passed: !perTx || BigInt(payment.amountAtomic) <= BigInt(perTx) },
  ];
  const failed = checks.find((c) => !c.passed);
  const code = !failed
    ? null
    : failed.name === "Wallet not frozen"
      ? "agent_frozen"
      : failed.name === "Destination allowed"
        ? "policy_destination_denied"
        : failed.name.endsWith("allowed") && failed.name !== "USDC allowed"
          ? "policy_action_denied"
          : "policy_denied";
  return { allowed: !failed, code, detail: failed ? `${failed.name}: refused by the wallet policy.` : "Allowed by the wallet policy.", checks, source: "signed_policy" };
}
