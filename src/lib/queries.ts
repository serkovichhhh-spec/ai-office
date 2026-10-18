import "server-only";
import { asUser, db } from "./db";
import { PLAYBOOKS } from "./orchestrator/registry";

export const EXECUTOR_LABEL: Record<string, string> = { claude_session: "Claude", chatgpt: "ChatGPT", human: "людину" };

function hhmm(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" });
}

export type Role = "owner" | "approver" | "editor" | "viewer";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  status: string;
  role: Role;
  run_budget_usd: string;
  daily_budget_usd: string;
}

export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  return asUser(db(), userId, (tx) => tx<Workspace[]>`
    select w.id, w.slug, w.name, w.status, w.run_budget_usd, w.daily_budget_usd, office.member_role(w.id) as role
    from office.workspaces w where w.status <> 'archived' order by w.name`);
}

export async function workspaceBySlug(userId: string, slug: string): Promise<Workspace | null> {
  const rows = await asUser(db(), userId, (tx) => tx<Workspace[]>`
    select w.id, w.slug, w.name, w.status, w.run_budget_usd, w.daily_budget_usd, office.member_role(w.id) as role
    from office.workspaces w where w.slug = ${slug}`);
  return rows[0] ?? null;
}

export interface AgentState {
  role_key: string;
  display_name: string;
  model_tier: string;
  enabled: boolean;
  provenance: string;
  department: "marketing" | "production";
  activity: string; // derived from persisted steps/runs only
  detail: string | null;
  run_id: string | null;
}

export interface LegacyRun {
  id: string;
  agent: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  stale: boolean;
}

export interface Floor {
  agents: AgentState[];
  legacy: LegacyRun[] | null;
  spentToday: string;
  awaitingAgent: number;
  /** Unclaimed parked steps per executor kind, e.g. { chatgpt: 1 }. */
  waitingByExecutor: Record<string, number>;
}

