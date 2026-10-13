import type { NextRequest } from "next/server";
import { handleCheckin, handleLumper, handlePod } from "@/lib/agent";
import { errorResponse } from "@/lib/http";
import { getLoad, getLoadByDriverToken } from "@/lib/store";
import { driverView } from "@/lib/views";

export const dynamic = "force-dynamic";

const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_VIDEO = 45 * 1024 * 1024;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/driver/[token]">) {
  const { token } = await ctx.params;
  const load = getLoadByDriverToken(token);
  if (!load) return Response.json({ error: { code: "not_found", detail: "This driver link is not valid." } }, { status: 404 });
  return Response.json(driverView(load));
}

async function fileFrom(form: FormData, name: string, max: number) {
  const value = form.get(name);
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > max) throw new Error(`${name} is too large`);
  return { data: Buffer.from(await value.arrayBuffer()), mime: value.type || "application/octet-stream" };
}

const num = (form: FormData, name: string) => {
  const raw = form.get(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Driver actions arrive as multipart forms: GPS fields plus any photos, signature and video. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/driver/[token]">) {
  const { token } = await ctx.params;
  const load = getLoadByDriverToken(token);
  if (!load) return Response.json({ error: { code: "not_found", detail: "This driver link is not valid." } }, { status: 404 });

  try {
    const form = await req.formData();
    const action = String(form.get("action") ?? "");
    const lat = num(form, "lat");
    const lng = num(form, "lng");
    const simulatedLocation = form.get("simulated") === "true";

    if (action === "pickup_checkin" || action === "delivery_arrive" || action === "delivery_depart") {
      if (lat === null || lng === null) throw new Error("location is required");
      const dwell = num(form, "dwellHours");
      await handleCheckin({
        load,
        kind: action,
        lat,
        lng,
        simulatedLocation,
        dwellHours: dwell === null ? undefined : Math.min(Math.max(dwell, 0), 48),
      });
    } else if (action === "lumper") {
      const claimed = num(form, "amountUsd");
      if (claimed === null || claimed <= 0) throw new Error("enter the lumper amount");
      await handleLumper({
        load,
        claimedUsd: claimed,
        photo: await fileFrom(form, "photo", MAX_IMAGE),
        lat,
        lng,
        simulatedLocation,
      });
    } else if (action === "pod") {
      if (lat === null || lng === null) throw new Error("location is required");
      const frames = [];
      for (let i = 0; i < 6; i++) {
        const frame = await fileFrom(form, `frame${i}`, MAX_IMAGE);
        if (frame) frames.push(frame);
      }
      await handlePod({
        load,
        lat,
        lng,
        simulatedLocation,
        receiverName: String(form.get("receiverName") ?? "").slice(0, 80),
        photo: await fileFrom(form, "photo", MAX_IMAGE),
        signature: await fileFrom(form, "signature", MAX_IMAGE),
        video: await fileFrom(form, "video", MAX_VIDEO),
        frames,
      });
    } else {
      throw new Error(`unknown action ${action}`);
    }
    return Response.json(driverView(getLoad(load.id)!));
  } catch (error) {
    return errorResponse(error);
  }
}
