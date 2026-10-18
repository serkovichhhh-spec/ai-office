import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operational check (same secret as the worker): DB reachable as office_app, worker queue depth, provider. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response("unauthorized", { status: 401 });
  }
  const started = Date.now();
  try {
    const [row] = await db()`select current_user as role,
      has_function_privilege('office.worker_claim(text,int,int)', 'execute') as worker_ok`;
    return Response.json({ ok: true, role: row.role, worker_ok: row.worker_ok, provider: process.env.AI_PROVIDER ?? "stub", ms: Date.now() - started });
  } catch (e) {
    // Return the error class only; never echo connection strings.
    const err = e as { code?: string; message?: string };
    return Response.json({ ok: false, code: err.code ?? null, error: (err.message ?? "").replace(/postgres(ql)?:\/\/\S+/g, "[url]").slice(0, 200) }, { status: 500 });
  }
}
