import "server-only";
import { requiredSetting, setting } from "./runtime";

/** USDC on Base, as NEAR Intents names it. */
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export type AppConfig = Awaited<ReturnType<typeof appConfig>>;

/** Non-secret configuration, read per request (Worker vars can change between deploys). */
export async function appConfig() {
  const apiKey = await setting("NEAR_INTENTS_AGENT_API_KEY");
  const forced = await setting("AGENT_CONNECT_MODE");
  return {
    mode: (forced === "simulated" || !apiKey ? "simulated" : "live") as "live" | "simulated",
    apiUrl: (await setting("NEAR_INTENTS_AGENT_API_URL")) ?? "https://api.demo.agentsonintents.com",
    payoutAsset: (await setting("PAYOUT_ASSET")) ?? BASE_USDC,
    assetSymbol: "USDC",
    assetDecimals: 6,
    /** Contract dollars × scale = on-chain USDC. */
    scale: Number((await setting("SETTLEMENT_SCALE")) ?? 0.001),
    verifierModel: (await setting("VERIFIER_MODEL")) ?? "claude-opus-5-5",
    aiEnabled: Boolean(await setting("ANTHROPIC_API_KEY")),
    demoFeatures: (await setting("DEMO_FEATURES")) === "true",
    refundAccount: (await setting("COMPANY_REFUND_NEAR_ACCOUNT")) ?? null,
    demoCarrierBaseAddress: (await setting("DEMO_CARRIER_BASE_ADDRESS")) ?? null,
    demoCarrierNearAccount: (await setting("DEMO_CARRIER_NEAR_ACCOUNT")) ?? null,
    geofenceMeters: Number((await setting("GEOFENCE_METERS")) ?? 1000),
  };
}

export const secrets = {
  apiKey: () => requiredSetting("NEAR_INTENTS_AGENT_API_KEY"),
  ownerKey: async () => {
    const key = (await setting("COMPANY_OWNER_EVM_PRIVATE_KEY")) ?? (await requiredSetting("BROKER_OWNER_EVM_PRIVATE_KEY"));
    return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  },
  sealingKey: () => requiredSetting("GRANT_SEALING_KEY"),
  passcode: () => setting("COMPANY_PASSCODE"),
  tickSecret: () => setting("TICK_SECRET"),
  anthropicKey: () => setting("ANTHROPIC_API_KEY"),
};
