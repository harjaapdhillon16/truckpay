// Generates the demo company keys into an env file, once. Existing values are never overwritten.
// Usage: node scripts/generate-demo-keys.mjs .env.local
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const envPath = process.argv[2];
let env = readFileSync(envPath, "utf8");
const has = (k) => new RegExp(`^${k}=.+$`, "m").test(env);
const set = (k, v) => {
  if (has(k)) return;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : env + `\n${k}=${v}`;
};
const evm = () => { const k = generatePrivateKey(); return { k, a: privateKeyToAccount(k).address.toLowerCase() }; };
const owner = evm(), carrier = evm(), refundEvm = evm();
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubRaw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
set("BROKER_OWNER_EVM_PRIVATE_KEY", owner.k);
set("COMPANY_REFUND_NEAR_ACCOUNT", pubRaw.toString("hex"));
set("COMPANY_REFUND_NEAR_SEED_HEX", seed.toString("hex"));
set("COMPANY_REFUND_BASE_ADDRESS", refundEvm.a);
set("COMPANY_REFUND_BASE_PRIVATE_KEY", refundEvm.k);
set("DEMO_CARRIER_BASE_ADDRESS", carrier.a);
{
  // The demo carrier's NEAR Intents account: an implicit account (hex of an ed25519 public key).
  const pair = generateKeyPairSync("ed25519");
  set("DEMO_CARRIER_NEAR_ACCOUNT", pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex"));
  set("DEMO_CARRIER_NEAR_SEED_HEX", pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex"));
}
set("DEMO_CARRIER_BASE_PRIVATE_KEY", carrier.k);
set("GRANT_SEALING_KEY", randomBytes(32).toString("base64"));
set("COMPANY_PASSCODE", randomBytes(9).toString("base64url"));
writeFileSync(envPath, env.endsWith("\n") ? env : env + "\n");
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1];
console.log("owner address      ", privateKeyToAccount(pick("BROKER_OWNER_EVM_PRIVATE_KEY")).address.toLowerCase());
console.log("refund NEAR account", pick("COMPANY_REFUND_NEAR_ACCOUNT"));
console.log("refund Base address", pick("COMPANY_REFUND_BASE_ADDRESS"));
console.log("carrier Base addr  ", pick("DEMO_CARRIER_BASE_ADDRESS"));
console.log("carrier NEAR acct  ", pick("DEMO_CARRIER_NEAR_ACCOUNT"));
