/**
 * End-to-end on a throwaway local Postgres, through the real MCP handler:
 *   owner brief → worker parks strategy for ChatGPT → ChatGPT claims/submits via MCP
 *   → worker parks scripts for Claude → Claude via MCP → review for ChatGPT → owner approval.
 * Also: schema error keeps the lease, foreign executor cannot see work, bad token → AuthError.
 *
 * Usage: E2E_ADMIN_URL=postgres://postgres@localhost/postgres npx tsx scripts/e2e-mcp.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { asUser, createSql } from "../src/lib/db-core";
import { SessionProvider } from "../src/lib/ai/session";
import { StubProvider } from "../src/lib/ai/stub";
import { tick } from "../src/lib/orchestrator/worker";
import { AuthError, handleMcpBody, hashToken } from "../src/lib/mcp/server";
import { bundle } from "../src/lib/orchestrator/contracts";
import { stubFromJsonSchema } from "../src/lib/orchestrator/stubgen";

const ROOT = join(import.meta.dirname, "..");
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "postgres://postgres@localhost:5432/postgres";
const DB = `office_mcp_${process.pid}`;
const OWNER = "11111111-1111-4111-8111-111111111111";

function check(name: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail !== undefined ? `  → ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
  if (!cond) process.exitCode = 1;
}

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`create database ${DB}`);
  await admin.end();
  const dbUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`);
  const su = postgres(dbUrl, { max: 1, onnotice: () => {} });
  try {
    for (const f of ["tests/sql/00_supabase_shim.sql", ...readdirSync(join(ROOT, "supabase/migrations")).sort().map((f) => `supabase/migrations/${f}`)]) {
      await su.unsafe(readFileSync(join(ROOT, f), "utf8"));
    }
    await su.unsafe(`alter role office_app login password 'e2e-local-only'`);
    await su`insert into auth.users (id, email) values (${OWNER}, 'owner@example.test')`;
    await su`insert into office.workspace_members (workspace_id, user_id, role) select id, ${OWNER}, 'owner' from office.workspaces where slug = 'pavutyna'`;
    // Seat assignment (approved v1 split): strategy + review → ChatGPT, scripts → Claude.
    await su`update office.agents set default_executor = 'chatgpt' where role_key in ('strategist','reviewer')`;
    const [{ t: gptToken }] = await su`select office.create_executor('pavutyna', 'chatgpt', 'ChatGPT Business') as t`;
    const [{ t: claudeToken }] = await su`select office.create_executor('pavutyna', 'claude_session', 'Claude task') as t`;
    await su`insert into office.workspaces (slug, name) values ('gtu', 'GTU')`;
    const [{ t: otherToken }] = await su`select office.create_executor('gtu', 'chatgpt', 'GTU ChatGPT') as t`;
    // 0008: executors start without seats — grant them explicitly, as the owner does in the panel.
    await su`update office.executors x set allowed_seats = coalesce((select array_agg(a.role_key) from office.agents a where a.workspace_id = x.workspace_id), '{}')`;

    const u = new URL(dbUrl);
    u.username = "office_app";
    u.password = "e2e-local-only";
    const app = createSql(u.toString());
    const gpt = { sql: app, tokenHash: hashToken(gptToken) };
    const claude = { sql: app, tokenHash: hashToken(claudeToken) };
    const other = { sql: app, tokenHash: hashToken(otherToken) };
    let id = 0;
    const rpc = async (ctx: typeof gpt, method: string, params?: Any) =>
      (await handleMcpBody(ctx, { jsonrpc: "2.0", id: ++id, method, params })) as Any;
    const tool = async (ctx: typeof gpt, name: string, args: Any = {}) =>
      (await rpc(ctx, "tools/call", { name, arguments: args })).result as Any;

    // Handshake
    const init = await rpc(gpt, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    check("initialize negotiates protocol and exposes tools capability", init.result.protocolVersion === "2025-06-18" && Boolean(init.result.capabilities.tools));
    check("initialized notification → no response", (await handleMcpBody(gpt, { jsonrpc: "2.0", method: "notifications/initialized" })) === null);
    const names = (await rpc(gpt, "tools/list")).result.tools.map((t: Any) => t.name).join(",");
    check("exactly the five fixed tools", names === "office_list_tasks,office_get_task,office_claim_task,office_submit_result,office_get_team_status", names);
    let authErr = false;
    try { await handleMcpBody({ sql: app, tokenHash: hashToken("nope-nope-nope-nope-nope") }, { jsonrpc: "2.0", id: 1, method: "tools/list" }); } catch (e) { authErr = e instanceof AuthError; }
    check("bad token → AuthError (route answers 401)", authErr);

    // Brief
    const ws = (await su`select id from office.workspaces where slug = 'pavutyna'`)[0].id;
    const runId = await asUser(app, OWNER, async (tx) => {
      const [{ id: b }] = await tx`select office.create_brief(${ws}, ${tx.json({ title: "MCP бриф", objective: "Перевірити ChatGPT + Claude через MCP", deliverable_count: 1 })}) as id`;
      const [{ id }] = await tx`select office.submit_brief(${b}, 'e2e-mcp-0001') as id`;
      return id as string;
    });

    const session = new SessionProvider(null);
    const { reelsConcepts } = await import("../src/lib/orchestrator/playbooks/reels-concepts");
    const answerFor = async (stepId: string) => {
      const [{ ctx }] = await su`select office.worker_context(${stepId}) as ctx`;
      let answer: unknown = null;
      await reelsConcepts.execute(ctx as never, { name: "stub", generate: async (g: Any) => { answer = g.stub(); return new StubProvider().generate(g as never); } } as never).catch(() => {});
      return answer as Any;
    };

    const plan = [
      { who: "ChatGPT", ctx: gpt, seat: "strategist" },
      { who: "Claude", ctx: claude, seat: "copywriter" },
      { who: "ChatGPT", ctx: gpt, seat: "reviewer" },
    ];
    for (const [i, p] of plan.entries()) {
      await tick(app, session, { workerId: "e2e-mcp" });
      const wrong = p.ctx === gpt ? claude : gpt;
      check(`${i + 1}. ${p.seat}: other executor sees nothing`, (await tool(wrong, "office_list_tasks")).structuredContent.count === 0);
      check(`${i + 1}. ${p.seat}: other workspace sees nothing`, (await tool(other, "office_list_tasks")).structuredContent.count === 0);
      const list = (await tool(p.ctx, "office_list_tasks")).structuredContent;
      check(`${i + 1}. ${p.who} sees one ${p.seat} task`, list.count === 1 && list.tasks[0].seat === p.seat, list);
      const claim = (await tool(p.ctx, "office_claim_task")).structuredContent;
      check(`${i + 1}. ${p.who} claims with lease`, claim.claimed === true && claim.envelope.schema_version === "TaskEnvelope.v1", claim);
      check(`${i + 1}. legacy envelope omits optional skill fields`, !("skills" in claim.envelope) && !("context" in claim.envelope));
      const renew = (await tool(p.ctx, "office_claim_task", { attempt_id: claim.attempt_id, lease_token: claim.lease_token })).structuredContent;
      check(`${i + 1}. lease renewable`, renew.renewed === true, renew);
      const base = { task_id: claim.envelope.task_id, attempt_id: claim.attempt_id, lease_token: claim.lease_token };
      if (i === 0) {
        const bad = await tool(p.ctx, "office_submit_result", { ...base, result: { summary: "" } });
        check("invalid result rejected with issues, lease kept", bad.isError === true && bad.structuredContent.reason === "schema_validation_failed" && bad.structuredContent.issues.length > 0, bad.structuredContent);
      }
      const good = (await tool(p.ctx, "office_submit_result", { ...base, result: await answerFor(claim.envelope.task_id) })).structuredContent;
      check(`${i + 1}. ${p.who} result accepted`, good.accepted === true, good);
    }
    await tick(app, session, { workerId: "e2e-mcp" });
    const [run] = await su`select status from office.runs where id = ${runId}`;
    check("run reaches owner approval after ChatGPT → Claude → ChatGPT", run.status === "needs_approval", run);
    const attempts = await su`select x.state, e.kind from office.execution_attempts x join office.executors e on e.id = x.executor_id order by x.claimed_at`;
    check("every attempt validated, with executor recorded", attempts.length === 3 && attempts.every((a) => a.state === "validated"), attempts);
    check("executors alternate ChatGPT/Claude/ChatGPT", attempts.map((a) => a.kind).join(",") === "chatgpt,claude_session,chatgpt");
    const transfers = await su`select provider, op, data_class, jsonb_array_length(knowledge_refs) as refs from office.external_transfers where run_id = ${runId} and op = 'claim' order by at`;
    check("every hand-off audited with provider and data class (0008)",
      transfers.map((t) => `${t.provider}:${t.data_class}`).join(",") === "openai:internal,anthropic:internal,openai:internal", transfers);
    const parked = await su`select count(*)::int as n from office.steps where run_id = ${runId} and agent_request ? 'governance'`;
    check("parked requests carry the governance decision", parked[0].n === 3, parked);
    const arts = await su`select kind, model from office.artifacts where run_id = ${runId} and kind in ('strategy','scripts','review') order by created_at`;
    check("artifacts credit the real author", arts.map((a) => `${a.kind}:${a.model}`).join(",") === "strategy:chatgpt,scripts:claude-session,review:chatgpt", arts);
    const status = (await tool(gpt, "office_get_team_status")).structuredContent;
    check("team status shows run waiting for owner", status.runs_waiting_for_owner === 1, status);

    // Library playbook (outdoor_print_pack v1): Claude authors prepare + build, ChatGPT reviews — per-step executors.
    const { stubFromJsonSchema } = await import("../src/lib/orchestrator/stubgen");
    const lRun = await asUser(app, OWNER, async (tx) => {
      const [{ id: b }] = await tx`select office.create_brief(${ws}, ${tx.json({
        title: "Білборди MCP", objective: "Перевірити бібліотечний плейбук через MCP", deliverable_count: 1,
        playbook_key: "outdoor_print_pack", playbook_version: 1, fields: { medium: "billboard" },
      })}) as id`;
      const [{ id }] = await tx`select office.submit_brief(${b}, 'e2e-mcp-lib-0001') as id`;
      return id as string;
    });
    const [lr] = await su`select playbook_version from office.runs where id = ${lRun}`;
    check("library run pinned to playbook v1", lr.playbook_version === 1, lr);
    const libPlan = [
      { who: "Claude", ctx: claude, step: "prepare", schema: "Preparation" },
      { who: "Claude", ctx: claude, step: "build", schema: "PrintOutput" },
      { who: "ChatGPT", ctx: gpt, step: "review", schema: "ReviewDecision" },
    ];
    for (const p of libPlan) {
      await tick(app, session, { workerId: "e2e-mcp-lib" });
      const claim = (await tool(p.ctx, "office_claim_task")).structuredContent;
      check(`library ${p.step}: ${p.who} gets it with ${p.schema} contract`, claim.claimed === true && claim.envelope.step === p.step && claim.envelope.output_schema_name === p.schema, claim.envelope ? { step: claim.envelope.step, schema: claim.envelope.output_schema_name } : claim);
      if (!claim.claimed) break;
      const base = { task_id: claim.envelope.task_id, attempt_id: claim.attempt_id, lease_token: claim.lease_token };
      if (p.step === "prepare") {
        const bad = await tool(p.ctx, "office_submit_result", { ...base, result: { status: "ready" } });
        check("library: structural errors reported instantly (Ajv), lease kept", bad.isError === true && bad.structuredContent.issues.length > 0, bad.structuredContent);
      }
      const answer = stubFromJsonSchema(claim.envelope.output_schema) as Record<string, unknown>;
      if (p.step === "review") {
        // A real reviewer scores the playbook's own criteria; evidence must be 5 to pass.
        const lib = JSON.parse(readFileSync(join(ROOT, "src/lib/orchestrator/library/playbooks.json"), "utf8")) as { playbook_key: string; review: { criteria: { key: string }[] } }[];
        const crit = lib.find((x) => x.playbook_key === "outdoor_print_pack")!.review.criteria;
        answer.scores = crit.map((c) => ({ key: c.key, score: 5, evidence_pointer: "/summary", reason: "Перевірено" }));
        answer.issues = [];
      }
      const ok = (await tool(p.ctx, "office_submit_result", { ...base, result: answer })).structuredContent;
      check(`library ${p.step}: accepted`, ok.accepted === true, ok);
    }
    await tick(app, session, { workerId: "e2e-mcp-lib" });
    const [lFinal] = await su`select r.status, a.content->>'outcome' as outcome from office.runs r
      join office.artifacts a on a.run_id = r.id and a.kind = 'deliverable' where r.id = ${lRun}`;
    check("library run: package ready_for_approval", lFinal?.status === "needs_approval" && lFinal?.outcome === "ready_for_approval",
      { lFinal, steps: await su`select step_key, status, agent_request->>'note' as note, error from office.steps where run_id = ${lRun} order by created_at` });
    const lExec = await su`select step_key, executor from office.steps where run_id = ${lRun} and executor is not null order by created_at`;
    check("library run: executors from the playbook (claude, claude, chatgpt)", lExec.map((x) => x.executor).join(",") === "claude_session,claude_session,chatgpt", lExec);
    // P1: a parked v2 diagnosis uses the same five tools and DB schema 0008.
    const [liveKnowledge] = await su`insert into office.knowledge_docs(workspace_id,kind,title,body,status,data_class)
      values(${ws},'fact','Current approved test fact','A fact that belongs to this task.','approved','internal') returning id`;
    const [unreferenced] = await su`insert into office.knowledge_docs(workspace_id,kind,title,body,status,data_class)
      values(${ws},'fact','Later knowledge outside this task','Not authorised for this prepared task.','approved','internal') returning id`;
    const [{ version }] = await su`select office.knowledge_version(k) as version from office.knowledge_docs k where id=${liveKnowledge.id}`;
    const diagnosisRequest = { schemaName: "BriefDiagnosis.v1", system: "CMO diagnosis", user: "Test diagnosis",
      jsonSchema: bundle("BriefDiagnosis.v1"), governance: { data_class: "internal", knowledge_refs: [{ record_id: liveKnowledge.id, version }] } };
    const [{ id: diagnosis }] = await su`insert into office.steps(run_id, workspace_id, step_key, agent_role, status, executor, agent_request)
      values (${lRun}, ${ws}, 'diagnosis', 'strategist', 'awaiting_agent', 'chatgpt',
        ${su.json(diagnosisRequest as postgres.JSONValue)}) returning id`;
    await su`update office.runs set status='running' where id=${lRun}`;
    const fetched = (await tool(gpt, "office_get_task", { task_id: diagnosis })).structuredContent;
    check("P1 diagnosis GET includes full skill pack and internal workspace context", fetched.output_schema_name === "BriefDiagnosis.v1" && fetched.skills?.[0]?.key === "cmo"
      && fetched.skills[0].version === "1.0.0" && fetched.skills[0].files["SKILL.md"].length > 100
      && fetched.context?.file === "context/pavutyna.md", fetched.error);
    check("CMO live context includes only authorised record versions", fetched.context.text.includes(liveKnowledge.id)
      && fetched.context.text.includes('"record_id"') && !fetched.context.text.includes(unreferenced.id));
    const taken = (await tool(gpt, "office_claim_task", { task_id: diagnosis })).structuredContent;
    check("P1 diagnosis CLAIM carries the same pack hash", taken.claimed === true && taken.envelope.skills?.[0]?.sha256 === fetched.skills?.[0]?.sha256);
    check("CMO sends five runtime files, no evaluation answers", Object.keys(taken.envelope.skills[0].files).length === 5
      && !Object.keys(taken.envelope.skills[0].files).some(k => k.startsWith("evaluation/"))
      && taken.envelope.context.data_class === taken.envelope.data_class);
    const denied = await tool(other, "office_get_task", { task_id: diagnosis });
    check("P1 foreign workspace receives no pack or context", denied.isError === true && !denied.structuredContent.skills && !denied.structuredContent.context);
    const diagnosisLease = { task_id: diagnosis, attempt_id: taken.attempt_id, lease_token: taken.lease_token };
    const invalidDiagnosis = await tool(gpt, "office_submit_result", { ...diagnosisLease, result: {} });
    check("P1 diagnosis rejects invalid JSON immediately", invalidDiagnosis.isError === true && invalidDiagnosis.structuredContent.reason === "schema_validation_failed");
    const stillClaimed = await tool(gpt, "office_claim_task", { attempt_id: taken.attempt_id, lease_token: taken.lease_token });
    check("P1 invalid diagnosis keeps its lease", stillClaimed.structuredContent.renewed === true);
    const validDiagnosis = await tool(gpt, "office_submit_result", { ...diagnosisLease, result: stubFromJsonSchema(bundle("BriefDiagnosis")) });
    check("P1 corrected diagnosis accepted", validDiagnosis.structuredContent.accepted === true);
    {
      await su`update office.knowledge_docs set valid_until=current_date-1 where id=${liveKnowledge.id}`;
      const locking = postgres(dbUrl, { max: 1, onnotice: () => {} });
      try {
        await locking.begin(async (tx) => {
          // Simulate gateway_submit holding its attempt lock before it locks the step.
          await tx`select id from office.execution_attempts where id=${taken.attempt_id} for update`;
          await app.begin(async (workerTx) => {
            await workerTx`select set_config('statement_timeout','2000',true)`;
            await workerTx`select office.worker_reap()`;
          });
          const [row] = await su`select agent_response is not null as unchanged from office.steps where id=${diagnosis}`;
          check("expiry recovery skips a concurrently locked attempt without blocking", row.unchanged === true);
        });
        await app`select office.worker_reap()`;
        const [recovered] = await su`select status,agent_request,agent_response from office.steps where id=${diagnosis}`;
        check("next tick recovers the ready step and discards the stale submitted answer", recovered.status === "ready"
          && recovered.agent_request === null && recovered.agent_response === null);
      } finally { await locking.end(); }
    }
    // ---- 0012 acceptance (§17.1): Claude usage limit → the step moves to verified ChatGPT, is woken by its
    // channel and reaches task_completed; Claude's channel is never called; no other host is called.
    {
      const { runTriggerGateway } = await import("../src/lib/triggers/gateway");
      await su`insert into office.workspaces (slug, name) values ('route', 'Route test')`;
      const [{ id: rws }] = await su`select id from office.workspaces where slug = 'route'`;
      await su`select office.seed_default_agents(${rws})`;
      await su`update office.agents set default_executor = 'chatgpt' where workspace_id = ${rws} and role_key in ('strategist','reviewer')`;
      await su`insert into office.workspace_members (workspace_id, user_id, role) values (${rws}, ${OWNER}, 'owner')`;
      const [{ t: rGptTok }] = await su`select office.create_executor('route', 'chatgpt', 'Route ChatGPT') as t`;
      const [{ t: rClaudeTok }] = await su`select office.create_executor('route', 'claude_session', 'Route Claude') as t`;
      await su`update office.executors x set allowed_seats = (select array_agg(a.role_key) from office.agents a where a.workspace_id = x.workspace_id),
                 verified_at = now() where x.workspace_id = ${rws}`;
      const rGpt = { sql: app, tokenHash: hashToken(rGptTok) };
      await su`insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
               select ${rws}, 'claude-routine', 'claude_routine', id, true, '{"env_prefix":"CLAUDE_ROUTINE","daily_cap":5}'::jsonb
               from office.executors where name = 'Route Claude'`;
      await su`insert into office.trigger_channels (workspace_id, label, adapter, executor_id, enabled, config)
               select ${rws}, 'chatgpt-agent', 'chatgpt_agent', id, true, '{"env_prefix":"CHATGPT_AGENT","daily_cap":10}'::jsonb
               from office.executors where name = 'Route ChatGPT'`;
      await asUser(app, OWNER, (tx) => tx`select office.set_triggers_enabled(${rws}::uuid, true)`);

      const calls: string[] = [];
      const fakeFetch = (async (url: string) => {
        calls.push(String(url));
        return String(url).includes("api.chatgpt.com")
          ? new Response(JSON.stringify({ agent_trigger_run_id: `apirun_${calls.length}`, conversation_url: "https://chatgpt.com/c/x" }), { status: 202 })
          : new Response(JSON.stringify({ claude_code_session_id: `session_${calls.length}`, claude_code_session_url: "https://claude.ai/code/session_x" }), { status: 200 });
      }) as unknown as typeof fetch;
      const env = {
        CLAUDE_ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_01TEST/fire", CLAUDE_ROUTINE_TOKEN: "sk-ant-oat01-test",
        CHATGPT_AGENT_TRIGGER_ID: "agtch_test", CHATGPT_AGENT_TOKEN: "test",
      };
      const gateway = () => runTriggerGateway(app, { fetch: fakeFetch, env });
      const rRun = await asUser(app, OWNER, async (tx) => {
        const [{ id: b }] = await tx`select office.create_brief(${rws}, ${tx.json({ title: "Маршрутизація", objective: "Перевірити резерв при ліміті Claude", deliverable_count: 1 })}) as id`;
        const [{ id }] = await tx`select office.submit_brief(${b}, 'e2e-route-0001') as id`;
        return id as string;
      });
      const doStep = async (key: string) => {
        const [st] = await su`select id from office.steps where run_id = ${rRun} and step_key = ${key} and status = 'awaiting_agent'`;
        const claim = (await tool(rGpt, "office_claim_task", { task_id: st.id })).structuredContent;
        const ok = (await tool(rGpt, "office_submit_result", { task_id: st.id, attempt_id: claim.attempt_id, lease_token: claim.lease_token,
          result: await answerFor(st.id) })).structuredContent;
        await tick(app, session, { workerId: "e2e-route" });
        return { id: st.id as string, ok: ok.accepted === true };
      };

      await tick(app, session, { workerId: "e2e-route" });              // strategy parked for ChatGPT
      const g1 = await gateway();
      check("router: ChatGPT channel woken for its own step", g1.outcomes.accepted === 1 && calls.at(-1)!.includes("api.chatgpt.com/v1/workspace_agents/agtch_test/trigger"), { g1, calls });
      const s1 = await doStep("strategy");
      check("router: strategy done by ChatGPT", s1.ok);
      const [t1] = await su`select last_event from office.trigger_runs where step_id = ${s1.id}`;
      check("router: woken step reaches task_completed", t1?.last_event === "task_completed", t1);

      // scripts is parked for Claude now; Claude's limit is reached (owner marks it / USAGE_LIMIT_REACHED).
      await asUser(app, OWNER, (tx) => tx`select office.set_provider_limit(${rws}::uuid, 'anthropic', now() + interval '5 hours', 'USAGE_LIMIT_REACHED')`);
      const before = calls.length;
      const started = Date.now();
      const g2 = await gateway();
      const [sc] = await su`select id, executor, routed_from from office.steps where run_id = ${rRun} and step_key = 'scripts'`;
      check("§17.1: Claude step rerouted to ChatGPT within one gateway pass (≤ 2 min)", sc.executor === "chatgpt" && sc.routed_from === "claude_session"
        && Date.now() - started < 120_000 && (g2.router as Any)?.rerouted >= 1, { sc, g2 });
      check("§17.1: Claude channel is not called while the limit lasts", calls.slice(before).every((u) => !u.includes("anthropic.com")), calls.slice(before));
      const s2 = await doStep("scripts");
      const [t2] = await su`select t.last_event, c.label from office.trigger_runs t join office.trigger_channels c on c.id = t.channel_id where t.step_id = ${s2.id}`;
      check("§17.1: rerouted step reaches task_completed via ChatGPT", s2.ok && t2?.last_event === "task_completed" && t2.label === "chatgpt-agent", t2);
      const [att] = await su`select e.kind from office.execution_attempts a join office.executors e on e.id = a.executor_id where a.step_id = ${s2.id} and a.state = 'validated'`;
      check("§17.1: the artifact credits the real executor", att?.kind === "chatgpt", att);
      check("no host other than the two trigger APIs was called", calls.every((u) => u.startsWith("https://api.chatgpt.com/") || u.startsWith("https://api.anthropic.com/")), calls);
    }

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
