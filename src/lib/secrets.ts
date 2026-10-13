import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { generatePrivateKey } from "viem/accounts";
import { config } from "./config";
import { kvGet, kvSet } from "./db";

/**
 * Demo key material.
 *
 * - The broker's owner key signs wallet creation, policies and grants (EIP-712). In production it
 *   lives in the broker's own wallet (MetaMask, passkey); the backend only relays the payload.
 * - Grant tokens let the load agent spend inside the policy. They are encrypted at rest.
 */

export function brokerOwnerKey(): `0x${string}` {
  if (config.brokerOwnerKey) {
    const key = config.brokerOwnerKey;
    return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  }
  let key = kvGet("broker_owner_evm_key");
  if (!key) {
    key = generatePrivateKey();
    kvSet("broker_owner_evm_key", key);
  }
  return key as `0x${string}`;
}

function sealingKey(): Buffer {
  let key = kvGet("sealing_key");
  if (!key) {
    key = randomBytes(32).toString("base64");
    kvSet("sealing_key", key);
  }
  return Buffer.from(key, "base64");
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

export function unseal(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
