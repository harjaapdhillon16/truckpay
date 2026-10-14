import "server-only";
import { appConfig, secrets } from "../config";
import { liveGateway } from "./live";
import { simulatedGateway } from "./simulated";
import type { WalletGateway } from "./types";

export { GatewayError, TERMINAL_OPERATION } from "./types";
export type { WalletGateway, OperationStatus } from "./types";

/** The adapter is chosen by configuration only: live when an Agent Connect key is set. */
export async function gateway(): Promise<WalletGateway> {
  const config = await appConfig();
  if (config.mode === "simulated") return simulatedGateway();
  return liveGateway(await secrets.apiKey(), config.apiUrl);
}
