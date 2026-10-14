import "server-only";
import { AgentApi, AgentApiError, AgentApiRequestError, type StatusResponse } from "@near-intents-agent-api/sdk";
import { GatewayError, type OperationStatus, type WalletGateway } from "./types";

/**
 * The SDK asks fetch for `credentials: "omit"` and `redirect: "error"`. Workers' fetch implements
 * neither, and never sends cookies anyway, so drop the first and refuse redirects by hand.
 */
const workersFetch: typeof fetch = async (input, init) => {
  const rest: RequestInit = { ...init };
  const redirect = rest.redirect;
  delete rest.credentials;
  const response = await fetch(input, { ...rest, redirect: redirect === "error" ? "manual" : redirect });
  if (redirect === "error" && response.status >= 300 && response.status < 400) throw new TypeError("Agent Connect redirected the request");
  return response;
};

/** Agent Connect on mainnet, through the official SDK. */
export function liveGateway(apiKey: string, baseUrl: string): WalletGateway {
  const api = new AgentApi({ apiKey, baseUrl, fetch: workersFetch });

  const wrap = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AgentApiError)
        throw new GatewayError(error.code, error.errors[0]?.detail ?? error.errors[0]?.title ?? error.message, error.retryable);
      if (error instanceof AgentApiRequestError) throw new GatewayError("request_failed", error.message, true);
      throw error;
    }
  };

  const toStatus = (s: Pick<StatusResponse, "correlation_id" | "status" | "failure_code" | "agent_id" | "details">): OperationStatus => ({
    correlationId: s.correlation_id,
    status: s.status,
    failureCode: s.failure_code ?? null,
    agentId: s.agent_id ?? null,
    details: (s.details ?? {}) as Record<string, unknown>,
  });

  return {
    mode: "live",

    generateOwnerIntent: (request, idempotencyKey) =>
      wrap(async () => (await api.generateIntent(request as never, { idempotencyKey })) as never),

    submitOwnerIntent: (type, correlationId, signed) =>
      wrap(async () => toStatus(await api.submitIntent({ type: type as never, correlation_id: correlationId, signed_data: signed }))),

    status: (correlationId) => wrap(async () => toStatus(await api.getStatus(correlationId))),

    policy: (agentId) =>
      wrap(async () => {
        const view = await api.getPolicy(agentId);
        return { applied: view.status === "APPLIED" && view.provider_policy_synced, revision: view.revision, policy: view.policy };
      }),

    deposit: (agentId, originAsset, amountAtomic, idempotencyKey) =>
      wrap(async () => {
        const result = await api.deposit(agentId, { origin_asset: originAsset, amount: amountAtomic }, { idempotencyKey });
        const d = result.details as Record<string, string | null | undefined>;
        return {
          correlationId: result.correlation_id,
          status: result.status,
          address: d.deposit_address ?? null,
          memo: d.memo ?? null,
          minAmountAtomic: d.min_amount ?? null,
          expiresAt: d.expires_at ?? null,
        };
      }),

    balance: (agentId, asset) =>
      wrap(async () => {
        const view = await api.getBalances(agentId, { asset });
        const entry = view.balances.find((b) => b.asset_id === asset);
        return { atomic: entry?.balance_raw ?? "0", nearAccountId: view.near_account_id };
      }),

    send: ({ agentId, grantToken, asset, amountAtomic, destination, idempotencyKey }) =>
      wrap(async () => {
        const agent = api.forGrant(grantToken);
        const result =
          destination.kind === "transfer"
            ? await agent.transfer(agentId, { asset, amount: amountAtomic, recipient: destination.account }, { idempotencyKey })
            : await agent.withdraw(
                agentId,
                { asset, amount: amountAtomic, chain: destination.chain, recipient: destination.address },
                { idempotencyKey },
              );
        return toStatus(result as unknown as StatusResponse);
      }),

    health: async () => {
      try {
        const network = await api.getNetwork();
        return {
          ok: network.status.overall === "operational",
          network: network.network,
          components: network.status.components.map((c) => ({ id: c.id, status: c.status })),
        };
      } catch (error) {
        console.error("[gateway] network check failed", error);
        return { ok: false, network: null, components: [] };
      }
    },
  };
}
