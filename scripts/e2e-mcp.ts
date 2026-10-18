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
    const arts = await su`select kind, model from office.artifacts where run_id = ${runId} and kind in ('strategy','scripts','review') order by created_at`;
    check("artifacts credit the real author", arts.map((a) => `${a.kind}:${a.model}`).join(",") === "strategy:chatgpt,scripts:claude-session,review:chatgpt", arts);
    const status = (await tool(gpt, "office_get_team_status")).structuredContent;
    check("team status shows run waiting for owner", status.runs_waiting_for_owner === 1, status);
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
