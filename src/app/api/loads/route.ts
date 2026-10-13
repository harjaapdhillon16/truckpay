import { z } from "zod";
import { config } from "@/lib/config";
import { errorResponse, originOf } from "@/lib/http";
import { addEvent, countBlockedAttempts, createLoad, listLoads, listPayouts } from "@/lib/store";
import { loadView } from "@/lib/views";
import { provisionWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";

const destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transfer"), label: z.string().min(1), address: z.string().min(2).max(64) }),
  z.object({
    kind: z.literal("withdraw"),
    label: z.string().min(1),
    chain: z.string().min(2),
    address: z.string().min(6),
    memo: z.string().nullable(),
  }),
]);

const stop = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  appointment: z.string().min(1),
});

const money = z.number().min(0).max(1_000_000);

const RateConInput = z.object({
  loadNumber: z.string().min(1).max(40),
  equipment: z.string().min(1),
  commodity: z.string().min(1),
  pickup: stop,
  delivery: stop,
  carrier: z.object({
    name: z.string().min(1),
    mcNumber: z.string().min(1),
    driverName: z.string().min(1),
    payout: destination,
  }),
  lumperService: destination.nullable(),
  brokerRefund: destination,
  linehaulUsd: money.min(1),
  accessorialReserveUsd: money,
  fuelAdvancePct: z.number().min(0).max(50),
  detention: z.object({ freeHours: z.number().min(0).max(24), ratePerHourUsd: money, capUsd: money }),
  lumperCapUsd: money,
  geofenceMeters: z.number().min(100).max(20_000),
  deliveryWindowHours: z.number().min(1).max(24 * 30),
});

export async function GET(req: Request) {
  const origin = originOf(req);
  const loads = listLoads().map((l) => loadView(l, origin));
  const payouts = listPayouts().filter((p) => p.status === "SUCCESS");
  const toCarriers = payouts
    .filter((p) => ["fuel_advance", "detention", "final"].includes(p.kind))
    .reduce((sum, p) => sum + p.amountUsd, 0);
  const committed = loads
    .filter((l) => !["provisioning", "awaiting_funding", "failed", "closed"].includes(l.status))
    .reduce((sum, l) => sum + l.rateCon.linehaulUsd + l.rateCon.accessorialReserveUsd - l.ledger.toCarrier - l.ledger.lumper, 0);
  return Response.json({
    loads,
    stats: { toCarriers, committed, blocked: countBlockedAttempts(), mode: config.mode },
  });
}

export async function POST(req: Request) {
  try {
    const rateCon = RateConInput.parse(await req.json());
    const destinations = [rateCon.carrier.payout, rateCon.brokerRefund, ...(rateCon.lumperService ? [rateCon.lumperService] : [])];
    const keys = destinations.map((d) => (d.kind === "transfer" ? `t:${d.address}` : `w:${d.chain}:${d.address}`));
    if (new Set(keys).size !== keys.length)
      return Response.json({ error: { code: "duplicate_destination", detail: "Carrier, lumper and broker refund must be different accounts." } }, { status: 400 });

    const load = createLoad(rateCon, config.mode);
    addEvent(load.id, "broker", "booked", `Broker booked ${rateCon.pickup.address.split(",").at(-2)?.trim() ?? "pickup"} → ${rateCon.delivery.address.split(",").at(-2)?.trim() ?? "delivery"} with ${rateCon.carrier.name}`, {
      linehaulUsd: rateCon.linehaulUsd,
      reserveUsd: rateCon.accessorialReserveUsd,
    });
    // Provisioning signs two owner intents and waits for on-chain onboarding; the UI polls.
    void provisionWallet(load.id);
    return Response.json({ id: load.id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: { code: "validation_error", detail: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, { status: 400 });
    return errorResponse(error);
  }
}
