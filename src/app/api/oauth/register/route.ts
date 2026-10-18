import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { CORS } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const Body = z.object({
  client_name: z.string().max(120).optional(),
  redirect_uris: z.array(z.string().url().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
});

/** RFC 7591 dynamic client registration (public clients, PKCE required). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "redirect_uris required" }, { status: 400, headers: CORS });
  }
  const b = parsed.data;
  try {
    const [{ r }] = await db()`select office.oauth_register(${b.client_name ?? "MCP client"}, ${b.redirect_uris}::text[]) as r`;
    return NextResponse.json(
      {
        client_id: (r as { client_id: string }).client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: b.client_name ?? "MCP client",
        redirect_uris: b.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { status: 201, headers: CORS },
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "22023") return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400, headers: CORS });
    if (code === "54000") return NextResponse.json({ error: "temporarily_unavailable" }, { status: 429, headers: CORS });
    throw e;
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
