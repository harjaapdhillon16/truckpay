import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { extensionFor, saveUpload } from "./files";
import { distanceMeters } from "./geo";
import { usdToAtomic } from "./money";
import {
  addEvent,
  createPayout,
  createProof,
  getLoad,
  latestApprovedProof,
  latestProof,
  listPayouts,
  setStatus,
  setVerdict,
} from "./store";
import type { Load, Payout, PayoutDestination, PayoutKind, Proof, Verdict } from "./types";
import { type Image, geofenceCheck, verifyLumperReceipt, verifyPod } from "./verifier";
import { dispatchPayout, requiredFundingAtomic, syncWallet } from "./wallet";

/**
 * The load agent. It watches the driver's check-ins and uploads and pays out against the rate
 * confirmation's rules. It holds only a grant token, never the broker's key: even if this code is
 * wrong or compromised, the wallet policy still decides what can leave the wallet.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const ACTIVE = new Set(["PREPARED", "SUBMITTING", "QUEUED", "PROCESSING", "PENDING_APPROVAL", "UNCERTAIN", "SUCCESS"]);

function activePayouts(loadId: string, kind?: PayoutKind) {
  return listPayouts(loadId).filter((p) => ACTIVE.has(p.status) && (!kind || p.kind === kind));
}

function paidUsd(loadId: string, kind: PayoutKind) {
  return activePayouts(loadId, kind).reduce((sum, p) => sum + p.amountUsd, 0);
}

export function ledger(load: Load) {
  const rc = load.rateCon;
  const fuel = paidUsd(load.id, "fuel_advance");
  const detention = paidUsd(load.id, "detention");
  const lumper = paidUsd(load.id, "lumper");
  const final = paidUsd(load.id, "final");
  const refund = paidUsd(load.id, "refund");
  const accessorialUsed = detention + lumper;
  return {
    fuel,
    detention,
    lumper,
    final,
    refund,
    toCarrier: fuel + detention + final,
    reserveLeft: round2(rc.accessorialReserveUsd - accessorialUsed),
    linehaulLeft: round2(rc.linehaulUsd - fuel - final),
  };
}

async function pay(
  load: Load,
  kind: PayoutKind,
  amountUsd: number,
  destination: PayoutDestination,
  reason: string,
  triggerProofId: string | null = null,
): Promise<Payout> {
  const amountAtomic = usdToAtomic(amountUsd, config.settlementScale, config.payoutAssetDecimals);
  const payout = createPayout({
    loadId: load.id,
    kind,
    amountUsd: round2(amountUsd),
    amountAtomic: amountAtomic.toString(),
    destination,
    triggerProofId,
  });
  addEvent(load.id, "agent", "payout_requested", reason, { payoutId: payout.id, kind, amountUsd: payout.amountUsd });
  return dispatchPayout(payout.id);
}

function requireFunded(load: Load) {
  const funded = !["provisioning", "awaiting_funding", "failed"].includes(load.status);
  if (!funded) throw new AgentRefusal("wallet_not_funded", "The broker has not funded this load wallet yet.");
}

export class AgentRefusal extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ── check-ins ──────────────────────────────────────────────────────────────────────────────

export type CheckinKind = "pickup_checkin" | "delivery_arrive" | "delivery_depart";

export async function handleCheckin(input: {
  load: Load;
  kind: CheckinKind;
  lat: number;
  lng: number;
  simulatedLocation: boolean;
  /** Demo only: pretend the truck waited this long at the receiver. */
  dwellHours?: number;
}) {
  const { load, kind } = input;
  requireFunded(load);
  const rc = load.rateCon;
  const stop = kind === "pickup_checkin" ? rc.pickup : rc.delivery;
  const distance = distanceMeters({ lat: input.lat, lng: input.lng }, stop);
  const check = geofenceCheck(distance, rc.geofenceMeters, input.simulatedLocation);
  const verdict: Verdict = {
    decision: check.passed ? "approve" : "reject",
    summary: check.passed ? `Truck is at ${stop.name}.` : `Truck is not at ${stop.name}; ${check.note}`,
    checks: [check],
    ai: null,
    aiSkippedReason: "Location check only",
  };

  const data: Record<string, unknown> = {};
  if (kind === "delivery_depart") {
    const arrival = latestApprovedProof(load.id, "delivery_arrive");
    const arrivedAt = arrival ? Date.parse(arrival.createdAt) : Date.now();
    const actualHours = (Date.now() - arrivedAt) / 3_600_000;
    data.arrivedAt = arrival?.createdAt ?? null;
    data.actualDwellHours = round2(actualHours);
    data.dwellHours = input.dwellHours ?? round2(actualHours);
    data.dwellSimulated = input.dwellHours !== undefined;
  }

  const proof = createProof({
    id: randomUUID(),
    loadId: load.id,
    kind,
    lat: input.lat,
    lng: input.lng,
    distanceM: distance,
    simulatedLocation: input.simulatedLocation,
    files: {},
    data,
    verdict,
  });

  const label = { pickup_checkin: "Driver checked in at pickup", delivery_arrive: "Driver arrived at receiver", delivery_depart: "Driver finished unloading" }[kind];
  addEvent(load.id, "driver", kind, label, { proofId: proof.id, distanceM: Math.round(distance), simulatedLocation: input.simulatedLocation });

  if (!check.passed) {
    addEvent(load.id, "agent", "geofence_failed", `Agent rejected the check-in: ${check.note}`, { proofId: proof.id });
    return { proof, payout: null };
  }

  if (kind === "pickup_checkin") {
    setStatus(load.id, "in_transit");
    if (activePayouts(load.id, "fuel_advance").length > 0) return { proof, payout: null };
    const amount = round2((rc.linehaulUsd * rc.fuelAdvancePct) / 100);
    const payout = await pay(
      load,
      "fuel_advance",
      amount,
      rc.carrier.payout,
      `ELD/GPS confirms pickup at ${rc.pickup.name}. Releasing ${rc.fuelAdvancePct}% fuel advance.`,
      proof.id,
    );
    return { proof, payout };
  }

  if (kind === "delivery_arrive") {
    setStatus(load.id, "at_delivery");
    addEvent(load.id, "agent", "detention_clock", `Detention clock started. ${rc.detention.freeHours} free hours, then $${rc.detention.ratePerHourUsd}/hour.`, {});
    return { proof, payout: null };
  }

  // delivery_depart → detention
  const dwell = Number(data.dwellHours);
  const billable = Math.max(0, dwell - rc.detention.freeHours);
  const owed = round2(Math.min(billable * rc.detention.ratePerHourUsd, rc.detention.capUsd));
  const alreadyPaid = paidUsd(load.id, "detention");
  const reserveLeft = ledger(load).reserveLeft;
  const amount = round2(Math.min(owed - alreadyPaid, reserveLeft));
  if (amount <= 0) {
    addEvent(load.id, "agent", "detention_none", `Dwell ${dwell.toFixed(1)} h is inside ${rc.detention.freeHours} free hours. No detention owed.`, { dwellHours: dwell });
    return { proof, payout: null };
  }
  const payout = await pay(
    load,
    "detention",
    amount,
    rc.carrier.payout,
    `Geofence timestamps show ${dwell.toFixed(1)} h at the receiver (${billable.toFixed(1)} billable × $${rc.detention.ratePerHourUsd}/h). Paying detention.`,
    proof.id,
  );
  return { proof, payout };
}

