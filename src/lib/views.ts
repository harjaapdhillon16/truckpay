import "server-only";
import { ledger } from "./agent";
import { config } from "./config";
import { listEvents, listPayouts, listProofs } from "./store";
import type { Load } from "./types";
import { isProvisioning, requiredFundingAtomic } from "./wallet";

/** What the broker dashboard sees. The sealed grant token never leaves the server. */
export function loadView(load: Load, origin: string) {
  const { grantTokenSealed: _sealed, ...wallet } = load.wallet;
  return {
    ...load,
    wallet: { ...wallet, hasGrant: Boolean(_sealed) },
    driverUrl: `${config.publicUrl ?? origin}/driver/${load.driverToken}`,
    /** False while status says provisioning means the setup was interrupted and can be retried. */
    provisioningActive: isProvisioning(load.id),
    ledger: ledger(load),
    funding: {
      requiredAtomic: requiredFundingAtomic(load).toString(),
      asset: config.payoutAsset,
      fundingAsset: config.fundingAsset,
      symbol: config.payoutAssetSymbol,
      decimals: config.payoutAssetDecimals,
      scale: config.settlementScale,
    },
  };
}

export function loadDetail(load: Load, origin: string) {
  return {
    load: loadView(load, origin),
    events: listEvents(load.id),
    payouts: listPayouts(load.id),
    proofs: listProofs(load.id),
  };
}

/** What the driver's phone sees: the trip, the rules that pay them and what has been paid. */
export function driverView(load: Load) {
  const rc = load.rateCon;
  const payouts = listPayouts(load.id).filter((p) => ["fuel_advance", "detention", "lumper", "final"].includes(p.kind));
  const proofs = listProofs(load.id).map((p) => ({
    id: p.id,
    kind: p.kind,
    createdAt: p.createdAt,
    distanceM: p.distanceM,
    decision: p.verdict?.decision ?? null,
    summary: p.verdict?.summary ?? null,
  }));
  return {
    ref: load.ref,
    status: load.status,
    mode: load.mode,
    funded: !["provisioning", "awaiting_funding", "failed"].includes(load.status),
    rateCon: {
      loadNumber: rc.loadNumber,
      commodity: rc.commodity,
      equipment: rc.equipment,
      pickup: rc.pickup,
      delivery: rc.delivery,
      carrierName: rc.carrier.name,
      driverName: rc.carrier.driverName,
      payoutLabel: rc.carrier.payout.label,
      linehaulUsd: rc.linehaulUsd,
      fuelAdvancePct: rc.fuelAdvancePct,
      detention: rc.detention,
      lumperCapUsd: rc.lumperCapUsd,
      hasLumper: Boolean(rc.lumperService),
      geofenceMeters: rc.geofenceMeters,
    },
    ledger: ledger(load),
    payouts: payouts.map((p) => ({
      id: p.id,
      kind: p.kind,
      amountUsd: p.amountUsd,
      status: p.status,
      destination: p.destination.label,
      createdAt: p.createdAt,
      settledAt: p.settledAt,
    })),
    proofs,
  };
}
