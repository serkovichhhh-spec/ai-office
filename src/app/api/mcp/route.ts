import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError, handleMcpBody, hashToken, SERVER_INFO } from "@/lib/mcp/server";
import { CORS, originOf, wwwAuthenticate } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized(req: Request, error?: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
    { status: 401, headers: { ...CORS, "WWW-Authenticate": wwwAuthenticate(originOf(req), error) } },
  );
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S{20,300})$/i.exec(auth);
  if (!m) return unauthorized(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  try {
    const out = await handleMcpBody({ sql: db(), tokenHash: hashToken(m[1]) }, body);
    if (out === null) return new Response(null, { status: 202, headers: CORS });
    return NextResponse.json(out, { headers: { ...CORS, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return unauthorized(req, "invalid_token");
    console.error("mcp route error", e);
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }, { status: 500, headers: CORS });
  }
}

/** No server-initiated stream: this server is stateless. */
export function GET() {
  return NextResponse.json({ server: SERVER_INFO, transport: "streamable-http (POST only)" }, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