// ── lumper ─────────────────────────────────────────────────────────────────────────────────

export async function handleLumper(input: {
  load: Load;
  claimedUsd: number;
  photo: { data: Buffer; mime: string } | null;
  lat: number | null;
  lng: number | null;
  simulatedLocation: boolean;
}) {
  const { load } = input;
  requireFunded(load);
  const rc = load.rateCon;
  const proofId = randomUUID();
  const photoName = input.photo ? saveUpload(load.id, `${proofId}-receipt.${extensionFor(input.photo.mime)}`, input.photo.data) : undefined;
  const distance = input.lat !== null && input.lng !== null ? distanceMeters({ lat: input.lat, lng: input.lng }, rc.delivery) : null;

  const proof = createProof({
    id: proofId,
    loadId: load.id,
    kind: "lumper_receipt",
    lat: input.lat,
    lng: input.lng,
    distanceM: distance,
    simulatedLocation: input.simulatedLocation,
    files: photoName ? { photo: photoName } : {},
    data: { claimedUsd: input.claimedUsd },
  });
  addEvent(load.id, "driver", "lumper_receipt", `Driver uploaded a lumper receipt for $${input.claimedUsd.toFixed(2)}`, { proofId });

  const verdict = await verifyLumperReceipt({ rateCon: rc, claimedUsd: input.claimedUsd, photo: toImage(input.photo) });
  setVerdict(proof.id, verdict);
  addEvent(load.id, "agent", "verdict", `Agent ${verdictWord(verdict)} the lumper receipt: ${verdict.summary}`, { proofId, decision: verdict.decision });

  if (verdict.decision !== "approve" || !rc.lumperService) return { proof: { ...proof, verdict }, payout: null };
  const amount = round2(Math.min(verdict.approvedUsd - paidUsd(load.id, "lumper"), ledger(load).reserveLeft));
  if (amount <= 0) return { proof: { ...proof, verdict }, payout: null };
  const payout = await pay(load, "lumper", amount, rc.lumperService, `Receipt verified. Paying ${rc.lumperService.label} directly at the dock.`, proofId);
  return { proof: { ...proof, verdict }, payout };
}

