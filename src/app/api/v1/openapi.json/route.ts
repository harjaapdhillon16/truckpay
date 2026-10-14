import { openapi } from "@/server/openapi";

export const GET = () => Response.json(openapi);
