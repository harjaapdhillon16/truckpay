import "server-only";
import { createGrantCredential, grantCommitment } from "@near-intents-agent-api/sdk";
import type { Carrier, DeliveryStop, Destination, Load, LoadStatus, Payment, Proof, Verdict } from "@/lib/domain";
import { distanceMeters } from "@/lib/geo";
import { usdToAtomic } from "@/lib/money";
import { appConfig } from "./config";
import { companyOwner, signAsCompany } from "./company";
import { getProofFile, putProofFile } from "./files";
import { GatewayError, TERMINAL_OPERATION, gateway } from "./gateway";
import { simulator } from "./gateway/simulated";
import { buildLoadPolicy } from "./policy";
import { seal, unseal } from "./seal";
import * as store from "./store";
import { type Image, verifyDelivery } from "./verifier";

/**
 * The load agent. Owns the load state machine (docs/specs/delivery-proof-demo.md):
 *
 *   wallet_pending → awaiting_funding → funded → verifying → paying → paid
 *                                          ↑          ├→ needs_review → paying | funded
 *                                          └──────────┘ (reject: driver resubmits)
 *   awaiting_funding | funded | needs_review → cancelling → cancelled
 *   anything that Agent Connect ends badly → failed
 *
 * It holds a grant token per load and never the company key's authority over policy. Every step
 * is short and idempotent (stored correlation ids and idempotency keys), so it can be driven by
 * requests, `waitUntil` and the cron without double-spending.
 */

export class AgentRefusal extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── booking ────────────────────────────────────────────────────────────────────────────────

export async function createLoad(input: { number?: string; rateUsd: number; delivery: Omit<DeliveryStop, "radiusM">; carrier: Carrier }, createKey: string | null) {
  if (createKey) {
    const existing = await store.getLoadByCreateKey(createKey);
    if (existing) return existing;
  }
  const config = await appConfig();
  if (!config.refundAccount) throw new AgentRefusal("refund_account_missing", "COMPANY_REFUND_NEAR_ACCOUNT is not configured.", 500);
  const id = crypto.randomUUID();
  const rateAtomic = usdToAtomic(input.rateUsd, config.scale, config.assetDecimals);
  if (rateAtomic <= 0n) throw new AgentRefusal("rate_too_small", "The rate is too small to settle on-chain at this demo scale.", 400);
  await store.insertLoad({
    id,
    number: input.number?.trim() || `LD-${Math.floor(10000 + Math.random() * 89999)}`,
    mode: config.mode,
    rateUsd: round2(input.rateUsd),
    rateAtomic: rateAtomic.toString(),
    delivery: { ...input.delivery, radiusM: config.geofenceMeters },
    carrier: input.carrier,
    driverToken: base64url(crypto.getRandomValues(new Uint8Array(16))),
    createKey,
  });
  await store.addEvent(id, "company", "booked", `Load booked for $${input.rateUsd.toLocaleString()} to ${input.delivery.name}`);
  return (await store.getLoad(id))!;
}

// ── the step loop ──────────────────────────────────────────────────────────────────────────

/**
 * Advances a load as far as it can go without waiting. Safe to call from anywhere, any number of
 * times: a lease keeps two callers from stepping the same load at once.
 */
export async function advance(loadId: string) {
  if (!(await store.acquireLease(loadId, 45_000))) return;
  try {
    for (let i = 0; i < 6; i++) {
      const load = await store.getLoad(loadId);
      if (!load) return;
      const moved = await step(load);
      if (!moved) return;
    }
  } finally {
    await store.releaseLease(loadId);
  }
}

async function step(load: Load): Promise<boolean> {
  try {
    switch (load.status) {
      case "wallet_pending":
        return await walletStep(load);
      case "awaiting_funding":
        return await fundingStep(load);
      case "verifying": {
        const stale = await store.staleVerifyingProof(load.id, 120_000);
        if (!stale) return false;
        await finishVerification(load, stale, await loadProofImages(stale));
        return true;
      }
      case "paying":
      case "cancelling":
        return await followPayment(load, load.status === "paying" ? "payment" : "refund");
      default:
        return false;
    }
  } catch (error) {
    if (error instanceof GatewayError && error.retryable) return false;
    if (error instanceof GatewayError && error.code === "request_failed") return false;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[agent]", load.id, load.status, message);
    if (load.status === "wallet_pending") {
      await store.updateLoad(load.id, { status: "failed", failure: `Wallet setup failed: ${message}` });
      await store.addEvent(load.id, "system", "failed", "Wallet setup failed", { message });
    }
    return false;
  }
}