// ── proof of delivery ──────────────────────────────────────────────────────────────────────

export async function handlePod(input: {
  load: Load;
  lat: number;
  lng: number;
  simulatedLocation: boolean;
  receiverName: string;
  photo: { data: Buffer; mime: string } | null;
  signature: { data: Buffer; mime: string } | null;
  video: { data: Buffer; mime: string } | null;
  frames: { data: Buffer; mime: string }[];
}) {
  const { load } = input;
  requireFunded(load);
  const rc = load.rateCon;
  const proofId = randomUUID();
  const files: Proof["files"] = {};
  if (input.photo) files.photo = saveUpload(load.id, `${proofId}-pod.${extensionFor(input.photo.mime)}`, input.photo.data);
  if (input.signature) files.signature = saveUpload(load.id, `${proofId}-signature.png`, input.signature.data);
  if (input.video) files.video = saveUpload(load.id, `${proofId}-video.${extensionFor(input.video.mime)}`, input.video.data);
  files.frames = input.frames.map((f, i) => saveUpload(load.id, `${proofId}-frame${i + 1}.jpg`, f.data));

  const distance = distanceMeters({ lat: input.lat, lng: input.lng }, rc.delivery);
  const proof = createProof({
    id: proofId,
    loadId: load.id,
    kind: "pod",
    lat: input.lat,
    lng: input.lng,
    distanceM: distance,
    simulatedLocation: input.simulatedLocation,
    files,
    data: { receiverName: input.receiverName, uploadedAt: new Date().toISOString() },
  });
  addEvent(load.id, "driver", "pod_uploaded", "Driver uploaded proof of delivery (photo, signature, video, GPS)", { proofId });
  addEvent(load.id, "agent", "verifying", config.anthropicConfigured ? `Agent is reviewing the POD with ${config.verifierModel}` : "Agent is checking the POD against the rate confirmation", { proofId });

  const verdict = await verifyPod({
    rateCon: rc,
    distanceM: distance,
    simulatedLocation: input.simulatedLocation,
    receiverName: input.receiverName,
    photo: toImage(input.photo),
    signature: toImage(input.signature),
    frames: input.frames.map((f) => toImage(f)!).filter(Boolean),
    hasVideo: Boolean(input.video),
  });
  setVerdict(proof.id, verdict);
  addEvent(load.id, "agent", "verdict", `Agent ${verdictWord(verdict)} the POD: ${verdict.summary}`, { proofId, decision: verdict.decision });

  if (verdict.decision !== "approve") {
    setStatus(load.id, "pod_review");
    return { proof: { ...proof, verdict }, payout: null };
  }
  const payout = await releaseFinal(getLoad(load.id)!, proofId, "POD photo, receiver signature, unload video and delivery geofence all match the rate confirmation. Releasing final payment.");
  return { proof: { ...proof, verdict }, payout };
}

