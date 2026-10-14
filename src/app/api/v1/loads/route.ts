import { z } from "zod";
import { advance, createLoad } from "@/server/agent";
import { companyRoute, originOf } from "@/server/http";
import { runtime } from "@/server/runtime";
import { listLoads } from "@/server/store";
import { companyLoadSummary, companyLoadView } from "@/server/views";

const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

const Destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transfer"), account: z.string().trim().regex(NEAR_ACCOUNT, "must be a NEAR Intents account id") }),
  z.object({ kind: z.literal("withdraw"), chain: z.literal("base"), address: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x Base address") }),
]);

const CreateLoad = z.object({
  number: z.string().trim().max(40).optional(),
  rateUsd: z.number().positive().max(100_000),
  delivery: z.object({
    name: z.string().trim().min(1).max(80),
    address: z.string().trim().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  carrier: z.object({ name: z.string().trim().min(1).max(80), payout: Destination }),
});

export const GET = companyRoute(async () => {
  const loads = await listLoads();
  return Response.json({ data: await Promise.all(loads.map(companyLoadSummary)) });
});

export const POST = companyRoute(async (req) => {
  const body = CreateLoad.parse(await req.json());
  const load = await createLoad(body, req.headers.get("idempotency-key"));
  // Wallet setup signs two owner intents and waits for the policy; it continues in the background.
  (await runtime()).waitUntil(advance(load.id));
  return Response.json(await companyLoadView(load, originOf(req)), { status: 201 });
});