// ── wallet setup: agent_create → policy applied → grant_issue → deposit address ─────────────

async function runOwnerIntent(load: Load, request: Parameters<Awaited<ReturnType<typeof gateway>>["generateOwnerIntent"]>[0], key: string) {
  const gw = await gateway();
  const generated = await gw.generateOwnerIntent(request, key);
  await store.upsertOwnerIntent(load.id, {
    correlationId: generated.correlation_id,
    type: request.type,
    status: "PENDING_SIGNATURE",
    summary: generated.preview?.summary ?? null,
  });
  const signed = await signAsCompany(generated);
  const result = await gw.submitOwnerIntent(request.type, generated.correlation_id, signed);
  await store.upsertOwnerIntent(load.id, { correlationId: generated.correlation_id, type: request.type, status: result.status });
  return { generated, result };
}

async function walletStep(load: Load): Promise<boolean> {
  const gw = await gateway();
  const config = await appConfig();
  const w = load.wallet;

  if (w.phase === "create") {
    if (!w.createCorrelationId) {
      const { owner } = await companyOwner();
      const policy = buildLoadPolicy({
        asset: config.payoutAsset,
        rateAtomic: load.rateAtomic,
        rateOnChainUsd: load.rateUsd * config.scale,
        carrier: load.carrier.payout,
        refund: { kind: "transfer", account: config.refundAccount! },
      });
      await store.patchWallet(load.id, { ownerAddress: owner.address, policy });
      const { generated } = await runOwnerIntent(
        load,
        { type: "agent_create", name: `Load ${load.number}`, external_user_id: load.id, owner, policy },
        `create-${load.id}`,
      );
      await store.patchWallet(load.id, { createCorrelationId: generated.correlation_id, agentId: generated.agent_id ?? undefined });
      await store.addEvent(load.id, "company", "policy_signed", "Company signed the load wallet's policy", {
        correlationId: generated.correlation_id,
        summary: generated.preview?.summary,
      });
      return true;
    }
    const status = await gw.status(w.createCorrelationId);
    await store.upsertOwnerIntent(load.id, { correlationId: w.createCorrelationId, type: "agent_create", status: status.status });
    if (status.status === "PENDING_SIGNATURE") {
      // Interrupted between generate and submit: the same key replays the same intent.
      await store.patchWallet(load.id, { createCorrelationId: undefined });
      return true;
    }
    if (status.status !== "SUCCESS") return failIfTerminal(load, status.status, status.failureCode, "Wallet creation");
    await store.patchWallet(load.id, { phase: "await_policy", agentId: status.agentId ?? w.agentId });
    await store.addEvent(load.id, "wallet", "wallet_created", "Agent Connect created the load wallet");
    return true;
  }

  if (w.phase === "await_policy") {
    const policy = await gw.policy(w.agentId!);
    if (!policy.applied) return false;
    await store.patchWallet(load.id, { phase: "grant", policyRevision: policy.revision });
    await store.addEvent(load.id, "wallet", "policy_applied", "Policy is in force on the wallet");
    return true;
  }

  if (w.phase === "grant") {
    if (!w.grantCorrelationId) {
      // Seal the token before asking for the signature, so a retry signs the same commitment.
      let token = w.grantTokenSealed ? await unseal(w.grantTokenSealed) : null;
      if (!token) {
        token = createGrantCredential().token;
        await store.patchWallet(load.id, { grantTokenSealed: await seal(token) });
      }
      const commitment = grantCommitment(token);
      const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const { generated } = await runOwnerIntent(
        load,
        { type: "grant_issue", agent_id: w.agentId!, label: `Load agent ${load.number}`.slice(0, 64), credential: commitment, expires_at: expires },
        `grant-${load.id}`,
      );
      await store.patchWallet(load.id, { grantCorrelationId: generated.correlation_id });
      return true;
    }
    const status = await gw.status(w.grantCorrelationId);
    await store.upsertOwnerIntent(load.id, { correlationId: w.grantCorrelationId, type: "grant_issue", status: status.status });
    if (status.status === "PENDING_SIGNATURE") {
      await store.patchWallet(load.id, { grantCorrelationId: undefined });
      return true;
    }
    if (status.status !== "SUCCESS") return failIfTerminal(load, status.status, status.failureCode, "Grant");
    const grant = (status.details as { grant?: { grant_id?: string } }).grant;
    await store.patchWallet(load.id, { phase: "deposit", grantId: grant?.grant_id });
    await store.addEvent(load.id, "company", "grant_issued", "Company granted the load agent spending access, inside the policy only");
    return true;
  }

  if (w.phase === "deposit") {
    const deposit = await gw.deposit(w.agentId!, config.payoutAsset, load.rateAtomic, `deposit-exact-${load.id}`);
    const balance = await gw.balance(w.agentId!, config.payoutAsset);
    await store.updateLoad(load.id, {
      status: "awaiting_funding",
      wallet: {
        ...w,
        phase: "ready",
        nearAccountId: balance.nearAccountId ?? undefined,
        deposit: {
          correlationId: deposit.correlationId,
          address: deposit.address,
          memo: deposit.memo,
          minAmountAtomic: deposit.minAmountAtomic,
          expiresAt: deposit.expiresAt,
        },
        balanceAtomic: balance.atomic,
        balanceCheckedAt: new Date().toISOString(),
      },
    });
    await store.addEvent(load.id, "wallet", "deposit_address", "Deposit address ready for the company");
    return true;
  }
  return false;
}

