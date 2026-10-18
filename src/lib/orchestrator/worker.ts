import type postgres from "postgres";
import type { AiProvider } from "@/lib/ai/types";
import { executeStep } from "./registry";
import type { StepContext, StepRow } from "./types";

export interface TickOptions {
  workerId: string;
  /** Stop claiming new steps after this many ms (keep well under the function's maxDuration). */
  timeBudgetMs?: number;
  maxSteps?: number;
  leaseSeconds?: number;
  heartbeatMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface TickReport {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  rejected: number;
}

/**
 * One worker invocation: claim → execute → complete/fail, one step at a time, until the
 * time budget or step limit is reached. Safe to run concurrently: claims use SKIP LOCKED and
 * results are accepted only from the lease holder for the current attempt.
 */
export async function tick(sql: postgres.Sql, ai: AiProvider, opts: TickOptions): Promise<TickReport> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 45_000;
  const maxSteps = opts.maxSteps ?? 10;
  const lease = opts.leaseSeconds ?? 120;
  const log = opts.log ?? (() => {});
  const report: TickReport = { claimed: 0, succeeded: 0, retried: 0, failed: 0, rejected: 0 };

  while (report.claimed < maxSteps && Date.now() - started < budget) {
    const rows = await sql<StepRow[]>`select * from office.worker_claim(${opts.workerId}, 1, ${lease})`;
    if (rows.length === 0) break;
    const step = rows[0];
    report.claimed++;

    const heartbeat = setInterval(() => {
      sql`select office.worker_heartbeat(${step.id}, ${opts.workerId}, ${lease})`.catch((e) =>
        log("heartbeat failed", { step: step.id, error: String(e) }),
      );
    }, opts.heartbeatMs ?? 30_000);

    try {
      const [{ ctx }] = await sql<{ ctx: StepContext }[]>`select office.worker_context(${step.id}) as ctx`;
      const result = await executeStep(ctx, ai);
      const [{ r }] = await sql<{ r: { accepted: boolean; reason?: string } }[]>`
        select office.worker_complete(${step.id}, ${opts.workerId}, ${step.attempt}, ${sql.json(result as never)}) as r`;
      if (r.accepted) report.succeeded++;
      else {
        report.rejected++;
        log("completion rejected", { step: step.id, reason: r.reason });
      }
    } catch (e) {
      const err = e as Error & { retryable?: boolean };
      const retryable = err.retryable === true;
      const message = (err.message || String(e)).slice(0, 1500);
      const [{ r }] = await sql<{ r: { accepted: boolean; retry?: boolean } }[]>`
        select office.worker_fail(${step.id}, ${opts.workerId}, ${step.attempt}, ${message}, ${retryable}) as r`;
      if (r.retry) report.retried++;
      else report.failed++;
      log("step error", { step: step.id, key: step.step_key, retryable, message });
    } finally {
      clearInterval(heartbeat);
    }
  }
  return report;
}