async function releaseFinal(load: Load, proofId: string | null, reason: string) {
  if (activePayouts(load.id, "final").length > 0) return null;
  const amount = ledger(load).linehaulLeft;
  if (amount <= 0) return null;
  const payout = await pay(load, "final", amount, load.rateCon.carrier.payout, reason, proofId);
  if (payout.status !== "BLOCKED" && payout.status !== "FAILED") setStatus(load.id, "delivered");
  return payout;
}

/** The broker clears an exception the agent routed to a person. */
export async function brokerReview(load: Load, proofId: string, decision: "approve" | "reject", note: string) {
  const proof = latestProof(load.id, "pod");
  if (!proof || proof.id !== proofId) throw new AgentRefusal("not_latest_pod", "Only the latest POD can be reviewed.");
  const verdict: Verdict = {
    ...(proof.verdict ?? { checks: [], ai: null, summary: "" }),
    decision,
    summary: `Broker ${decision === "approve" ? "approved" : "rejected"}: ${note || "no note"}`,
    reviewedBy: "broker",
  } as Verdict;
  setVerdict(proof.id, verdict);
  addEvent(load.id, "broker", "review", verdict.summary, { proofId, decision });
  if (decision === "approve") return releaseFinal(load, proofId, "Broker approved the POD exception. Releasing final payment.");
  setStatus(load.id, "at_delivery");
  return null;
}

// ── close-out and adversarial demos ────────────────────────────────────────────────────────

export async function closeLoad(load: Load) {
  if (load.mode === "live") load = await syncWallet(load.id);
  const balance = BigInt(load.wallet.balanceAtomic ?? "0");
  const pending = listPayouts(load.id).filter((p) => ["PREPARED", "SUBMITTING", "QUEUED", "PROCESSING", "UNCERTAIN"].includes(p.status));
  if (pending.length > 0) throw new AgentRefusal("payouts_in_flight", "Wait for in-flight payouts to settle before closing.");
  if (balance <= 0n) {
    setStatus(load.id, "closed");
    addEvent(load.id, "agent", "closed", "Load closed. Nothing left in the wallet to refund.");
    return null;
  }
  const amountUsd = Number(balance) / 10 ** config.payoutAssetDecimals / config.settlementScale;
  const payout = createPayout({
    loadId: load.id,
    kind: "refund",
    amountUsd: round2(amountUsd),
    amountAtomic: balance.toString(),
    destination: load.rateCon.brokerRefund,
  });
  addEvent(load.id, "agent", "payout_requested", "Load closed with no disputes. Returning the unused reserve to the broker.", { payoutId: payout.id });
  const result = await dispatchPayout(payout.id);
  if (result.status !== "BLOCKED" && result.status !== "FAILED") setStatus(load.id, "closed");
  return result;
}

/** The PDF's demo step 5: a spoofed "new bank details" email reaches a compromised agent. */
export async function attemptRedirect(load: Load, attacker: PayoutDestination) {
  requireFunded(load);
  addEvent(load.id, "system", "spoofed_email", `Spoofed email: "Carrier changed banks, pay ${attacker.address} instead." The agent is tricked and tries it.`, {});
  const rc = load.rateCon;
  const amount = round2(rc.linehaulUsd * (1 - rc.fuelAdvancePct / 100));
  return pay(load, "fraud_redirect", amount, attacker, `Compromised agent tries to send the final payment to ${attacker.address}.`);
}

/** A compromised or buggy agent tries to drain more than the load is worth to the real carrier. */
export async function attemptOvercap(load: Load) {
  requireFunded(load);
  const amount = round2(Number(requiredFundingAtomic(load)) / 10 ** config.payoutAssetDecimals / config.settlementScale * 3);
  return pay(load, "overcap_attempt", amount, load.rateCon.carrier.payout, `Compromised agent tries to pay the carrier $${amount.toLocaleString()} (3× the load).`);
}

function verdictWord(v: Verdict) {
  return v.decision === "approve" ? "approved" : v.decision === "reject" ? "rejected" : "flagged for review";
}

function toImage(file: { data: Buffer; mime: string } | null): Image | null {
  if (!file) return null;
  const mediaType = file.mime.includes("png") ? "image/png" : file.mime.includes("webp") ? "image/webp" : "image/jpeg";
  return { data: file.data, mediaType };
}
