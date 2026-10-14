import "server-only";
import { secrets } from "./config";

/** AES-GCM sealing for grant tokens at rest (Web Crypto, so it runs on Workers and Node). */

async function key() {
  const raw = Uint8Array.from(atob(await secrets.sealingKey()), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plaintext)));
  return `${b64(iv)}.${b64(body)}`;
}

export async function unseal(sealed: string) {
  const [iv, body] = sealed.split(".").map(unb64);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), body));
}
