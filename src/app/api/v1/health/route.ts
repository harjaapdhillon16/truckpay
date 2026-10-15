import { appConfig } from "@/server/config";
import { companyOwner } from "@/server/company";
import { gateway } from "@/server/gateway";
import { publicRoute } from "@/server/http";

export const GET = publicRoute(async () => {
  const config = await appConfig();
  const health = await (await gateway()).health();
  return Response.json({
    ok: health.ok,
    mode: config.mode,
    network: health.network,
    components: health.components,
    scale: config.scale,
    asset: config.assetSymbol,
    aiReview: config.aiEnabled ? config.verifierModel : null,
    owner: (await companyOwner()).owner.address,
    demoFeatures: config.demoFeatures,
    testMoney: config.testMoney,
    demoCarrier: config.demoFeatures ? { near: config.demoCarrierNearAccount, base: config.demoCarrierBaseAddress } : null,
    geofenceMeters: config.geofenceMeters,
  });
});
