import "server-only";
import type { GenerateIntentResponse, OwnerWallet, SignedData } from "@near-intents-agent-api/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { secrets } from "./config";

/**
 * The company as owner of every load wallet ("company-as-owner"). Its EVM key lives only in the
 * Worker's secrets and signs owner intents (EIP-712) exactly as Agent Connect returns them.
 */
export async function companyOwner() {
  const account = privateKeyToAccount(await secrets.ownerKey());
  const owner: Extract<OwnerWallet, { type: "evm" }> = {
    type: "evm",
    address: account.address.toLowerCase() as `0x${string}`,
    chain_id: 1,
    public_key: `0x${account.publicKey.slice(4)}` as `0x${string}`,
  };
  return { account, owner };
}

export async function signAsCompany(generated: GenerateIntentResponse): Promise<SignedData> {
  if (generated.intent.standard !== "eip712") throw new Error(`company key cannot sign ${generated.intent.standard}`);
  const { account } = await companyOwner();
  const signature = await account.signTypedData(generated.intent.payload as never);
  return { ...generated.intent, signature };
}