async function failIfTerminal(load: Load, status: string, code: string | null, what: string) {
  if (TERMINAL_OPERATION.has(status) || status === "NEEDS_REVIEW") {
    await store.updateLoad(load.id, { status: "failed", failure: `${what} ended ${status}${code ? ` (${code})` : ""}` });
    await store.addEvent(load.id, "system", "failed", `${what} ended ${status}`, { code });
    return true;
  }
  return false;
}

// ── funding ────────────────────────────────────────────────────────────────────────────────

async function fundingStep(load: Load): Promise<boolean> {
  const config = await appConfig();
  const { atomic } = await (await gateway()).balance(load.wallet.agentId!, config.payoutAsset);
  await store.patchWallet(load.id, { balanceAtomic: atomic, balanceCheckedAt: new Date().toISOString() });
  if (BigInt(atomic) < BigInt(load.rateAtomic)) return false;
  if (await store.transition(load.id, ["awaiting_funding"], "funded")) {
    await store.addEvent(load.id, "company", "funded", "Wallet funded. The carrier can see the money is committed.", { balanceAtomic: atomic });
  }
  return true;
}

/** Simulated mode only: pretend the company sent the deposit. */
export async function simulateDeposit(loadId: string) {
  const load = await requireLoad(loadId);
  if (load.mode !== "simulated") throw new AgentRefusal("not_simulated", "Only simulated wallets can be funded by simulation.");
  if (load.status !== "awaiting_funding") throw new AgentRefusal("invalid_state", "The wallet is not waiting for funds.");
  simulator.credit(load.wallet.agentId!, BigInt(load.rateAtomic));
  // The funding transition is atomic, so this doesn't need the step lease.
  await fundingStep(load);
  return requireLoad(loadId);
}

// ── proof of delivery ──────────────────────────────────────────────────────────────────────

export type ProofUpload = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  photo: { data: Uint8Array; type: string };
  video: { data: Uint8Array; type: string } | null;
  frames: { data: Uint8Array; type: string }[];
};

