import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CORS } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

async function params(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

const headers = { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(req: Request) {
  const p = await params(req);
  const sql = db();
  let r: Record<string, unknown> | undefined;
  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.client_id || !p.redirect_uri || !p.code_verifier) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
    }
    [{ r }] = await sql`select office.oauth_exchange_code(${p.code}, ${p.client_id}, ${p.redirect_uri}, ${p.code_verifier}) as r`;
  } else if (p.grant_type === "refresh_token") {
    if (!p.refresh_token || !p.client_id) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
    [{ r }] = await sql`select office.oauth_refresh(${p.refresh_token}, ${p.client_id}) as r`;
  } else {
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400, headers });
  }
  if (!r || r.error) return NextResponse.json({ error: String(r?.error ?? "invalid_grant") }, { status: 400, headers });
  return NextResponse.json({ ...r, scope: "office" }, { headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
