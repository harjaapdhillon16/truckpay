/**
 * Domain types shared by the API and the UI. Vocabulary follows docs/specs/delivery-proof-demo.md.
 */

/** Where the carrier is paid, or where a refund goes. Mirrors Agent Connect destinations. */
export type Destination =
  | { kind: "transfer"; account: string }
  | { kind: "withdraw"; chain: "base"; address: string };

export type DeliveryStop = { name: string; address: string; lat: number; lng: number; radiusM: number };

export type Carrier = { name: string; payout: Destination };

export type LoadStatus =
  | "wallet_pending"
  | "awaiting_funding"
  | "funded"
  | "verifying"
  | "needs_review"
  | "paying"
  | "paid"
  | "cancelling"
  | "cancelled"
  | "failed";

export const TERMINAL_LOAD_STATUSES: LoadStatus[] = ["paid", "cancelled", "failed"];

export type WalletPhase = "create" | "await_policy" | "grant" | "deposit" | "ready";

/** What the company signed and what the load agent holds, as stored on the load. */
export type WalletState = {
  phase: WalletPhase;
  /** Test money: real Agent Connect wallet, but deposits are simulated and payouts are only quoted. */
  testMoney?: boolean;
  testBalanceAtomic?: string;
  agentId?: string;
  ownerAddress?: string;
  nearAccountId?: string;
  policy?: unknown;
  policyRevision?: number | null;
  createCorrelationId?: string;
  grantCorrelationId?: string;
  grantId?: string;
  grantTokenSealed?: string;
  deposit?: {
    correlationId: string;
    address: string | null;
    memo: string | null;
    minAmountAtomic: string | null;
    expiresAt: string | null;
  };
  balanceAtomic?: string;
  balanceCheckedAt?: string;
};

export type Load = {
  id: string;
  number: string;
  status: LoadStatus;
  mode: "live" | "simulated";
  rateUsd: number;
  rateAtomic: string;
  delivery: DeliveryStop;
  carrier: Carrier;
  wallet: WalletState;
  driverToken: string;
  failure: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentKind = "payment" | "refund" | "fraud_test";

export type Payment = {
  id: string;
  loadId: string;
  kind: PaymentKind;
  amountUsd: number;
  amountAtomic: string;
  destination: Destination;
  /** SUBMITTING before Agent Connect answers, then its status, or BLOCKED for a policy refusal. */
  status: string;
  correlationId: string | null;
  idempotencyKey: string;
  errorCode: string | null;
  errorDetail: string | null;
  proofId: string | null;
  createdAt: string;
  settledAt: string | null;
  /** Test money: approved by the wallet's policy without moving funds. */
  test: boolean;
  policyCheck: PolicyCheck | null;
};

export type PolicyCheck = {
  allowed: boolean;
  code: string | null;
  detail: string;
  checks: { name: string; passed: boolean }[];
  /** Who checked: Agent Connect's own no-money quote, or the signed policy evaluated locally. */
  source: "agent_connect_quote" | "signed_policy";
};

export type Check = { name: string; passed: boolean; note: string };

export type Verdict = {
  decision: "approve" | "needs_review" | "reject";
  summary: string;
  /** Plain-language message for the driver. */
  driverMessage: string;
  checks: Check[];
  ai: { model: string; decision: string; confidence: number; summary: string; checks: Check[] } | null;
  aiSkippedReason?: string;
};

export type ProofStatus = "verifying" | "approved" | "needs_review" | "rejected";

export type Proof = {
  id: string;
  loadId: string;
  status: ProofStatus;
  lat: number;
  lng: number;
  accuracyM: number | null;
  distanceM: number;
  files: { photo?: string; video?: string; frames?: string[] };
  verdict: Verdict | null;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type LoadEvent = {
  id: number;
  ts: string;
  actor: "company" | "driver" | "agent" | "wallet" | "system";
  type: string;
  title: string;
  detail: Record<string, unknown>;
};

export const STATUS_LABELS: Record<LoadStatus, string> = {
  wallet_pending: "Creating wallet",
  awaiting_funding: "Awaiting funding",
  funded: "Funded · awaiting proof",
  verifying: "Verifying proof",
  needs_review: "Needs your review",
  paying: "Paying carrier",
  paid: "Paid",
  cancelling: "Refunding",
  cancelled: "Cancelled",
  failed: "Needs attention",
};

export function destinationLabel(d: Destination) {
  return d.kind === "transfer" ? d.account : d.address;
}

export function destinationHint(d: Destination) {
  const value = destinationLabel(d);
  return `${d.kind === "withdraw" ? "Base" : "NEAR"} ••••${value.slice(-4)}`;
}
