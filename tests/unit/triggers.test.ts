import { describe, expect, it } from "vitest";
import { channelConfigured, classify, fire, requiredEnv, triggerIdFrom, type DispatchItem } from "@/lib/triggers/adapters";

const item = (adapter: DispatchItem["adapter"], env_prefix = "CLAUDE_ROUTINE"): DispatchItem => ({
  trigger_run_id: "11111111-1111-4111-8111-111111111111",
  channel_id: "c",
  channel: "x",
  adapter,
  config: { env_prefix },
  step_id: "s",
  text: "task_id=22222222-2222-4222-8222-222222222222",
});

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const claudeEnv = { CLAUDE_ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire", CLAUDE_ROUTINE_TOKEN: "sk-ant-oat01-x" };
const gptEnv = { CHATGPT_AGENT_TRIGGER_ID: "agtch_123", CHATGPT_AGENT_TOKEN: "tok" };

describe("trigger adapters", () => {
  it("Claude routine: sends only the task id with the routine token; 200 is accepted", async () => {
    const { f, calls } = fakeFetch(200, { type: "routine_fire", claude_code_session_id: "session_1", claude_code_session_url: "https://claude.ai/code/session_1" });
    const out = await fire(item("claude_routine"), { fetch: f, env: claudeEnv });
    expect(out).toEqual({ result: "accepted", provider_run_id: "session_1", session_url: "https://claude.ai/code/session_1" });
    expect(calls[0].url).toBe(claudeEnv.CLAUDE_ROUTINE_FIRE_URL);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer sk-ant-oat01-x");
    expect(h["anthropic-version"]).toBeTruthy();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "task_id=22222222-2222-4222-8222-222222222222" });
  });

  it("ChatGPT agent: beta header and idempotency key = trigger run; 202 is accepted", async () => {
    const { f, calls } = fakeFetch(202, { agent_trigger_run_id: "apirun_9", conversation_url: "https://chatgpt.com/c/1" });
    const out = await fire(item("chatgpt_agent", "CHATGPT_AGENT"), { fetch: f, env: gptEnv });
    expect(out).toMatchObject({ result: "accepted", provider_run_id: "apirun_9" });
    expect(calls[0].url).toBe("https://api.chatgpt.com/v1/workspace_agents/agtch_123/trigger");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["openai-beta"]).toBe("workspace_agent_runs=v1");
    expect(h["idempotency-key"]).toBe("11111111-1111-4111-8111-111111111111");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ input: "task_id=22222222-2222-4222-8222-222222222222" });
  });

  it("missing secrets → not_configured without any HTTP call", async () => {
    const { f, calls } = fakeFetch(200, {});
    expect(await fire(item("claude_routine"), { fetch: f, env: {} })).toEqual({ result: "not_configured" });
    expect(await fire(item("chatgpt_agent", "CHATGPT_AGENT"), { fetch: f, env: {} })).toEqual({ result: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a fire URL that is not the Anthropic routine endpoint", async () => {
    const { f, calls } = fakeFetch(200, {});
    const out = await fire(item("claude_routine"), { fetch: f, env: { ...claudeEnv, CLAUDE_ROUTINE_FIRE_URL: "https://evil.example/fire" } });
    expect(out.result).toBe("fatal");
    expect(calls).toHaveLength(0);
  });

  it("classifies HTTP errors: 401/403 auth, 429 rate limit with Retry-After, 400/404 fatal, 5xx/409 retryable", async () => {
    expect(classify(401, null).result).toBe("auth");
    expect(classify(403, null).result).toBe("auth");
    expect(classify(429, "120")).toMatchObject({ result: "rate_limited", retry_after_s: 120 });
    expect(classify(429, null)).toMatchObject({ result: "rate_limited", retry_after_s: 3600 });
    expect(classify(400, null).result).toBe("fatal");
    expect(classify(404, null).result).toBe("fatal");
    expect(classify(500, null).result).toBe("retryable");
    expect(classify(503, null).result).toBe("retryable");
    expect(classify(409, null).result).toBe("retryable");
    const { f } = fakeFetch(429, { type: "error", error: { type: "rate_limit_error", message: "hourly" } }, { "retry-after": "60" });
    expect(await fire(item("claude_routine"), { fetch: f, env: claudeEnv })).toMatchObject({ result: "rate_limited", retry_after_s: 60, message: "rate_limit_error: hourly" });
  });

  it("network failure or timeout is retryable", async () => {
    const boom = (async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as unknown as typeof fetch;
    expect(await fire(item("claude_routine"), { fetch: boom, env: claudeEnv })).toEqual({ result: "retryable", message: "timeout" });
  });

  it("manual_notify never calls out", async () => {
    const { f, calls } = fakeFetch(200, {});
    expect(await fire(item("manual_notify"), { fetch: f, env: {} })).toEqual({ result: "notified", delivered: "in_app" });
    expect(calls).toHaveLength(0);
  });

  it("reports which env names a channel needs, never values", () => {
    expect(requiredEnv("claude_routine", { env_prefix: "CLAUDE_ROUTINE" })).toEqual(["CLAUDE_ROUTINE_FIRE_URL", "CLAUDE_ROUTINE_TOKEN"]);
    expect(requiredEnv("chatgpt_agent", { env_prefix: "CHATGPT_AGENT" })).toEqual(["CHATGPT_AGENT_TRIGGER_ID", "CHATGPT_AGENT_TOKEN"]);
    expect(requiredEnv("manual_notify", {})).toEqual([]);
    expect(channelConfigured("claude_routine", { env_prefix: "CLAUDE_ROUTINE" }, claudeEnv)).toBe(true);
    expect(channelConfigured("claude_routine", { env_prefix: "bad prefix" }, claudeEnv)).toBe(false);
  });

  it("ChatGPT trigger id: bare id, pasted URL or padded value all work; others are refused with a safe hint", async () => {
    expect(triggerIdFrom("agtch_123")).toBe("agtch_123");
    expect(triggerIdFrom(" https://api.chatgpt.com/v1/workspace_agents/agtch_A-b_9/trigger\n")).toBe("agtch_A-b_9");
    expect(triggerIdFrom('"agtch_x"')).toBe("agtch_x");
    expect(triggerIdFrom("agt_123")).toBeNull();
    const { f, calls } = fakeFetch(202, {});
    await fire(item("chatgpt_agent", "CHATGPT_AGENT"), { fetch: f, env: { ...gptEnv, CHATGPT_AGENT_TRIGGER_ID: "https://api.chatgpt.com/v1/workspace_agents/agtch_123/trigger" } });
    expect(calls[0].url).toBe("https://api.chatgpt.com/v1/workspace_agents/agtch_123/trigger");
    const bad = await fire(item("chatgpt_agent", "CHATGPT_AGENT"), { fetch: f, env: { ...gptEnv, CHATGPT_AGENT_TRIGGER_ID: "g-abcdef123" } });
    expect(bad).toMatchObject({ result: "fatal", message: expect.stringContaining('"g-abcd"') });
  });
});
