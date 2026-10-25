import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { providerFromEnv } from "@/lib/ai";
import { tick } from "@/lib/orchestrator/worker";
import { runTriggerGateway } from "@/lib/triggers/gateway";

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
    timeBudgetMs: 70_000, // leaves room for the trigger gateway (≤ 5 × 8 s)
    maxSteps: 20,
    log: (msg, extra) => console.log(JSON.stringify({ msg, workerId, ...extra })),
  });
  let triggers: unknown = null;
  try {
    triggers = await runTriggerGateway(db(), {
      fetch,
      env: process.env,
      log: (msg, extra) => console.log(JSON.stringify({ msg, workerId, ...extra })),
    });
  } catch (e) {
    // Routing/triggers must never break the worker; the failure is visible in logs and QA.
    console.error(JSON.stringify({ msg: "trigger gateway failed", workerId, error: String((e as Error)?.message ?? e) }));
  }
  return Response.json({ workerId, ...report, triggers });
}
