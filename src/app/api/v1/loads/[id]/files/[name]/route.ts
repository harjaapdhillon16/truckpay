import { companyRoute } from "@/server/http";
import { getProofFile } from "@/server/files";

/** Proof media for the company. Supports byte ranges so Safari can play videos. */
export const GET = companyRoute(async (req, ctx: RouteContext<"/api/v1/loads/[id]/files/[name]">) => {
  const { id, name } = await ctx.params;
  const file = await getProofFile(id, name);
  if (!file) return new Response("Not found", { status: 404 });
  const headers = { "content-type": file.contentType, "cache-control": "private, max-age=3600", "accept-ranges": "bytes" };
  const size = file.data.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(file.data.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(file.data, { headers: { ...headers, "content-length": String(size) } });
});
