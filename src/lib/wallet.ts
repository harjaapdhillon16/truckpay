import "server-only";
import { randomBytes } from "node:crypto";
import {
  AgentApi,
  AgentApiError,
  AgentApiRequestError,
  createGrantCredential,
  type GenerateIntentResponse,
  type OwnerWallet,
  type Policy,
  type SignedData,
  type StatusResponse,
} from "@near-intents-agent-api/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import { usdToAtomic } from "./money";
import { buildLoadPolicy, sameDestination, toDestination } from "./policy";
import { brokerOwnerKey, seal, unseal } from "./secrets";
import {
  addEvent,
  getLoad,
  getPayout,
  listPayouts,
  patchWallet,
  recordIntent,
  setStatus,
  updatePayout,
} from "./store";
import type { Load, Payout } from "./types";
import { totalCommittedUsd } from "./types";

/**
 * Agent Connect, one wallet per load.
 *
 * Live mode uses the NEAR Intents Agent API on mainnet: the broker (owner) signs the wallet's
 * policy and the load agent's grant once; afterwards the agent pays out with its grant token and
 * the wallet refuses anything the policy does not allow.
 *
 * Simulated mode runs the same flow against a local copy of the policy checks, returning the same
 * error codes, so the demo works before an API key is configured.
 */

const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
const STOP_POLLING = new Set([...TERMINAL, "UNCERTAIN", "NEEDS_REVIEW", "PENDING_APPROVAL", "PENDING_SIGNATURE", "PENDING_DEPOSIT"]);
/** Refusals the wallet makes before anything leaves it. */
const POLICY_REFUSALS = new Set([
  "policy_action_denied",
  "policy_destination_denied",
  "policy_denied",
  "policy_schedule_denied",
  "spend_budget_exceeded",
  "insufficient_balance",
  "agent_frozen",
]);

let apiSingleton: AgentApi | undefined;
export function agentApi(): AgentApi {
  if (!config.apiKey) throw new Error("NEAR_INTENTS_AGENT_API_KEY is not set");
  apiSingleton ??= new AgentApi({ apiKey: config.apiKey, baseUrl: config.apiUrl });
  return apiSingleton;
}

export function brokerOwner() {
  const account = privateKeyToAccount(brokerOwnerKey());
  const owner: Extract<OwnerWallet, { type: "evm" }> = {
    type: "evm",
    address: account.address.toLowerCase() as `0x${string}`,
    chain_id: 1,
    public_key: `0x${account.publicKey.slice(4)}` as `0x${string}`,
  };
  return { account, owner };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function describeError(error: unknown): { code: string; detail: string } {
  if (error instanceof AgentApiError)
    return { code: error.code, detail: error.errors[0]?.detail ?? error.errors[0]?.title ?? error.message };
  if (error instanceof AgentApiRequestError) return { code: "request_failed", detail: error.message };
  return { code: "internal_error", detail: error instanceof Error ? error.message : String(error) };
}

async function waitForStatus(
  correlationId: string,
  timeoutMs = 240_000,
  stopOn: Set<string> = STOP_POLLING,
): Promise<StatusResponse> {
  const api = agentApi();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const status = await api.getStatus(correlationId, { waitMs: 25_000 });
    if (stopOn.has(status.status) || Date.now() > deadline) return status;
    if (status.status === "PENDING_SIGNATURE") await sleep(2_000);
  }
}

/** After a signed owner intent is submitted, only an outcome ends the wait. */
const OWNER_INTENT_DONE = new Set([...TERMINAL, "UNCERTAIN", "NEEDS_REVIEW"]);

/** Broker signs one owner intent (EIP-712), backend submits it, and we follow it to the end. */
async function runOwnerIntent(
  load: Load,
  step: string,
  request: Parameters<AgentApi["generateIntent"]>[0],
): Promise<{ generated: GenerateIntentResponse; status: StatusResponse }> {
  const api = agentApi();
  const { account } = brokerOwner();
  patchWallet(load.id, { provisioningStep: `${step}: preparing` });
  const generated = (await api.generateIntent(request, {
    idempotencyKey: `${request.type}-${load.id}`,
  })) as unknown as GenerateIntentResponse;
  recordIntent(load.id, {
    step,
    correlationId: generated.correlation_id,
    status: "PENDING_SIGNATURE",
    summary: generated.preview?.summary,
  });
  if (generated.intent.standard !== "eip712") throw new Error(`unexpected signing standard ${generated.intent.standard}`);

  patchWallet(load.id, { provisioningStep: `${step}: broker signing` });
  const signature = await account.signTypedData(generated.intent.payload as never);
  const signed: SignedData = { ...generated.intent, signature };
  await api.submitIntent({ type: generated.type, correlation_id: generated.correlation_id, signed_data: signed });

  patchWallet(load.id, { provisioningStep: `${step}: confirming` });
  const status = await waitForStatus(generated.correlation_id, 300_000, OWNER_INTENT_DONE);
  recordIntent(load.id, {
    step,
    correlationId: generated.correlation_id,
    status: status.status,
    summary: generated.preview?.summary,
  });
  if (status.status !== "SUCCESS") throw new Error(`${step} ended ${status.status}: ${status.failure_code ?? "no code"}`);
  return { generated, status };
}

