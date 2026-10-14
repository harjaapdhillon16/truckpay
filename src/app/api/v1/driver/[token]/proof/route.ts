import { AgentRefusal, submitProof } from "@/server/agent";
import { fail, publicRoute } from "@/server/http";
import { getLoadByDriverToken } from "@/server/store";
import { driverView } from "@/server/views";

const MAX_PHOTO = 12 * 1024 * 1024;
const MAX_VIDEO = 30 * 1024 * 1024;

async function file(form: FormData, name: string, max: number) {
  const value = form.get(name);
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > max) throw new AgentRefusal("file_too_large", `${name} is larger than ${Math.round(max / 1024 / 1024)} MB.`, 413);
  return { data: new Uint8Array(await value.arrayBuffer()), type: value.type || "application/octet-stream" };
}

function number(form: FormData, name: string) {
  const raw = form.get(name);
  const value = raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Multipart: photo (required), lat, lng, accuracy_m, optional video and frame0..frame3. */
export const POST = publicRoute(async (req, ctx: RouteContext<"/api/v1/driver/[token]/proof">) => {
  const { token } = await ctx.params;
  const form = await req.formData();
  const lat = number(form, "lat");
  const lng = number(form, "lng");
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return fail("location_required", "Allow location access so we can confirm you're at the delivery.", 400);
  const photo = await file(form, "photo", MAX_PHOTO);
  if (!photo) return fail("photo_required", "Take a photo of the signed BOL.", 400);
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const frame = await file(form, `frame${i}`, MAX_PHOTO);
    if (frame) frames.push(frame);
  }
  await submitProof(
    token,
    { lat, lng, accuracyM: number(form, "accuracy_m"), photo, video: await file(form, "video", MAX_VIDEO), frames },
    req.headers.get("idempotency-key"),
  );
  const load = await getLoadByDriverToken(token);
  return Response.json(await driverView(load!));
});
