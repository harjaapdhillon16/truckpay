import "server-only";

/**
 * Runtime configuration. Everything has a demo-safe default so the app boots with no `.env`:
 * without an Agent Connect API key it runs a local simulation of the wallet policy engine, and
 * without an Anthropic key the proof verifier falls back to deterministic checks only.
 */

const env = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

/** USDC on Base, as NEAR Intents names it. Brokers can fund from Coinbase or any Base wallet. */
const DEFAULT_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export const config = {
  apiKey: env("NEAR_INTENTS_AGENT_API_KEY"),
  apiUrl: env("NEAR_INTENTS_AGENT_API_URL") ?? "https://api.demo.agentsonintents.com",

  /** `live` talks to Agent Connect on mainnet; `simulated` mirrors its policy checks locally. */
  get mode(): "live" | "simulated" {
    const forced = env("AGENT_CONNECT_MODE");
    if (forced === "simulated") return "simulated";
    return this.apiKey ? "live" : "simulated";
  },

  /** Asset the load wallet holds and pays out in. */
  payoutAsset: env("PAYOUT_ASSET") ?? DEFAULT_ASSET,
  payoutAssetSymbol: env("PAYOUT_ASSET_SYMBOL") ?? "USDC",
  payoutAssetDecimals: Number(env("PAYOUT_ASSET_DECIMALS") ?? 6),
  /** Asset the broker sends to the deposit address. Defaults to the payout asset. */
  get fundingAsset() {
    return env("FUNDING_ORIGIN_ASSET") ?? this.payoutAsset;
  },

  /**
   * The hosted API is mainnet with real funds. Contract dollars are multiplied by this factor
   * before they touch the chain, so a $2,500 load settles as 2.50 USDC in the demo.
   * Set to 1 for real-size loads.
   */
  settlementScale: Number(env("SETTLEMENT_SCALE") ?? 0.001),

  /** Broker owner key (EVM). Generated into ./data on first run when not provided. */
  brokerOwnerKey: env("BROKER_OWNER_EVM_PRIVATE_KEY"),

  anthropicConfigured: Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")),
  verifierModel: env("VERIFIER_MODEL") ?? "claude-opus-5-5",

  /** Public origin used in driver links. */
  publicUrl: env("PUBLIC_URL"),

  dataDir: env("DATA_DIR") ?? `${process.cwd()}/data`,
};