async function waitForPolicyApplied(agentId: string) {
  const api = agentApi();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const view = await api.getPolicy(agentId);
    if (view.status === "APPLIED" && view.provider_policy_synced) return view;
    await sleep(3_000);
  }
  throw new Error("policy did not reach APPLIED in time");
}

// ── provisioning ───────────────────────────────────────────────────────────────────────────

const provisioning = (globalThis as unknown as { __provisioning?: Set<string> }).__provisioning ??= new Set();

export function isProvisioning(loadId: string) {
  return provisioning.has(loadId);
}

/**
 * Safe to run again after a crash or a failure: every owner intent uses a fixed idempotency key
 * per load, so a re-run replays the original intent instead of creating a second wallet.
 */
export async function provisionWallet(loadId: string) {
  if (provisioning.has(loadId)) return;
  provisioning.add(loadId);
  try {
    await provisionOnce(loadId);
  } finally {
    provisioning.delete(loadId);
  }
}

async function provisionOnce(loadId: string) {
  setStatus(loadId, "provisioning");
  const load = getLoad(loadId)!;
  const policy = buildLoadPolicy(load.rateCon);
  const { owner } = brokerOwner();
  patchWallet(load.id, { ownerAddress: owner.address, policy, provisioningError: undefined });

  try {
    if (load.mode === "simulated") {
      await provisionSimulated(load, policy);
    } else {
      await provisionLive(load, policy);
    }
    setStatus(load.id, "awaiting_funding");
    patchWallet(load.id, { provisioningStep: "ready" });
    addEvent(load.id, "wallet", "wallet_ready", "Load wallet is live and waiting for the broker's deposit", {
      agentId: getLoad(load.id)!.wallet.agentId,
    });
  } catch (error) {
    const { code, detail } = describeError(error);
    patchWallet(load.id, { provisioningError: `${code}: ${detail}` });
    setStatus(load.id, "failed");
    addEvent(load.id, "system", "wallet_failed", "Wallet provisioning failed", { code, detail });
  }
}

async function provisionLive(load: Load, policy: Policy) {
  const { owner } = brokerOwner();
  const created = await runOwnerIntent(load, "Create wallet + sign policy", {
    type: "agent_create",
    name: `Load ${load.rateCon.loadNumber}`.slice(0, 100),
    external_user_id: load.id,
    owner,
    policy,
  });
  const agentId = created.status.agent_id ?? created.generated.agent_id;
  if (!agentId) throw new Error("agent_create returned no agent id");
  patchWallet(load.id, {
    agentId,
    policyRevision: created.generated.preview?.revision ?? null,
    policyHash: created.generated.preview?.policy_hash ?? null,
  });
  addEvent(load.id, "broker", "policy_signed", "Broker signed the load wallet policy", {
    correlationId: created.generated.correlation_id,
    summary: created.generated.preview?.summary,
  });

  patchWallet(load.id, { provisioningStep: "Waiting for policy to apply on-chain" });
  const applied = await waitForPolicyApplied(agentId);
  const agent = await agentApi().getAgent(agentId);
  patchWallet(load.id, {
    policyRevision: applied.revision,
    policyHash: applied.policy_hash,
    ownerAccount: agent.owner_account?.account_id ?? null,
  });

  const credential = createGrantCredential();
  const expires = new Date(
    Math.min(
      Date.parse(load.rateCon.delivery.appointment) + 14 * 86_400_000,
      Date.now() + 300 * 86_400_000,
    ),
  );
  const grant = await runOwnerIntent(load, "Issue load-agent grant", {
    type: "grant_issue",
    agent_id: agentId,
    label: `Load agent ${load.rateCon.loadNumber}`.slice(0, 64),
    credential: credential.commitment,
    expires_at: (expires.getTime() > Date.now() ? expires : new Date(Date.now() + 7 * 86_400_000)).toISOString(),
  });
  const details = grant.status.details as { grant?: { grant_id: string } };
  patchWallet(load.id, { grantId: details.grant?.grant_id, grantTokenSealed: seal(credential.token) });
  addEvent(load.id, "broker", "grant_issued", "Broker granted the load agent spending access (inside the policy only)", {
    grantId: details.grant?.grant_id,
  });

  try {
    const balances = await agentApi().getBalances(agentId);
    patchWallet(load.id, { nearAccountId: balances.near_account_id });
  } catch {
    // Display-only; the balance poll fills it in later.
  }
}

