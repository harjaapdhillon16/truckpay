import { z } from "zod";
import { SESSION_COOKIE, checkPasscode, fail, isCompany, publicRoute, sessionCookieFor } from "@/server/http";

/** Company sign-in with the shared passcode. */
export const POST = publicRoute(async (req) => {
  const { passcode } = z.object({ passcode: z.string().min(1).max(200) }).parse(await req.json());
  if (!(await checkPasscode(passcode))) return fail("wrong_passcode", "That passcode isn't right.", 401);
  return new Response(null, { status: 204, headers: { "set-cookie": await sessionCookieFor(passcode) } });
});

export const GET = publicRoute(async (req) => Response.json({ signedIn: await isCompany(req) }));

export const DELETE = publicRoute(async () =>
  new Response(null, { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } }),
);
