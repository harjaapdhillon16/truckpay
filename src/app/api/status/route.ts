import { connectionStatus } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await connectionStatus());
}
