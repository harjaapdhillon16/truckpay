/** Contract dollars → on-chain atomic units, after the demo settlement scale. */
export function usdToAtomic(usd: number, scale: number, decimals: number): bigint {
  const units = Math.round(usd * scale * 10 ** Math.min(decimals, 12));
  return BigInt(units) * 10n ** BigInt(Math.max(decimals - 12, 0));
}

export function atomicToUnits(atomic: string | bigint, decimals: number): number {
  return Number(BigInt(atomic)) / 10 ** decimals;
}

/** On-chain units back to contract dollars. */
export function atomicToUsd(atomic: string | bigint, scale: number, decimals: number): number {
  return atomicToUnits(atomic, decimals) / scale;
}

export function usd(value: number, opts: { cents?: boolean } = {}) {
  const cents = opts.cents ?? !Number.isInteger(value);
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function tokenAmount(atomic: string | bigint, decimals: number, symbol: string) {
  const units = atomicToUnits(atomic, decimals);
  return `${units.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`;
}
