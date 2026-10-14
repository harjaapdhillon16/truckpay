import "server-only";
import type { Policy } from "@near-intents-agent-api/sdk";
import { type Load, type LoadStatus, STATUS_LABELS, destinationHint, destinationLabel } from "@/lib/domain";
import { appConfig } from "./config";
import * as store from "./store";

/** API response shapes. The company sees everything except secrets; the driver sees only their trip. */

type StepState = "done" | "current" | "upcoming" | "attention";
const ORDER: LoadStatus[] = ["wallet_pending", "awaiting_funding", "funded", "verifying", "needs_review", "paying", "paid"];

function steps(load: Load, proofCount: number) {
  const at = ORDER.indexOf(load.status);
  const reached = (s: LoadStatus) => at >= ORDER.indexOf(s);
  const failed = load.status === "failed";
  const state = (done: boolean, current: boolean, attention = false): StepState =>
    done ? "done" : attention ? "attention" : current ? "current" : "upcoming";
  return [
    { key: "wallet", label: "Wallet created", state: state(reached("awaiting_funding") || (load.wallet.phase === "ready"), load.status === "wallet_pending", failed && load.wallet.phase !== "ready") },
    { key: "funded", label: "Funded", state: state(reached("funded"), load.status === "awaiting_funding") },
    { key: "driver", label: "Driver link sent", state: state(proofCount > 0 || reached("verifying"), load.status === "funded") },
    { key: "proof", label: "Proof verified", state: state(reached("paying"), load.status === "verifying", load.status === "needs_review") },
    { key: "paid", label: "Carrier paid", state: state(load.status === "paid", load.status === "paying", failed && load.wallet.phase === "ready") },
  ];
}

export async function companyLoadView(load: Load, origin: string) {
  const config = await appConfig();
  const [proofs, payments, events, ownerIntents] = await Promise.all([
    store.listProofs(load.id),
    store.listPayments(load.id),
    store.listEvents(load.id),
    store.listOwnerIntents(load.id),
  ]);
  const policy = load.wallet.policy as Policy | undefined;
  const payment = payments.find((p) => p.kind === "payment") ?? null;
  const approvedProof = proofs.find((p) => p.id === payment?.proofId);
  const { grantTokenSealed, ...wallet } = load.wallet;
  const refund = config.refundAccount;
  return {
    id: load.id,
    number: load.number,
    status: load.status,
    statusLabel: STATUS_LABELS[load.status],
    mode: load.mode,
    failure: load.failure,
    rateUsd: load.rateUsd,
    onChain: { amountAtomic: load.rateAtomic, symbol: config.assetSymbol, decimals: config.assetDecimals, scale: config.scale, asset: config.payoutAsset },
    delivery: load.delivery,
    carrier: { name: load.carrier.name, payout: load.carrier.payout, payoutLabel: destinationLabel(load.carrier.payout), payoutHint: destinationHint(load.carrier.payout) },
    driverUrl: `${origin}/driver/${load.driverToken}`,
    steps: steps(load, proofs.length),
    wallet: {
      phase: wallet.phase,
      agentId: wallet.agentId ?? null,
      nearAccountId: wallet.nearAccountId ?? null,
      ownerAddress: wallet.ownerAddress ?? null,
      grantId: wallet.grantId ?? null,
      hasGrant: Boolean(grantTokenSealed) && wallet.phase !== "create",
      policyRevision: wallet.policyRevision ?? null,
      deposit: wallet.deposit ?? null,
      balanceAtomic: wallet.balanceAtomic ?? "0",
      balanceCheckedAt: wallet.balanceCheckedAt ?? null,
      guardrails: policy
        ? {
            actions: policy.actions,
            asset: config.assetSymbol,
            perPaymentAtomic: Object.values(policy.limits.per_transaction ?? {})[0] ?? null,
            budgetUsd: policy.budget.daily_usd,
            maxPerHour: policy.max_actions_per_hour,
            destinations: policy.destinations.list.map((d) => ({
              label: d.address === refund ? "Company refund account" : `${load.carrier.name} payout`,
              kind: d.action,
              value: d.action === "withdraw" ? `${d.chain}:${d.address}` : d.address,
            })),
          }
        : null,
    },
    ownerIntents,
    payment,
    proofToPayoutSeconds: payment?.settledAt && approvedProof ? Math.max(0, (Date.parse(payment.settledAt) - Date.parse(approvedProof.createdAt)) / 1000) : null,
    payments,
    proofs,
    events,
    createdAt: load.createdAt,
    updatedAt: load.updatedAt,
  };
}

export async function companyLoadSummary(load: Load) {
  return {
    id: load.id,
    number: load.number,
    status: load.status,
    statusLabel: STATUS_LABELS[load.status],
    needsAttention: ["awaiting_funding", "needs_review", "failed"].includes(load.status),
    rateUsd: load.rateUsd,
    deliveryName: load.delivery.name,
    deliveryAddress: load.delivery.address,
    carrierName: load.carrier.name,
    mode: load.mode,
    updatedAt: load.updatedAt,
  };
}

/** What the driver's phone sees. No wallet internals. */
export async function driverView(load: Load) {
  const latest = await store.latestProof(load.id);
  const payment = await store.findPayment(load.id, "payment");
  const state =
    load.status === "paid"
      ? "paid"
      : load.status === "paying"
        ? "paying"
        : load.status === "verifying"
          ? "verifying"
          : load.status === "needs_review"
            ? "review"
            : load.status === "cancelled" || load.status === "cancelling"
              ? "cancelled"
              : load.status === "failed"
                ? "problem"
                : load.status === "funded"
                  ? latest?.status === "rejected"
                    ? "retry"
                    : "ready"
                  : "not_ready";
  return {
    number: load.number,
    carrierName: load.carrier.name,
    amountUsd: load.rateUsd,
    delivery: { name: load.delivery.name, address: load.delivery.address, lat: load.delivery.lat, lng: load.delivery.lng, radiusM: load.delivery.radiusM },
    state,
    message: latest?.verdict?.driverMessage ?? (latest?.status === "rejected" && latest.reviewNote ? `Your dispatcher asked for a new photo: ${latest.reviewNote}` : null),
    latestProof: latest ? { status: latest.status, distanceM: Math.round(latest.distanceM), createdAt: latest.createdAt } : null,
    payment:
      payment && payment.status === "SUCCESS"
        ? { amountUsd: payment.amountUsd, destinationHint: destinationHint(payment.destination), settledAt: payment.settledAt }
        : null,
  };
}

export type CompanyLoadView = Awaited<ReturnType<typeof companyLoadView>>;
export type CompanyLoadSummary = Awaited<ReturnType<typeof companyLoadSummary>>;
export type DriverView = Awaited<ReturnType<typeof driverView>>;
