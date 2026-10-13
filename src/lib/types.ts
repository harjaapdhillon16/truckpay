import type { Stop } from "./geo";

/** Where money may go. Mirrors Agent Connect's destination entries. */
export type PayoutDestination =
  | { kind: "transfer"; label: string; address: string }
  | { kind: "withdraw"; label: string; chain: string; address: string; memo: string | null };

/** The rate confirmation: everything the broker and carrier agreed to before dispatch. */
export type RateCon = {
  loadNumber: string;
  equipment: string;
  commodity: string;
  pickup: Stop & { appointment: string };
  delivery: Stop & { appointment: string };
  carrier: { name: string; mcNumber: string; driverName: string; payout: PayoutDestination };
  lumperService: PayoutDestination | null;
  brokerRefund: PayoutDestination;
  linehaulUsd: number;
  accessorialReserveUsd: number;
  fuelAdvancePct: number;
  detention: { freeHours: number; ratePerHourUsd: number; capUsd: number };
  lumperCapUsd: number;
  geofenceMeters: number;
  deliveryWindowHours: number;
};

export type LoadStatus =
  | "provisioning"
  | "awaiting_funding"
  | "funded"
  | "at_pickup"
  | "in_transit"
  | "at_delivery"
  | "pod_review"
  | "delivered"
  | "closed"
  | "failed";

export type WalletState = {
  agentId?: string;
  ownerAddress?: string;
  ownerAccount?: string | null;
  nearAccountId?: string | null;
  policyRevision?: number | null;
  policyHash?: string | null;
  policy?: unknown;
  grantId?: string;
  grantTokenSealed?: string;
  provisioningStep?: string;
  provisioningError?: string;
  intents?: { step: string; correlationId: string; status: string; summary?: string }[];
  deposit?: {
    correlationId: string;
    address: string | null;
    memo: string | null;
    minAmount: string | null;
    expiresAt: string | null;
    status: string;
    originAsset: string;
  };
  balanceAtomic?: string;
  balanceCheckedAt?: string;
  fundedAtomic?: string;
};

export type Load = {
  id: string;
  ref: string;
  status: LoadStatus;
  mode: "live" | "simulated";
  rateCon: RateCon;
  wallet: WalletState;
  driverToken: string;
  createdAt: string;
  updatedAt: string;
};

export type LoadEvent = {
  id: number;
  loadId: string;
  ts: string;
  actor: "broker" | "driver" | "agent" | "wallet" | "system";
  type: string;
  title: string;
  detail: Record<string, unknown>;
};

export type PayoutKind =
  | "fuel_advance"
  | "detention"
  | "lumper"
  | "final"
  | "refund"
  | "fraud_redirect"
  | "overcap_attempt";

export type Payout = {
  id: string;
  loadId: string;
  kind: PayoutKind;
  amountUsd: number;
  amountAtomic: string;
  destination: PayoutDestination;
  /** Local lifecycle, then Agent Connect's status once submitted. */
  status: string;
  correlationId: string | null;
  idempotencyKey: string;
  errorCode: string | null;
  errorDetail: string | null;
  triggerProofId: string | null;
  createdAt: string;
  settledAt: string | null;
};

export type ProofKind = "pickup_checkin" | "delivery_arrive" | "delivery_depart" | "lumper_receipt" | "pod";

export type Check = { name: string; passed: boolean; note: string };

export type Verdict = {
  decision: "approve" | "reject" | "needs_review";
  summary: string;
  checks: Check[];
  ai: { model: string; decision: string; confidence: number; summary: string; checks: Check[] } | null;
  aiSkippedReason?: string;
  reviewedBy?: string;
};

export type Proof = {
  id: string;
  loadId: string;
  kind: ProofKind;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;
  simulatedLocation: boolean;
  files: { photo?: string; signature?: string; video?: string; frames?: string[] };
  data: Record<string, unknown>;
  verdict: Verdict | null;
  createdAt: string;
};

export const PAYOUT_LABELS: Record<PayoutKind, string> = {
  fuel_advance: "Fuel advance",
  detention: "Detention",
  lumper: "Lumper fee",
  final: "Final payment",
  refund: "Reserve refund",
  fraud_redirect: "Redirect attempt",
  overcap_attempt: "Over-cap attempt",
};

export const STATUS_LABELS: Record<LoadStatus, string> = {
  provisioning: "Creating wallet",
  awaiting_funding: "Awaiting funding",
  funded: "Funded · ready",
  at_pickup: "At pickup",
  in_transit: "In transit",
  at_delivery: "At receiver",
  pod_review: "POD needs review",
  delivered: "Paid",
  closed: "Closed",
  failed: "Failed",
};

export function totalCommittedUsd(rc: RateCon) {
  return rc.linehaulUsd + rc.accessorialReserveUsd;
}