export async function submitProof(token: string, upload: ProofUpload, idempotencyKey: string | null) {
  const load = await store.getLoadByDriverToken(token);
  if (!load) throw new AgentRefusal("not_found", "This driver link is not valid.", 404);
  if (idempotencyKey) {
    const replay = await store.getProofByKey(`${load.id}:${idempotencyKey}`);
    if (replay) return replay;
  }
  if (["verifying", "paying", "paid"].includes(load.status)) {
    const latest = await store.latestProof(load.id);
    if (latest) return latest;
  }
  if (["wallet_pending", "awaiting_funding"].includes(load.status))
    throw new AgentRefusal("wallet_not_funded", "This load isn't funded yet. Ask your dispatcher to fund it, then submit.");
  if (load.status !== "funded") throw new AgentRefusal("invalid_state", "This load is not accepting delivery proof.");

  const id = crypto.randomUUID();
  const files: Proof["files"] = {
    photo: await putProofFile(load.id, `${id}-bol.jpg`, upload.photo.data, upload.photo.type || "image/jpeg"),
  };
  if (upload.video) files.video = await putProofFile(load.id, `${id}-video.${upload.video.type.includes("quicktime") ? "mov" : upload.video.type.includes("webm") ? "webm" : "mp4"}`, upload.video.data, upload.video.type);
  if (upload.frames.length) files.frames = await Promise.all(upload.frames.map((f, i) => putProofFile(load.id, `${id}-frame${i}.jpg`, f.data, "image/jpeg")));

  // Claim the load before verifying, so a second submit can't start a second verification.
  if (!(await store.transition(load.id, ["funded"], "verifying"))) {
    const latest = await store.latestProof(load.id);
    if (latest) return latest;
    throw new AgentRefusal("invalid_state", "This load is not accepting delivery proof.");
  }
  const proof = await store.insertProof({
    id,
    loadId: load.id,
    lat: upload.lat,
    lng: upload.lng,
    accuracyM: upload.accuracyM,
    distanceM: distanceMeters({ lat: upload.lat, lng: upload.lng }, load.delivery),
    files,
    idempotencyKey: idempotencyKey ? `${load.id}:${idempotencyKey}` : null,
  });
  await store.addEvent(load.id, "driver", "proof_submitted", "Driver submitted delivery proof", { proofId: id, distanceM: Math.round(proof.distanceM) });

  const images = {
    photo: toImage(upload.photo),
    frames: upload.frames.map(toImage),
  };
  return finishVerification((await store.getLoad(load.id))!, proof, images);
}

async function finishVerification(load: Load, proof: Proof, images: { photo: Image | null; frames: Image[] }) {
  await store.markVerifyStarted(proof.id);
  await store.addEvent(load.id, "agent", "verifying", "Load agent is checking the location and reading the BOL", { proofId: proof.id });
  const verdict = await verifyDelivery({ load, distanceM: proof.distanceM, accuracyM: proof.accuracyM, photo: images.photo, frames: images.frames });
  return applyVerdict(load, proof, verdict);
}

async function applyVerdict(load: Load, proof: Proof, verdict: Verdict) {
  if (verdict.decision === "approve") {
    const decided = await store.decideProof(proof.id, "approved", verdict);
    await store.addEvent(load.id, "agent", "verdict", `Agent approved the delivery: ${verdict.summary}`, { proofId: proof.id });
    await startPayment(load, proof.id, ["verifying"]);
    return decided;
  }
  if (verdict.decision === "needs_review") {
    const decided = await store.decideProof(proof.id, "needs_review", verdict);
    await store.transition(load.id, ["verifying"], "needs_review");
    await store.addEvent(load.id, "agent", "verdict", `Agent sent the delivery to you for review: ${verdict.summary}`, { proofId: proof.id });
    return decided;
  }
  const decided = await store.decideProof(proof.id, "rejected", verdict);
  await store.transition(load.id, ["verifying"], "funded");
  await store.addEvent(load.id, "agent", "verdict", `Agent rejected the proof: ${verdict.summary}`, { proofId: proof.id });
  return decided;
}

/** The company clears a proof the agent wasn't sure about. Approval pays through the same policy. */
export async function reviewProof(loadId: string, proofId: string, decision: "approve" | "reject", note: string) {
  const load = await requireLoad(loadId);
  const proof = await store.getProof(proofId);
  if (!proof || proof.loadId !== loadId) throw new AgentRefusal("not_found", "No such proof on this load.", 404);
  if (load.status !== "needs_review" || proof.status !== "needs_review") throw new AgentRefusal("invalid_state", "This proof is not waiting for review.");
  if (decision === "approve") {
    await store.decideProof(proof.id, "approved", null, note || "Approved by company");
    await store.addEvent(load.id, "company", "review", `Company approved the delivery${note ? `: ${note}` : ""}`, { proofId });
    await startPayment(load, proof.id, ["needs_review"]);
  } else {
    await store.decideProof(proof.id, "rejected", null, note || "Rejected by company");
    await store.transition(load.id, ["needs_review"], "funded");
    await store.addEvent(load.id, "company", "review", `Company rejected the delivery proof${note ? `: ${note}` : ""}. The driver can resubmit.`, { proofId });
  }
  return requireLoad(loadId);
}

// ── payments ───────────────────────────────────────────────────────────────────────────────

