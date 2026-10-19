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
import { PGlite } from "@electric-sql/pglite";
import { embeddedSql } from "../tests/embedded-db";
import { asUser, createSql } from "../src/lib/db-core";
import { StubProvider } from "../src/lib/ai/stub";
import { tick } from "../src/lib/orchestrator/worker";
import { SessionProvider } from "../src/lib/ai/session";

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
  const embedded = process.env.E2E_EMBEDDED === "1" ? new PGlite() : null;
  const admin = embedded ? null : postgres(ADMIN_URL, { max: 1 });
  if (admin) { await admin.unsafe(`create database ${DB}`); await admin.end(); }
  const dbUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`);
  const su = embedded ? embeddedSql(embedded) : postgres(dbUrl, { max: 1, onnotice: () => {} });
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
    const app = embedded ? embeddedSql(embedded,"office_app") : createSql(u.toString());
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

    // 6. Session mode: AI steps are parked for a Claude session, then resumed with its answer.
    const sRun = await asUser(app, OWNER, async (tx) => {
      const [{ id: b }] = await tx`select office.create_brief(${ws}, ${tx.json({ title: "Сесійний бриф", objective: "Перевірка режиму Claude-сесії", deliverable_count: 1 })}) as id`;
      const [{ id }] = await tx`select office.submit_brief(${b}, 'e2e-session-0001') as id`;
      return id as string;
    });
    const session = new SessionProvider(null);
    const stubAnswers = new StubProvider();
    let rounds = 0;
    for (; rounds < 8; rounds++) {
      await tick(app, session, { workerId: "e2e-session" });
      const [r] = await su`select status from office.runs where id = ${sRun}`;
      if (r.status === "needs_approval") break;
      const pending = await app`select * from office.agent_pending(5)`;
      check(`round ${rounds + 1}: one step awaits Claude`, pending.length === 1, pending.map((p) => p.step_key));
      const req = pending[0].request as { schemaName: string; jsonSchema: object; system: string; user: string };
      check(`round ${rounds + 1}: request carries schema and prompts`, Boolean(req.jsonSchema && req.system && req.user.includes("<brief>")));
      // Stand-in for the Claude session: answer with the stub template for that schema.
      const { reelsConcepts } = await import("../src/lib/orchestrator/playbooks/reels-concepts");
      const [{ ctx }] = await su`select office.worker_context(${pending[0].step_id}) as ctx`;
      let answer: unknown = null;
      await reelsConcepts.execute(ctx as never, { name: "stub", generate: async (g: import("../src/lib/ai/types").GenerateRequest<unknown>) => { answer = g.stub(); return stubAnswers.generate(g); } } as never).catch(() => {});
      const [{ r: sub }] = await app`select office.agent_submit(${pending[0].step_id}, ${app.json(answer as never)}) as r`;
      check(`round ${rounds + 1}: submit accepted`, (sub as { accepted: boolean }).accepted);
    }
    const [sr] = await su`select status, provider, steps_executed from office.runs where id = ${sRun}`;
    check("session run reaches approval after 3 Claude hand-offs", sr.status === "needs_approval" && rounds === 3, { ...sr, rounds });
    check("session run labelled as Claude session", sr.provider === "session", sr);
    const sArts = await su`select kind, provider, model from office.artifacts where run_id = ${sRun} and kind <> 'deliverable'`;
    check("session artifacts carry claude-session model", sArts.every((a) => a.provider === "session" && a.model === "claude-session"), sArts);
    // 7. Declarative playbook (ooh_concepts) end to end on the stub provider, then an owner revision.
    const oRun = await asUser(app, OWNER, async (tx) => {
      const [{ id: b }] = await tx`select office.create_brief(${ws}, ${tx.json({
        title: "Білборди для нових районів", objective: "Впізнаваність ПАВУТИНИ в нових районах підключення",
        deliverable_count: 2, playbook_key: "ooh_concepts", fields: { formats: "6×3 — 8 шт.", tone: "Спокійний, впевнений" },
      })}) as id`;
      const [{ id }] = await tx`select office.submit_brief(${b}, 'e2e-ooh-0001') as id`;
      return id as string;
    });
    const oRep = await tick(app, ai, { workerId: "e2e-ooh", maxSteps: 20 });
    check("ooh: worker ran 6 steps", oRep.succeeded === 6 && oRep.failed === 0, oRep);
    const oSteps = await su`select step_key from office.steps where run_id = ${oRun} order by created_at`;
    check("ooh: steps in spec order", oSteps.map((x) => x.step_key).join(">") === "intake>strategy>concepts>design_specs>review>package", oSteps.map((x) => x.step_key));
    const [oDel] = await su`select id, content from office.artifacts where run_id = ${oRun} and kind = 'deliverable'`;
    const oPkg = oDel.content as { schema_version: string; sections: { kind: string }[]; brief: { fields: Record<string, string> } };
    check("ooh: Package.v1 with 3 sections and brief fields", oPkg.schema_version === "Package.v1" && oPkg.sections.length === 3 && oPkg.brief.fields.formats === "6×3 — 8 шт.", oPkg);
    await asUser(app, OWNER, (tx) => tx`select office.decide(${oDel.id}, 'revision_requested', 'Більше локальності')`);
    await su`update office.steps set next_attempt_at = now() - interval '1 second' where run_id = ${oRun} and status = 'ready'`;
    await tick(app, ai, { workerId: "e2e-ooh", maxSteps: 20 });
    const oSteps2 = await su`select step_key from office.steps where run_id = ${oRun} order by created_at`;
    check("ooh: revision restarts from concepts", oSteps2.map((x) => x.step_key).slice(6).join(">") === "revision_intake>concepts>design_specs>review>package", oSteps2.map((x) => x.step_key));
    const [oFinal] = await su`select status, revision from office.runs where id = ${oRun}`;
    check("ooh: v2 waits for approval", oFinal.status === "needs_approval" && oFinal.revision === 2, oFinal);
    await app.end();
  } finally {
    await su.end();
    if (embedded) await embedded.close();
    else {
      const admin2 = postgres(ADMIN_URL, { max: 1 });
      await admin2.unsafe(`drop database if exists ${DB} with (force)`);
      await admin2.end();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