async function provisionSimulated(load: Load, policy: Policy) {
  patchWallet(load.id, { provisioningStep: "Create wallet + sign policy: broker signing" });
  await sleep(600);
  const agentId = randomBytes(32).toString("hex");
  const createId = `intent_sim${randomBytes(20).toString("base64url")}`;
  recordIntent(load.id, { step: "Create wallet + sign policy", correlationId: createId, status: "SUCCESS", summary: "Create agent with load policy (simulated)" });
  patchWallet(load.id, { agentId, policyRevision: 1, policyHash: randomBytes(16).toString("hex"), balanceAtomic: "0" });
  addEvent(load.id, "broker", "policy_signed", "Broker signed the load wallet policy (simulated)", { policy });
  await sleep(400);
  const grantId = randomBytes(32).toString("hex");
  recordIntent(load.id, { step: "Issue load-agent grant", correlationId: `intent_sim${randomBytes(20).toString("base64url")}`, status: "SUCCESS", summary: "Grant for the load agent (simulated)" });
  patchWallet(load.id, { grantId, grantTokenSealed: seal(`ngt_sim_${randomBytes(16).toString("base64url")}`), nearAccountId: `${agentId.slice(0, 12)}.sim` });
  addEvent(load.id, "broker", "grant_issued", "Broker granted the load agent spending access (simulated)", { grantId });
}

// ── funding ────────────────────────────────────────────────────────────────────────────────

export function requiredFundingAtomic(load: Load) {
  return usdToAtomic(totalCommittedUsd(load.rateCon), config.settlementScale, config.payoutAssetDecimals);
}

export async function createDeposit(loadId: string) {
  const load = getLoad(loadId)!;
  if (!load.wallet.agentId) throw new Error("wallet is not provisioned yet");
  if (load.mode === "simulated") throw new Error("simulated wallets are funded with the simulate button");
  const attempt = (load.wallet.intents ?? []).filter((i) => i.step.startsWith("Deposit")).length + 1;
  const result = await agentApi().deposit(
    load.wallet.agentId,
    { origin_asset: config.fundingAsset },
    { idempotencyKey: `deposit-${load.id}-${attempt}` },
  );
  const details = result.details as {
    deposit_address?: string | null;
    memo?: string | null;
    min_amount?: string | null;
    expires_at?: string | null;
  };
  recordIntent(load.id, { step: `Deposit address #${attempt}`, correlationId: result.correlation_id, status: result.status });
  patchWallet(load.id, {
    deposit: {
      correlationId: result.correlation_id,
      address: details.deposit_address ?? null,
      memo: details.memo ?? null,
      minAmount: details.min_amount ?? null,
      expiresAt: details.expires_at ?? null,
      status: result.status,
      originAsset: config.fundingAsset,
    },
  });
  addEvent(load.id, "wallet", "deposit_address", "Deposit address issued for the broker", {
    address: details.deposit_address,
  });
  return getLoad(loadId)!;
}

export function simulateDeposit(loadId: string) {
  const load = getLoad(loadId)!;
  if (load.mode !== "simulated") throw new Error("only simulated wallets can be funded by simulation");
  const amount = requiredFundingAtomic(load);
  const balance = BigInt(load.wallet.balanceAtomic ?? "0") + amount;
  patchWallet(load.id, { balanceAtomic: balance.toString(), balanceCheckedAt: new Date().toISOString() });
  markFundedIfReady(loadId);
}

