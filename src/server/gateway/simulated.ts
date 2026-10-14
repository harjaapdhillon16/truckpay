import "server-only";
import { createHash } from "node:crypto";
import type { GenerateIntentResponse, Policy } from "@near-intents-agent-api/sdk";
import { toPolicyDestination } from "../policy";
import { GatewayError, type OperationStatus, type WalletGateway } from "./types";

/**
 * A local stand-in for Agent Connect: the same calls, the same policy checks and the same error
 * codes, kept in memory. For tests and keyless local development only.
 */

type SimAgent = { policy: Policy; balance: bigint; grants: Set<string>; nearAccountId: string };
type SimOp = { status: string; agentId: string | null; failureCode: string | null; details: Record<string, unknown>; polls: number };
type SimState = {
  agents: Map<string, SimAgent>;
  ops: Map<string, SimOp>;
  intents: Map<string, { request: Record<string, unknown>; agentId: string | null }>;
  keys: Map<string, string>;
  /** Tests: the status the next `send` reports instead of PROCESSING. */
  nextSendStatus: string | null;
};

const g = globalThis as unknown as { __simWallet?: SimState };
const state = (): SimState =>
  (g.__simWallet ??= { agents: new Map(), ops: new Map(), intents: new Map(), keys: new Map(), nextSendStatus: null });

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
const opId = (prefix: "op" | "intent") => `${prefix}_${rand(32).slice(0, 43).padEnd(43, "0")}`;

export const simulator = {
  /** Credits a simulated deposit to the agent's balance. */
  credit(agentId: string, atomic: bigint) {
    const agent = state().agents.get(agentId);
    if (!agent) throw new Error("unknown simulated agent");
    agent.balance += atomic;
  },
  failNextSendWith(status: string | null) {
    state().nextSendStatus = status;
  },
  /** Tests: settle an operation reported UNCERTAIN. */
  resolve(correlationId: string, status: string) {
    const op = state().ops.get(correlationId);
    if (op) op.status = status;
  },
  reset() {
    g.__simWallet = undefined;
  },
};

function sameDestination(a: Policy["destinations"]["list"][number], b: Policy["destinations"]["list"][number]) {
  if (a.action !== b.action) return false;
  if (a.action === "transfer" && b.action === "transfer") return a.address === b.address;
  if (a.action === "withdraw" && b.action === "withdraw") return a.chain === b.chain && a.address === b.address && (a.memo ?? null) === (b.memo ?? null);
  return false;
}

