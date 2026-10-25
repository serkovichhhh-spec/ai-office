import type postgres from "postgres";
import { fire, type AdapterDeps, type DispatchItem } from "./adapters";

export interface GatewayReport {
  router: Record<string, unknown> | null;
  expired: number;
  dispatched: number;
  outcomes: Record<string, number>;
  disabled?: boolean;
}

/**
 * One pass of the Capability Router + Trigger Gateway, run after every worker tick:
 * 0. office.cmo_import_tick() — CMO Space tasks assigned to «AI Office» → briefs + runs;
 * 1. office.router_tick()      — move steps off exhausted/paused/forbidden executors (verified fallback only);
 * 2. office.trigger_expire()   — timeouts (no claim in 10 min, no report, closed steps);
 * 3. office.trigger_dispatch() — reserve steps and pick channels; the adapters wake executors;
 * 4. office.trigger_report()   — record each adapter outcome (breaker, pauses, owner notifications).
 */
export async function runTriggerGateway(sql: postgres.Sql, deps: AdapterDeps & { log?: (m: string, x?: Record<string, unknown>) => void }): Promise<GatewayReport> {
  const log = deps.log ?? (() => {});
  // CMO Space → AI Office: tasks assigned to «AI Office» become briefs + runs (before routing/dispatch).
  const [{ r: imported }] = await sql<{ r: Record<string, unknown> }[]>`select office.cmo_import_tick(3) as r`;
  if (Number(imported?.imported ?? 0) > 0) log("cmo_import", imported);
  const [{ r: router }] = await sql<{ r: Record<string, unknown> }[]>`select office.router_tick() as r`;
  const [{ n: expired }] = await sql<{ n: number }[]>`select office.trigger_expire() as n`;
  const report: GatewayReport = { router, expired, dispatched: 0, outcomes: {} };
  if (deps.env.TRIGGERS_DISABLED === "1" || deps.env.TRIGGERS_DISABLED === "true") return { ...report, disabled: true };

  const [{ items }] = await sql<{ items: DispatchItem[] }[]>`select office.trigger_dispatch(5) as items`;
  for (const item of items ?? []) {
    report.dispatched++;
    const outcome = await fire(item, deps);
    report.outcomes[outcome.result] = (report.outcomes[outcome.result] ?? 0) + 1;
    await sql`select office.trigger_report(${item.trigger_run_id}::uuid, ${sql.json(outcome as never)})`;
    log("trigger", { channel: item.channel, step: item.step_id, result: outcome.result, status: "status" in outcome ? outcome.status : undefined });
  }
  return report;
}