function markFundedIfReady(loadId: string) {
  const load = getLoad(loadId)!;
  if (load.status !== "awaiting_funding") return;
  const balance = BigInt(load.wallet.balanceAtomic ?? "0");
  if (balance >= requiredFundingAtomic(load)) {
    patchWallet(load.id, { fundedAtomic: balance.toString() });
    setStatus(load.id, "funded");
    addEvent(load.id, "broker", "funded", "Broker funded the load wallet. Carrier can see the money is committed.", {
      balanceAtomic: balance.toString(),
    });
  }
}

/** Reads the wallet balance (and the open deposit) from Agent Connect. */
export async function syncWallet(loadId: string) {
  const load = getLoad(loadId)!;
  if (load.mode === "simulated" || !load.wallet.agentId) return load;
  const api = agentApi();
  if (load.wallet.deposit && !TERMINAL.has(load.wallet.deposit.status)) {
    try {
      const status = await api.getStatus(load.wallet.deposit.correlationId);
      patchWallet(load.id, { deposit: { ...load.wallet.deposit, status: status.status } });
    } catch {
      // A transient read failure leaves the last known status in place.
    }
  }
  const balances = await api.getBalances(load.wallet.agentId, { asset: config.payoutAsset });
  const entry = balances.balances.find((b) => b.asset_id === config.payoutAsset);
  patchWallet(load.id, {
    balanceAtomic: entry?.balance_raw ?? "0",
    balanceCheckedAt: new Date().toISOString(),
    nearAccountId: balances.near_account_id,
  });
  markFundedIfReady(loadId);
  return getLoad(loadId)!;
}

// ── payouts ────────────────────────────────────────────────────────────────────────────────

/**
 * Sends one payout through the wallet. The payout row (with its idempotency key) already exists,
 * so a crash between here and the API can be replayed with the same key.
 */
export async function dispatchPayout(payoutId: string): Promise<Payout> {
  const payout = getPayout(payoutId)!;
  const load = getLoad(payout.loadId)!;
  updatePayout(payout.id, { status: "SUBMITTING" });
  if (load.mode === "simulated") return dispatchSimulated(load, payout);

  const api = agentApi();
  const agent = api.forGrant(unseal(load.wallet.grantTokenSealed!));
  const agentId = load.wallet.agentId!;
  const dest = toDestination(payout.destination);
  try {
    const result =
      dest.action === "transfer"
        ? await agent.transfer(
            agentId,
            { asset: config.payoutAsset, amount: payout.amountAtomic, recipient: dest.address },
            { idempotencyKey: payout.idempotencyKey },
          )
        : await agent.withdraw(
            agentId,
            {
              asset: config.payoutAsset,
              amount: payout.amountAtomic,
              chain: dest.chain,
              recipient: dest.address,
              ...(dest.memo ? { memo: dest.memo } : {}),
            },
            { idempotencyKey: payout.idempotencyKey },
          );
    const updated = updatePayout(payout.id, {
      status: result.status,
      correlationId: result.correlation_id,
      errorCode: result.failure_code ?? null,
      settledAt: result.status === "SUCCESS" ? new Date().toISOString() : null,
    });
    if (!TERMINAL.has(result.status)) void followPayout(payout.id);
    else onPayoutSettled(updated);
    return updated;
  } catch (error) {
    const { code, detail } = describeError(error);
    const blocked = POLICY_REFUSALS.has(code) || code.startsWith("policy_");
    const updated = updatePayout(payout.id, {
      status: blocked ? "BLOCKED" : "FAILED",
      errorCode: code,
      errorDetail: detail,
    });
    onPayoutRefused(updated);
    return updated;
  }
}

async function followPayout(payoutId: string) {
  const payout = getPayout(payoutId)!;
  if (!payout.correlationId) return;
  try {
    const status = await waitForStatus(payout.correlationId, 600_000);
    const updated = updatePayout(payout.id, {
      status: status.status,
      errorCode: status.failure_code ?? null,
      settledAt: status.status === "SUCCESS" ? new Date().toISOString() : null,
    });
    if (status.status === "SUCCESS") onPayoutSettled(updated);
    else if (TERMINAL.has(status.status)) onPayoutRefused(updated);
  } catch {
    // The next detail-page load re-reads the status.
  }
}

/** Re-reads any payout still in flight. Called lazily from the load detail endpoint. */
export async function refreshInFlightPayouts(loadId: string) {
  const load = getLoad(loadId)!;
  if (load.mode === "simulated") return;
  const pending = listPayouts(loadId).filter((p) => p.correlationId && !TERMINAL.has(p.status) && p.status !== "BLOCKED");
  for (const payout of pending) {
    try {
      const status = await agentApi().getStatus(payout.correlationId!);
      if (status.status === payout.status) continue;
      const updated = updatePayout(payout.id, {
        status: status.status,
        errorCode: status.failure_code ?? null,
        settledAt: status.status === "SUCCESS" ? new Date().toISOString() : null,
      });
      if (status.status === "SUCCESS") onPayoutSettled(updated);
    } catch {
      // Leave it for the next refresh.
    }
  }
}