/** Team state is computed from steps/runs in the database; nothing here is simulated. */
export async function floorState(userId: string, ws: Workspace): Promise<Floor> {
  return asUser(db(), userId, async (tx) => {
    const agents = await tx<{ role_key: string; display_name: string; model_tier: string; enabled: boolean; provenance: string; department: "marketing" | "production" }[]>`
      select role_key, display_name, model_tier, enabled, provenance, department from office.agents
      where workspace_id = ${ws.id}
      order by sort_order, display_name`;
    const running = await tx<{ agent_role: string; step_key: string; run_id: string; title: string }[]>`
      select s.agent_role, s.step_key, s.run_id, b.title from office.steps s
      join office.runs r on r.id = s.run_id join office.briefs b on b.id = r.brief_id
      where s.workspace_id = ${ws.id} and s.status = 'running'`;
    const awaiting = await tx<{ agent_role: string; step_key: string; run_id: string; title: string; executor: string;
                                claimed_by: string | null; claimed_at: string | null; lease_until: string | null }[]>`
      select s.agent_role, s.step_key, s.run_id, b.title, coalesce(s.executor, 'claude_session') as executor,
             x.name as claimed_by, x.claimed_at::text, x.lease_expires_at::text as lease_until
      from office.steps s
      join office.runs r on r.id = s.run_id join office.briefs b on b.id = r.brief_id
      left join lateral (
        select e.name, a.claimed_at, a.lease_expires_at from office.execution_attempts a
        join office.executors e on e.id = a.executor_id
        where a.step_id = s.id and a.state = 'claimed' and a.lease_expires_at > now()
        order by a.claimed_at desc limit 1) x on true
      where s.workspace_id = ${ws.id} and s.status = 'awaiting_agent' and r.status = 'running'`;
    const queued = await tx<{ agent_role: string; run_id: string; title: string }[]>`
      select s.agent_role, s.run_id, b.title from office.steps s
      join office.runs r on r.id = s.run_id join office.briefs b on b.id = r.brief_id
      where s.workspace_id = ${ws.id} and s.status = 'ready' and r.status in ('queued','running')`;
    const waiting = await tx<{ run_id: string; title: string }[]>`
      select r.id as run_id, b.title from office.runs r join office.briefs b on b.id = r.brief_id
      where r.workspace_id = ${ws.id} and r.status = 'needs_approval' order by r.updated_at desc`;
    const failed = await tx<{ agent_role: string; run_id: string; error: string | null }[]>`
      select distinct on (s.agent_role) s.agent_role, s.run_id, s.error from office.steps s
      join office.runs r on r.id = s.run_id
      where s.workspace_id = ${ws.id} and s.status = 'failed' and r.status = 'failed'
        and s.finished_at > now() - interval '24 hours'
      order by s.agent_role, s.finished_at desc`;
    const [{ spent }] = await tx<{ spent: string }[]>`
      select coalesce(sum(cost_usd), 0)::text as spent from office.runs
      where workspace_id = ${ws.id} and created_at >= date_trunc('day', now())`;

    const state: AgentState[] = agents.map((a) => {
      const run = running.find((r) => r.agent_role === a.role_key);
      if (run) {
        return { ...a, activity: activityFor(a.role_key), detail: `${stepLabel(run.step_key)} · ${run.title}`, run_id: run.run_id };
      }
      const parked = awaiting.find((r) => r.agent_role === a.role_key);
      if (parked) {
        // Honest: an external executor is never shown as "working" — only who claimed it and until when.
        const who = parked.claimed_by
          ? `взяв ${parked.claimed_by} о ${hhmm(parked.claimed_at)}, оренда до ${hhmm(parked.lease_until)}`
          : `чекає на ${EXECUTOR_LABEL[parked.executor] ?? parked.executor}`;
        return { ...a, activity: "awaiting_agent", detail: `${stepLabel(parked.step_key)} · ${parked.title} — ${who}`, run_id: parked.run_id };
      }
      if (a.role_key === "orchestrator" && waiting.length) {
        return { ...a, activity: "waiting_approval", detail: `Чекає на рішення: ${waiting[0].title}`, run_id: waiting[0].run_id };
      }
      const f = failed.find((x) => x.agent_role === a.role_key);
      if (f) return { ...a, activity: "blocked", detail: f.error?.slice(0, 140) ?? "Крок завершився помилкою", run_id: f.run_id };
      const q = queued.find((x) => x.agent_role === a.role_key);
      if (q) return { ...a, activity: "queued", detail: `У черзі · ${q.title}`, run_id: q.run_id };
      if (!a.enabled) return { ...a, activity: "off", detail: null, run_id: null };
      // Honest roster: roles that no playbook uses yet are shown as such, never as busy.
      if (a.department === "production") return { ...a, activity: "awaiting_bridge", detail: "Працює через локальний /produce — міст ще не підключено", run_id: null };
      if (!USED_ROLES.has(a.role_key)) return { ...a, activity: "unassigned", detail: "Ще не задіяний у жодному сценарії", run_id: null };
      return { ...a, activity: "idle", detail: null, run_id: null };
    });

    let legacy: LegacyRun[] | null = null;
    if (ws.role === "owner") {
      legacy = await tx<LegacyRun[]>`select id::text, agent, status, started_at, finished_at, summary, stale
                                     from office.legacy_agent_runs(${ws.id}, 8)`;
    }
    return { agents: state, legacy, spentToday: spent, awaitingAgent: awaiting.length,
      waitingByExecutor: awaiting.filter((w) => !w.claimed_by).reduce<Record<string, number>>((m, w) => ({ ...m, [w.executor]: (m[w.executor] ?? 0) + 1 }), {}) };
  });
}

const USED_ROLES = new Set(Object.values(PLAYBOOKS).flatMap((p) => [...p.roles]));

export function activityFor(role: string): string {
  if (["copywriter", "creative_director", "creative", "smm", "content_maker"].includes(role)) return "drafting";
  if (role === "reviewer") return "reviewing";
  if (role === "orchestrator") return "planning";
  return "researching";
}

export function stepLabel(key: string): string {
  return (
    {
      intake: "Розбір брифу",
      revision_intake: "Розбір коментаря",
      strategy: "Стратегія",
      scripts: "Сценарії",
      review: "Рев'ю",
      package: "Пакування",
    } as Record<string, string>
  )[key] ?? key;
}

export interface RunListItem {
  id: string;
  status: string;
  provider: string | null;
  revision: number;
  cost_usd: string;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  title: string;
  channel: string;
}

export async function listRuns(userId: string, wsId: string, limit = 30): Promise<RunListItem[]> {
  return asUser(db(), userId, (tx) => tx<RunListItem[]>`
    select r.id, r.status, r.provider, r.revision, r.cost_usd::text, r.created_at, r.updated_at, r.error_message,
           b.title, b.channel
    from office.runs r join office.briefs b on b.id = r.brief_id
    where r.workspace_id = ${wsId} order by r.created_at desc limit ${limit}`);
}

export interface HandoffItem {
  id: string;
  run_id: string;
  status: string;
  created_at: string;
  title: string;
}