async function startPayment(load: Load, proofId: string, from: LoadStatus[]) {
  if (!(await store.transition(load.id, from, "paying"))) return;
  const payment = await store.insertPayment({
    loadId: load.id,
    kind: "payment",
    amountUsd: load.rateUsd,
    amountAtomic: load.rateAtomic,
    destination: load.carrier.payout,
    proofId,
  });
  await store.addEvent(load.id, "agent", "payment_requested", `Agent asked the wallet to pay ${load.carrier.name}`, { paymentId: payment.id });
  await dispatch(load, payment);
  await followPayment((await store.getLoad(load.id))!, "payment");
}

async function dispatch(load: Load, payment: Payment): Promise<Payment> {
  const config = await appConfig();
  try {
    const result = await (await gateway()).send({
      agentId: load.wallet.agentId!,
      grantToken: await unseal(load.wallet.grantTokenSealed!),
      asset: config.payoutAsset,
      amountAtomic: payment.amountAtomic,
      destination: payment.destination,
      idempotencyKey: payment.idempotencyKey,
    });
    return store.updatePayment(payment.id, {
      status: result.status,
      correlationId: result.correlationId,
      errorCode: result.failureCode,
      settledAt: result.status === "SUCCESS" ? new Date().toISOString() : null,
    });
  } catch (error) {
    if (error instanceof GatewayError && !error.isPolicyRefusal && (error.retryable || error.code === "request_failed")) {
      // May or may not have reached Agent Connect: the next step retries under the same key.
      return store.updatePayment(payment.id, { status: "SUBMITTING", errorCode: error.code, errorDetail: error.detail });
    }
    const code = error instanceof GatewayError ? error.code : "internal_error";
    const detail = error instanceof Error ? (error instanceof GatewayError ? error.detail : error.message) : String(error);
    const blocked = error instanceof GatewayError && error.isPolicyRefusal;
    const updated = await store.updatePayment(payment.id, { status: blocked ? "BLOCKED" : "FAILED", errorCode: code, errorDetail: detail });
    await store.addEvent(load.id, "wallet", blocked ? "payment_blocked" : "payment_failed", blocked ? "The wallet's policy refused the payment" : "The payment failed", { paymentId: payment.id, code, detail });
    return updated;
  }
}

/** Follows the load's payment (or refund) to its end. Never re-sends under a new key. */
async function followPayment(load: Load, kind: "payment" | "refund"): Promise<boolean> {
  const payment = await store.findPayment(load.id, kind);
  if (!payment) return false;
  const done = kind === "payment" ? "paid" : "cancelled";
  const from: LoadStatus = kind === "payment" ? "paying" : "cancelling";

  if (payment.status === "SUBMITTING") {
    await dispatch(load, payment);
    return true;
  }
  if (payment.status === "BLOCKED" || payment.status === "FAILED") {
    await store.transition(load.id, [from], "failed", `${kind === "payment" ? "Payment" : "Refund"} ${payment.status.toLowerCase()}: ${payment.errorCode}`);
    return true;
  }
  const settle = async (settled: Payment) => {
    if (await store.transition(load.id, [from], done)) {
      await store.addEvent(load.id, "wallet", kind === "payment" ? "paid" : "refunded", kind === "payment" ? `Wallet paid ${load.carrier.name} $${settled.amountUsd.toLocaleString()}` : "Wallet refunded the company", {
        paymentId: settled.id,
        correlationId: settled.correlationId,
      });
      await refreshBalance(load.id);
    }
    return true;
  };
  if (payment.status === "SUCCESS") return settle(payment);
  if (!payment.correlationId) return false;
  const status = await (await gateway()).status(payment.correlationId);
  if (status.status === payment.status) return false;
  const updated = await store.updatePayment(payment.id, {
    status: status.status,
    errorCode: status.failureCode,
    settledAt: status.status === "SUCCESS" ? new Date().toISOString() : null,
    errorDetail: status.status === "NEEDS_REVIEW" ? String((status.details as { reason?: string }).reason ?? "") : null,
  });
  if (updated.status === "SUCCESS") return settle(updated);
  if (status.status === "NEEDS_REVIEW" || status.status === "FAILED" || status.status === "REFUNDED") {
    await store.transition(load.id, [from], "failed", `${kind === "payment" ? "Payment" : "Refund"} ended ${status.status}`);
    await store.addEvent(load.id, "wallet", "payment_failed", `${kind === "payment" ? "Payment" : "Refund"} ended ${status.status}`, { code: status.failureCode });
  }
  return true;
}

