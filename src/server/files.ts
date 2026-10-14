import "server-only";
import { runtime } from "./runtime";

/** Proof media in R2, keyed by load. */

const SAFE = /^[A-Za-z0-9._-]+$/;

export async function putProofFile(loadId: string, name: string, data: Uint8Array, contentType: string) {
  if (!SAFE.test(name)) throw new Error("unsafe file name");
  await (await runtime()).bucket.put(`${loadId}/${name}`, data, { httpMetadata: { contentType } });
  return name;
}

export async function getProofFile(loadId: string, name: string) {
  if (!SAFE.test(loadId) || !SAFE.test(name)) return null;
  const object = await (await runtime()).bucket.get(`${loadId}/${name}`);
  if (!object) return null;
  return { data: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType ?? "application/octet-stream" };
}