function onPayoutSettled(payout: Payout) {
  addEvent(payout.loadId, "wallet", "payout_settled", `Wallet paid ${payout.destination.label}`, {
    payoutId: payout.id,
    kind: payout.kind,
    amountUsd: payout.amountUsd,
    correlationId: payout.correlationId,
  });
  const load = getLoad(payout.loadId)!;
  if (load.mode === "live") void syncWallet(load.id).catch(() => undefined);
}

function onPayoutRefused(payout: Payout) {
  addEvent(
    payout.loadId,
    "wallet",
    payout.status === "BLOCKED" ? "payout_blocked" : "payout_failed",
    payout.status === "BLOCKED"
      ? `Wallet policy blocked a payment to ${payout.destination.label}`
      : `Payment to ${payout.destination.label} failed`,
    { payoutId: payout.id, kind: payout.kind, code: payout.errorCode, detail: payout.errorDetail },
  );
}

// ── simulated policy engine ────────────────────────────────────────────────────────────────

function dispatchSimulated(load: Load, payout: Payout): Payout {
  const policy = load.wallet.policy as Policy;
  const asset = config.payoutAsset;
  const amount = BigInt(payout.amountAtomic);
  const dest = toDestination(payout.destination);
  const refuse = (code: string, detail: string) => {
    const updated = updatePayout(payout.id, { status: "BLOCKED", errorCode: code, errorDetail: detail });
    onPayoutRefused(updated);
    return updated;
  };

  if (policy.frozen) return refuse("agent_frozen", "The owner froze this agent account.");
  if (!policy.actions.includes(dest.action)) return refuse("policy_action_denied", `The policy does not allow ${dest.action}.`);
  if (policy.assets !== "any" && !policy.assets.includes(asset)) return refuse("policy_denied", "Asset is not on the policy's list.");
  if (policy.destinations.mode === "only" && !policy.destinations.list.some((d) => sameDestination(d, dest)))
    return refuse("policy_destination_denied", "Destination is not on the policy's allowlist.");
  const perTx = policy.limits.per_transaction?.[asset];
  if (perTx && amount > BigInt(perTx)) return refuse("policy_denied", "Amount exceeds the per-transaction limit.");

  const spentUsd = listPayouts(load.id)
    .filter((p) => p.status === "SUCCESS")
    .reduce((sum, p) => sum + p.amountUsd * config.settlementScale, 0);
  const budget = policy.budget.daily_usd ? Number(policy.budget.daily_usd) : Infinity;
  if (spentUsd + payout.amountUsd * config.settlementScale > budget + 1e-9)
    return refuse("spend_budget_exceeded", "This payment would exceed the account's USD budget.");

  const balance = BigInt(load.wallet.balanceAtomic ?? "0");
  if (amount > balance) return refuse("insufficient_balance", "The wallet does not hold enough USDC.");

  patchWallet(load.id, { balanceAtomic: (balance - amount).toString(), balanceCheckedAt: new Date().toISOString() });
  const updated = updatePayout(payout.id, {
    status: "SUCCESS",
    correlationId: `op_sim${randomBytes(30).toString("base64url").slice(0, 40)}`,
    settledAt: new Date().toISOString(),
  });
  onPayoutSettled(updated);
  return updated;
}

// ── health ─────────────────────────────────────────────────────────────────────────────────

export async function connectionStatus() {
  const base = {
    mode: config.mode,
    apiUrl: config.apiUrl,
    asset: config.payoutAsset,
    assetSymbol: config.payoutAssetSymbol,
    settlementScale: config.settlementScale,
    verifier: config.anthropicConfigured ? config.verifierModel : null,
    brokerOwner: brokerOwner().owner.address,
  };
  if (config.mode !== "live") return { ...base, network: null, partner: null, error: null };
  try {
    const api = agentApi();
    const [network, me] = await Promise.all([api.getNetwork(), api.whoami()]);
    return { ...base, network, partner: me, error: null };
  } catch (error) {
    return { ...base, network: null, partner: null, error: describeError(error) };
  }
}