async function refreshBalance(loadId: string) {
  try {
    const load = await requireLoad(loadId);
    const config = await appConfig();
    const { atomic } = await (await gateway()).balance(load.wallet.agentId!, config.payoutAsset);
    await store.patchWallet(loadId, { balanceAtomic: atomic, balanceCheckedAt: new Date().toISOString() });
  } catch {
    // Display only.
  }
}

// ── cancel and the fraud test ──────────────────────────────────────────────────────────────

export async function cancelLoad(loadId: string) {
  const load = await requireLoad(loadId);
  if (load.status === "wallet_pending" && !load.wallet.agentId) {
    await store.transition(load.id, ["wallet_pending"], "cancelled");
    await store.addEvent(load.id, "company", "cancelled", "Company cancelled the load before its wallet existed");
    return requireLoad(loadId);
  }
  if (!["awaiting_funding", "funded", "needs_review"].includes(load.status))
    throw new AgentRefusal("not_cancellable", load.status === "paid" ? "The carrier is already paid; a paid load can't be cancelled." : "This load can't be cancelled right now.");
  const config = await appConfig();
  const { atomic } = await (await gateway()).balance(load.wallet.agentId!, config.payoutAsset);
  if (BigInt(atomic) === 0n) {
    await store.transition(load.id, [load.status], "cancelled");
    await store.addEvent(load.id, "company", "cancelled", "Company cancelled the load. The wallet was empty, so nothing to refund.");
    return requireLoad(loadId);
  }
  if (!(await store.transition(load.id, [load.status], "cancelling"))) throw new AgentRefusal("invalid_state", "The load changed; try again.");
  const payment = await store.insertPayment({
    loadId: load.id,
    kind: "refund",
    amountUsd: round2(Number(atomic) / 10 ** config.assetDecimals / config.scale),
    amountAtomic: atomic,
    destination: { kind: "transfer", account: config.refundAccount! },
  });
  await store.addEvent(load.id, "company", "cancel_requested", "Company cancelled the load. Refunding the wallet to the company.");
  await dispatch(load, payment);
  await followPayment((await store.getLoad(load.id))!, "refund");
  return requireLoad(loadId);
}

/** Demo only: the agent is tricked by a spoofed "new bank details" email and tries to pay it. */
export async function fraudTest(loadId: string) {
  const config = await appConfig();
  if (!config.demoFeatures) throw new AgentRefusal("demo_features_disabled", "The fraud test is disabled on this deployment.", 403);
  const load = await requireLoad(loadId);
  if (load.wallet.phase !== "ready" || !load.wallet.grantTokenSealed)
    throw new AgentRefusal("wallet_not_ready", "The wallet is still being set up.");
  const attacker: Destination = { kind: "transfer", account: "carrier-payments-update.near" };
  await store.addEvent(load.id, "system", "spoofed_email", `Spoofed email: "${load.carrier.name} changed banks. Pay carrier-payments-update.near instead." The agent falls for it.`);
  const payment = await store.insertPayment({ loadId: load.id, kind: "fraud_test", amountUsd: load.rateUsd, amountAtomic: load.rateAtomic, destination: attacker });
  return dispatch(load, payment);
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────

async function requireLoad(id: string) {
  const load = await store.getLoad(id);
  if (!load) throw new AgentRefusal("not_found", "No such load.", 404);
  return load;
}

async function loadProofImages(proof: Proof): Promise<{ photo: Image | null; frames: Image[] }> {
  const photo = proof.files.photo ? await getProofFile(proof.loadId, proof.files.photo) : null;
  const frames = await Promise.all((proof.files.frames ?? []).map((f) => getProofFile(proof.loadId, f)));
  return {
    photo: photo ? toImage({ data: photo.data, type: photo.contentType }) : null,
    frames: frames.filter((f): f is NonNullable<typeof f> => Boolean(f)).map((f) => toImage({ data: f.data, type: f.contentType })),
  };
}

function toImage(file: { data: Uint8Array; type: string }): Image {
  const mediaType = file.type.includes("png") ? "image/png" : file.type.includes("webp") ? "image/webp" : "image/jpeg";
  return { data: file.data, mediaType };
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
