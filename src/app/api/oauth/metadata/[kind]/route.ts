import { NextResponse } from "next/server";
import { authorizationServerMetadata, CORS, originOf, protectedResourceMetadata } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const origin = originOf(req);
  if (kind === "protected-resource") return NextResponse.json(protectedResourceMetadata(origin), { headers: CORS });
  if (kind === "authorization-server") return NextResponse.json(authorizationServerMetadata(origin), { headers: CORS });
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
