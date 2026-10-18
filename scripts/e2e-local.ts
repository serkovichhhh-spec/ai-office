/**
 * End-to-end check on a throwaway local Postgres:
 *   owner submits brief → worker executes the playbook (stub provider) → deliverable appears
 *   → owner approves → handoff is queued. Also checks idempotent resubmission and that a
 *   crashed worker's lease is recovered without duplicate artifacts.
 *
 * Usage: E2E_ADMIN_URL=postgres://postgres@localhost/postgres npx tsx scripts/e2e-local.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { asUser, createSql } from "../src/lib/db-core";
import { StubProvider } from "../src/lib/ai/stub";
import { tick } from "../src/lib/orchestrator/worker";

const ROOT = join(import.meta.dirname, "..");
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "postgres://postgres@localhost:5432/postgres";
const DB = `office_e2e_${process.pid}`;
const OWNER = "11111111-1111-4111-8111-111111111111";
const APP_PASSWORD = "e2e-local-only";

function check(name: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail !== undefined ? `  → ${JSON.stringify(detail)}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`create database ${DB}`);
  await admin.end();
  const dbUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`);
  const su = postgres(dbUrl, { max: 1, onnotice: () => {} });
  try {
    const files = [
      "tests/sql/00_supabase_shim.sql",
      ...readdirSync(join(ROOT, "supabase/migrations")).sort().map((f) => `supabase/migrations/${f}`),
    ];
    for (const f of files) await su.unsafe(readFileSync(join(ROOT, f), "utf8"));
    await su.unsafe(`alter role office_app login password '${APP_PASSWORD}'`);
    await su`insert into auth.users (id, email) values (${OWNER}, 'owner@example.test')`;
    await su`insert into office.workspace_members (workspace_id, user_id, role)
             select id, ${OWNER}, 'owner' from office.workspaces where slug = 'pavutyna'`;
    await su`insert into office.knowledge_docs (workspace_id, kind, title, body, status)
             select id, 'brand', 'Тон бренду', 'Дружній, без канцеляризмів.', 'approved' from office.workspaces where slug = 'pavutyna'`;

    const u = new URL(dbUrl);
    u.username = "office_app";
    u.password = APP_PASSWORD;
    const app = createSql(u.toString());
    const ai = new StubProvider();

    // 1. Owner submits a brief (as the authenticated user, through RLS).
    const ws = (await asUser(app, OWNER, (tx) => tx`select id from office.workspaces where slug = 'pavutyna'`))[0].id;
    const runId = await asUser(app, OWNER, async (tx) => {
      const [{ id: briefId }] = await tx`select office.create_brief(${ws}, ${tx.json({
        title: "3 рілси про стабільний інтернет",
        objective: "Показати, що інтернет Павутини не падає ввечері",
        audience: "Сім'ї в приватному секторі",
        channel: "Instagram Reels",
        deliverable_count: 3,
        acceptance_criteria: ["хук у перші 2 секунди", "CTA «Перевірити покриття»"],
      })}) as id`;
      const [{ id }] = await tx`select office.submit_brief(${briefId}, 'e2e-idem-0001') as id`;
      const [{ id: again }] = await tx`select office.submit_brief(${briefId}, 'e2e-idem-0001') as id`;
      check("idempotent resubmit returns the same run", again === id);
      return id as string;
    });

    // 2. Simulate a crashed worker: claim intake and never finish; then expire its lease.
    await app`select * from office.worker_claim('crashed-worker', 1, 120)`;
    await su`update office.steps set locked_until = now() - interval '1 second', next_attempt_at = now() where run_id = ${runId}`;
    await su`select office.worker_reap()`;
    await su`update office.steps set next_attempt_at = now() - interval '1 second' where run_id = ${runId} and status = 'ready'`;

    // 3. Healthy worker drives the run to approval.
    const report = await tick(app, ai, { workerId: "e2e-worker", maxSteps: 20, heartbeatMs: 1000 });
    check("worker executed all playbook steps", report.succeeded === 5 && report.failed === 0, report);

    const [run] = await su`select status, provider, cost_usd from office.runs where id = ${runId}`;
    check("run waits for approval", run.status === "needs_approval", run);
    const steps = await su`select step_key, status, attempt from office.steps where run_id = ${runId} order by created_at`;
    check("intake recovered after lease expiry (attempt 2)", steps[0].step_key === "intake" && steps[0].attempt === 2, steps[0]);
    check(
      "steps in playbook order",
      steps.map((s) => s.step_key).join(">") === "intake>strategy>scripts>review>package",
      steps.map((s) => s.step_key),
    );
    const arts = await su`select kind, version, provider from office.artifacts where run_id = ${runId} order by created_at`;
    check("one artifact per kind, no duplicates", arts.map((a) => `${a.kind}:${a.version}`).join(",") === "strategy:1,scripts:1,review:1,deliverable:1", arts);
    check("artifacts honestly marked as stub", arts.filter((a) => a.kind !== "deliverable").every((a) => a.provider === "stub"));
    const [deliv] = await su`select id, content from office.artifacts where run_id = ${runId} and kind = 'deliverable'`;
    check("deliverable has 3 scripts", (deliv.content as { scripts: unknown[] }).scripts.length === 3);
    check("deliverable lists stub as generator", JSON.stringify((deliv.content as { generated_by: string[] }).generated_by) === '["stub"]');

    // 4. Owner approves → handoff queued.
    const decision = await asUser(app, OWNER, (tx) => tx`select office.decide(${deliv.id}, 'approved', 'Беремо в продакшн') as d`);
    check("approval creates handoff", Boolean((decision[0].d as { handoff_id?: string }).handoff_id));
    const [h] = await su`select status, payload->>'schema_version' as v from office.handoffs where run_id = ${runId}`;
    check("handoff queued with v1 contract", h?.status === "queued" && h?.v === "handoff.v1", h);
    const [final] = await su`select status from office.runs where id = ${runId}`;
    check("run status handoff_queued", final.status === "handoff_queued", final);

    // 5. Nothing left to do; the office is idle.
    const idle = await tick(app, ai, { workerId: "e2e-worker" });
    check("idle tick claims nothing", idle.claimed === 0, idle);
    const events = await su`select kind from office.events where run_id = ${runId} order by id`;
    console.log(`events: ${events.map((e) => e.kind).join(" → ")}`);
    await app.end();
  } finally {
    await su.end();
    const admin2 = postgres(ADMIN_URL, { max: 1 });
    await admin2.unsafe(`drop database if exists ${DB} with (force)`);
    await admin2.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
