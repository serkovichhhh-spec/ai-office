/**
 * Trigger Gateway adapters (Architecture Review Round 2, §5). An adapter only WAKES an executor:
 * success here is `accepted` (HTTP 200/202). Real success is `task_completed`, which the database
 * derives from the executor's own claim → submit → validation through the gateway.
 *
 * Secrets never live in the database: a channel names an env prefix and the server reads
 *   claude_routine: <PREFIX>_FIRE_URL, <PREFIX>_TOKEN
 *   chatgpt_agent:  <PREFIX>_TRIGGER_ID, <PREFIX>_TOKEN
 * No adapter here calls a paid API.
 */

export type Adapter = "claude_routine" | "chatgpt_agent" | "manual_notify";

export interface DispatchItem {
  trigger_run_id: string;
  channel_id: string;
  channel: string;
  adapter: Adapter;
  config: { env_prefix?: string; [k: string]: unknown };
  step_id: string;
  text: string;
  url?: string;
}

export type FireOutcome =
  | { result: "accepted"; provider_run_id?: string; session_url?: string }
  | { result: "notified"; delivered: "in_app" }
  | { result: "not_configured" | "rate_limited" | "auth" | "fatal" | "retryable"; status?: number; retry_after_s?: number; message?: string };

export interface AdapterDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
}

const ENV_PREFIX = /^[A-Z][A-Z0-9_]{1,40}$/;

/** Env var names a channel needs (names only — values are never returned). */
export function requiredEnv(adapter: Adapter, config: DispatchItem["config"]): string[] {
  const prefix = typeof config.env_prefix === "string" && ENV_PREFIX.test(config.env_prefix) ? config.env_prefix : null;
  if (adapter === "manual_notify") return [];
  if (!prefix) return ["<env_prefix>"];
  return adapter === "claude_routine" ? [`${prefix}_FIRE_URL`, `${prefix}_TOKEN`] : [`${prefix}_TRIGGER_ID`, `${prefix}_TOKEN`];
}

export function channelConfigured(adapter: Adapter, config: DispatchItem["config"], env: AdapterDeps["env"]): boolean {
  return requiredEnv(adapter, config).every((name) => !name.startsWith("<") && !!env[name]);
}

/** Maps an HTTP status to the gateway's outcome classes (§5.4). */
export function classify(status: number, retryAfter: string | null, message?: string): FireOutcome {
  if (status === 401 || status === 403) return { result: "auth", status, message };
  if (status === 429) {
    const s = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : retryAfter ? Math.max(0, Math.round((Date.parse(retryAfter) - Date.now()) / 1000)) : NaN;
    return { result: "rate_limited", status, retry_after_s: Number.isFinite(s) && s > 0 ? s : 3600, message };
  }
  if (status === 400 || status === 404 || status === 422) return { result: "fatal", status, message };
  return { result: "retryable", status, message };
}

async function post(deps: AdapterDeps, url: string, headers: Record<string, string>, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 8_000);
  try {
    return await deps.fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal, redirect: "error" });
  } finally {
    clearTimeout(timer);
  }
}

async function errorMessage(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { error?: { type?: string; message?: string; code?: string } };
    return [j.error?.type ?? j.error?.code, j.error?.message].filter(Boolean).join(": ").slice(0, 300) || undefined;
  } catch {
    return undefined;
  }
}

/** Claude Code routine: POST /v1/claude_code/routines/{trig_…}/fire with a per-routine token. */
async function fireClaude(item: DispatchItem, deps: AdapterDeps, prefix: string): Promise<FireOutcome> {
  const url = deps.env[`${prefix}_FIRE_URL`];
  const token = deps.env[`${prefix}_TOKEN`];
  if (!url || !token) return { result: "not_configured" };
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/.test(url)) {
    return { result: "fatal", message: "fire URL is not an Anthropic routine endpoint" };
  }
  const res = await post(deps, url, { authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01" }, { text: item.text });
  if (res.status === 200) {
    const j = (await res.json().catch(() => ({}))) as { claude_code_session_id?: string; claude_code_session_url?: string };
    return { result: "accepted", provider_run_id: j.claude_code_session_id, session_url: j.claude_code_session_url };
  }
  return classify(res.status, res.headers.get("retry-after"), await errorMessage(res));
}

/** Accepts the bare id or a pasted URL / value with spaces or quotes; returns agtch_… or null. */
export function triggerIdFrom(raw: string): string | null {
  return raw.match(/agtch_[A-Za-z0-9_-]+/)?.[0] ?? null;
}

/** ChatGPT workspace agent: POST api.chatgpt.com/v1/workspace_agents/{agtch_…}/trigger (beta run id). */
async function fireChatGpt(item: DispatchItem, deps: AdapterDeps, prefix: string): Promise<FireOutcome> {
  const raw = deps.env[`${prefix}_TRIGGER_ID`];
  const token = deps.env[`${prefix}_TOKEN`]?.trim();
  if (!raw || !token) return { result: "not_configured" };
  const id = triggerIdFrom(raw);
  if (!id) return { result: "fatal", message: `trigger id must contain agtch_… (value starts with "${raw.trim().slice(0, 6)}")` };
  const res = await post(deps, `https://api.chatgpt.com/v1/workspace_agents/${id}/trigger`, {
    authorization: `Bearer ${token}`,
    "openai-beta": "workspace_agent_runs=v1",
    // Same trigger run → same key, so a retried HTTP call never starts a second agent run.
    "idempotency-key": item.trigger_run_id,
  }, { input: item.text });
  if (res.status === 200 || res.status === 202) {
    const j = (await res.json().catch(() => ({}))) as { agent_trigger_run_id?: string; conversation_url?: string };
    return { result: "accepted", provider_run_id: j.agent_trigger_run_id, session_url: j.conversation_url };
  }
  // 409 = "channel or agent not in a runnable state": retry a little, the breaker stops it if it persists.
  return classify(res.status, res.headers.get("retry-after"), await errorMessage(res));
}

export async function fire(item: DispatchItem, deps: AdapterDeps): Promise<FireOutcome> {
  if (item.adapter === "manual_notify") return { result: "notified", delivered: "in_app" };
  const prefix = typeof item.config?.env_prefix === "string" && ENV_PREFIX.test(item.config.env_prefix) ? item.config.env_prefix : null;
  if (!prefix) return { result: "not_configured" };
  try {
    return item.adapter === "claude_routine" ? await fireClaude(item, deps, prefix) : await fireChatGpt(item, deps, prefix);
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return { result: "retryable", message: aborted ? "timeout" : String((e as Error)?.message ?? e).slice(0, 300) };
  }
}
