export async function getCloudflareContext(): Promise<never> {
  throw new Error("tests inject the runtime with setRuntimeForTests");
}
export function initOpenNextCloudflareForDev() {}
