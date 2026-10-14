import type { GenerateIntentRequest, GenerateIntentResponse, Policy, SignedData } from "@near-intents-agent-api/sdk";
import type { Destination } from "@/lib/domain";

/**
 * The only door to Agent Connect. Every method is a single non-blocking call: callers that need
 * to wait poll `status` on a later step (Workers can't run long background loops).
 */
export interface WalletGateway {
  mode: "live" | "simulated";

  /** Owner intents: generate → (company signs) → submit. Same idempotency key replays the same intent. */
  generateOwnerIntent(request: GenerateIntentRequest, idempotencyKey: string): Promise<GenerateIntentResponse>;
  submitOwnerIntent(type: string, correlationId: string, signed: SignedData): Promise<OperationStatus>;

  status(correlationId: string): Promise<OperationStatus>;
  policy(agentId: string): Promise<{ applied: boolean; revision: number | null; policy: Policy | null }>;
  /** An exact-amount deposit address: its minimum equals the amount, unlike open deposits (150 USDC on Base). */
  deposit(agentId: string, originAsset: string, amountAtomic: string, idempotencyKey: string): Promise<DepositInfo>;
  balance(agentId: string, asset: string): Promise<{ atomic: string; nearAccountId: string | null }>;

  /** Sends money under the load agent's grant. Throws GatewayError on a refusal. */
  send(input: {
    agentId: string;
    grantToken: string;
    asset: string;
    amountAtomic: string;
    destination: Destination;
    idempotencyKey: string;
  }): Promise<OperationStatus>;

  health(): Promise<{ ok: boolean; network: string | null; components: { id: string; status: string }[] }>;
}

export type OperationStatus = {
  correlationId: string;
  status: string;
  failureCode: string | null;
  agentId: string | null;
  details: Record<string, unknown>;
};

export type DepositInfo = {
  correlationId: string;
  status: string;
  address: string | null;
  memo: string | null;
  minAmountAtomic: string | null;
  expiresAt: string | null;
};

/** Codes Agent Connect uses when the account's rules refuse a payment before anything is sent. */
export const POLICY_REFUSALS = new Set([
  "policy_action_denied",
  "policy_destination_denied",
  "policy_denied",
  "policy_schedule_denied",
  "policy_not_ready",
  "spend_budget_exceeded",
  "insufficient_balance",
  "agent_frozen",
  "grant_invalid",
  "grant_expired",
  "grant_revoked",
]);

export class GatewayError extends Error {
  constructor(
    public code: string,
    public detail: string,
    /** Safe to repeat the identical request under the same idempotency key later. */
    public retryable: boolean,
  ) {
    super(`${code}: ${detail}`);
  }

  get isPolicyRefusal() {
    return POLICY_REFUSALS.has(this.code) || this.code.startsWith("policy_") || this.code.startsWith("grant_");
  }
}

export const TERMINAL_OPERATION = new Set(["SUCCESS", "FAILED", "REFUNDED"]);
