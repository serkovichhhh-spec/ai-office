import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { providerFromEnv } from "@/lib/ai";
import { dispatchTriggers } from "@/lib/orchestrator/triggers";
import { tick } from "@/lib/orchestrator/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Called by Vercel Cron every minute (and safe to call concurrently). */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const workerId = `cron-${randomUUID().slice(0, 8)}`;
  const report = await tick(db(), providerFromEnv(), {
    workerId,
    timeBudgetMs: 90_000,
    maxSteps: 20,
    log: (msg, extra) => console.log(JSON.stringify({ msg, workerId, ...extra })),
  });
  const triggers=await dispatchTriggers(db(),{cron:true});
  return Response.json({ workerId, ...report, triggers });
}
