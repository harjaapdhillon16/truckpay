import type { NextRequest } from "next/server";
import { mimeFor, readUpload } from "@/lib/files";

export const dynamic = "force-dynamic";

/** Proof files for the broker dashboard. Demo only: a real deployment puts this behind broker auth. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[loadId]/[name]">) {
  const { loadId, name } = await ctx.params;
  const data = readUpload(loadId, name);
  if (!data) return new Response("Not found", { status: 404 });
  const headers = { "content-type": mimeFor(name), "cache-control": "private, max-age=3600", "accept-ranges": "bytes" };

  // Safari only plays video served with byte ranges.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(data.length - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    if (start > end || start >= data.length)
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${data.length}` } });
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "content-length": String(data.length) } });
}