export async function listHandoffs(userId: string, wsId: string): Promise<HandoffItem[]> {
  return asUser(db(), userId, (tx) => tx<HandoffItem[]>`
    select h.id, h.run_id, h.status, h.created_at, h.payload->'brief'->>'title' as title
    from office.handoffs h where h.workspace_id = ${wsId} order by h.created_at desc limit 20`);
}

export interface RunDetail {
  run: RunListItem & {
    workspace_id: string; brief_id: string; budget_usd: string; tokens_in: string; tokens_out: string;
    error_code: string | null; started_at: string | null; finished_at: string | null;
  };
  brief: {
    title: string; objective: string; audience: string; channel: string; deliverable_count: number;
    acceptance_criteria: string[]; deadline: string | null; priority: string;
  };
  steps: Array<{
    id: string; step_key: string; agent_role: string; cycle: number; status: string; attempt: number; max_attempts: number;
    provider: string | null; model: string | null; cost_usd: string; tokens_in: string; tokens_out: string;
    error: string | null; started_at: string | null; finished_at: string | null; executor: string | null;
  }>;
  events: Array<{ id: string; kind: string; agent_role: string | null; activity: string | null; actor_type: string; payload: Record<string, unknown>; created_at: string }>;
  artifacts: Array<{ id: string; kind: string; title: string; version: number; content: Record<string, unknown>; content_hash: string; provider: string; model: string | null; created_at: string }>;
  approvals: Array<{ id: string; artifact_id: string; decision: string; rationale: string; by_me: boolean; created_at: string }>;
  handoff: { id: string; status: string; idempotency_key: string; created_at: string; payload: Record<string, unknown> } | null;
}

export async function runDetail(userId: string, runId: string): Promise<RunDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  return asUser(db(), userId, async (tx) => {
    const [run] = await tx`
      select r.id, r.workspace_id, r.brief_id, r.status, r.provider, r.revision, r.cost_usd::text, r.budget_usd::text,
             r.tokens_in::text, r.tokens_out::text, r.error_code, r.error_message, r.created_at, r.updated_at,
             r.started_at, r.finished_at, b.title, b.channel
      from office.runs r join office.briefs b on b.id = r.brief_id where r.id = ${runId}`;
    if (!run) return null;
    const [brief] = await tx`select title, objective, audience, channel, deliverable_count, acceptance_criteria, deadline::text as deadline, priority
                             from office.briefs where id = ${run.brief_id}`;
    const steps = await tx`select id, step_key, agent_role, cycle, status, attempt, max_attempts, provider, model,
                                  cost_usd::text, tokens_in::text, tokens_out::text, error, started_at, finished_at, executor
                           from office.steps where run_id = ${runId} order by created_at`;
    const events = await tx`select id::text, kind, agent_role, activity, actor_type, payload, created_at
                            from office.events where run_id = ${runId} order by id`;
    const artifacts = await tx`select id, kind, title, version, content, content_hash, provider, model, created_at
                               from office.artifacts where run_id = ${runId} order by created_at`;
    const approvals = await tx`select a.id, a.artifact_id, a.decision, a.rationale, a.created_at,
                                      (a.approver_id = ${userId}::uuid) as by_me
                               from office.approvals a where a.run_id = ${runId} order by a.created_at`;
    const [handoff] = await tx`select id, status, idempotency_key, created_at, payload from office.handoffs where run_id = ${runId}`;
    return { run, brief, steps, events, artifacts, approvals, handoff: handoff ?? null } as unknown as RunDetail;
  });
}

export interface KnowledgeDoc {
  id: string; kind: string; title: string; body: string; status: string; source_url: string | null; updated_at: string;
}

export async function listKnowledge(userId: string, wsId: string): Promise<KnowledgeDoc[]> {
  return asUser(db(), userId, (tx) => tx<KnowledgeDoc[]>`
    select id, kind, title, body, status, source_url, updated_at from office.knowledge_docs
    where workspace_id = ${wsId} and status <> 'archived' order by status, kind, title`);
}

export interface ExecutorRow {
  id: string;
  kind: string;
  name: string;
  last_seen_at: string | null;
  created_at: string;
}

/** Connected executors (ChatGPT, Claude) of a workspace. Token hashes are never readable by users. */
export async function executors(userId: string, wsId: string): Promise<ExecutorRow[]> {
  return asUser(db(), userId, (tx) => tx<ExecutorRow[]>`
    select id, kind, name, last_seen_at::text, created_at::text from office.executors
    where workspace_id = ${wsId} and revoked_at is null order by created_at`);
}