export function simulatedGateway(): WalletGateway {
  const s = state();
  const statusOf = (id: string): OperationStatus => {
    const op = s.ops.get(id);
    if (!op) throw new GatewayError("not_found", "Unknown correlation id.", false);
    // Payments settle on the second read, so callers exercise their polling path.
    op.polls += 1;
    if (op.status === "PROCESSING" && op.polls >= 1) op.status = "SUCCESS";
    return { correlationId: id, status: op.status, failureCode: op.failureCode, agentId: op.agentId, details: op.details };
  };

  return {
    mode: "simulated",

    async generateOwnerIntent(request, key) {
      const existing = s.keys.get(key);
      const correlationId = existing ?? opId("intent");
      s.keys.set(key, correlationId);
      const r = request as unknown as Record<string, unknown>;
      const agentId = r.type === "agent_create" ? (s.intents.get(correlationId)?.agentId ?? rand(32)) : ((r.agent_id as string) ?? null);
      s.intents.set(correlationId, { request: r, agentId });
      if (!s.ops.has(correlationId)) s.ops.set(correlationId, { status: "PENDING_SIGNATURE", agentId, failureCode: null, details: {}, polls: 0 });
      return {
        type: r.type,
        correlation_id: correlationId,
        agent_id: agentId,
        signer: {},
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        preview: {
          summary: r.type === "agent_create" ? "Create a simulated load wallet with this policy" : "Issue a simulated grant to the load agent",
          ...(r.policy ? { policy: r.policy } : {}),
        },
        intent: {
          standard: "eip712",
          payload: {
            domain: { name: "LoadWallet Simulator", version: "1", chainId: 1 },
            types: { Intent: [{ name: "correlation", type: "string" }] },
            primaryType: "Intent",
            message: { correlation: correlationId },
          },
        },
      } as unknown as GenerateIntentResponse;
    },

    async submitOwnerIntent(_type, correlationId) {
      const intent = s.intents.get(correlationId);
      const op = s.ops.get(correlationId);
      if (!intent || !op) throw new GatewayError("not_found", "Unknown intent.", false);
      if (op.status === "PENDING_SIGNATURE") {
        if (intent.request.type === "agent_create") {
          s.agents.set(intent.agentId!, { policy: intent.request.policy as Policy, balance: 0n, grants: new Set(), nearAccountId: `${intent.agentId!.slice(0, 16)}.sim` });
          op.details = { agent_id: intent.agentId };
        } else if (intent.request.type === "grant_issue") {
          s.agents.get(intent.agentId!)!.grants.add(intent.request.credential as string);
          op.details = { grant: { grant_id: rand(32), label: intent.request.label } };
        }
        op.status = "SUCCESS";
      }
      return statusOf(correlationId);
    },

    async status(correlationId) {
      return statusOf(correlationId);
    },

    async policy(agentId) {
      const agent = s.agents.get(agentId);
      if (!agent) throw new GatewayError("not_found", "Unknown agent.", false);
      return { applied: true, revision: 1, policy: agent.policy };
    },

    async deposit(agentId, _asset, amountAtomic, key) {
      const correlationId = s.keys.get(key) ?? opId("op");
      s.keys.set(key, correlationId);
      if (!s.ops.has(correlationId)) s.ops.set(correlationId, { status: "PENDING_DEPOSIT", agentId, failureCode: null, details: {}, polls: 0 });
      return { correlationId, status: "PENDING_DEPOSIT", address: `sim-deposit-${agentId.slice(0, 8)}`, memo: null, minAmountAtomic: amountAtomic, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    },

    async balance(agentId) {
      const agent = s.agents.get(agentId);
      if (!agent) throw new GatewayError("not_found", "Unknown agent.", false);
      return { atomic: agent.balance.toString(), nearAccountId: agent.nearAccountId };
    },

    async send({ agentId, grantToken, asset, amountAtomic, destination, idempotencyKey }) {
      const replay = s.keys.get(idempotencyKey);
      if (replay) return statusOf(replay);
      const agent = s.agents.get(agentId);
      if (!agent) throw new GatewayError("not_found", "Unknown agent.", false);
      const commitment = createHash("sha256").update(grantToken).digest("hex");
      if (!agent.grants.has(commitment)) throw new GatewayError("grant_invalid", "The grant token is not valid for this agent.", false);
      const policy = agent.policy;
      const dest = toPolicyDestination(destination);
      const amount = BigInt(amountAtomic);
      if (policy.frozen) throw new GatewayError("agent_frozen", "The owner froze this agent account.", false);
      if (!policy.actions.includes(dest.action)) throw new GatewayError("policy_action_denied", `The policy does not allow ${dest.action}.`, false);
      if (policy.assets !== "any" && !policy.assets.includes(asset)) throw new GatewayError("policy_denied", "Asset is not on the policy's list.", false);
      if (policy.destinations.mode === "only" && !policy.destinations.list.some((d) => sameDestination(d, dest)))
        throw new GatewayError("policy_destination_denied", "Destination is not on the policy's allowlist.", false);
      const perTx = policy.limits.per_transaction?.[asset];
      if (perTx && amount > BigInt(perTx)) throw new GatewayError("policy_denied", "Amount exceeds the per-transaction limit.", false);
      if (amount > agent.balance) throw new GatewayError("insufficient_balance", "The wallet does not hold enough USDC.", false);

      agent.balance -= amount;
      const correlationId = opId("op");
      s.keys.set(idempotencyKey, correlationId);
      const status = s.nextSendStatus ?? "PROCESSING";
      s.nextSendStatus = null;
      s.ops.set(correlationId, { status, agentId, failureCode: null, details: {}, polls: 0 });
      return { correlationId, status, failureCode: null, agentId, details: {} };
    },

    async health() {
      return { ok: true, network: "simulated", components: [] };
    },
  };
}
