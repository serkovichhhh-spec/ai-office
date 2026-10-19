import { z } from "zod";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/** What a Claude session needs to do the step: prompts plus the exact output contract. */
export interface AgentRequest {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  user: string;
  tier: string;
  note?: string;
}

export interface AgentResponse {
  schemaName: string;
  output: unknown;
  submitted_at?: string;
  /** Who answered through the Execution Gateway ("chatgpt" | "claude_session"); absent for legacy submits. */
  executor?: string;
}

/** Thrown when the step must be handed to a Claude session; the worker parks the step. */
export class AgentNeededError extends Error {
  readonly agentNeeded = true;
  constructor(readonly request: AgentRequest) {
    super(`waiting for Claude session: ${request.schemaName}`);
  }
}

/**
 * "session" provider: no model API from the cloud. The first time a step runs it asks for a
 * Claude session to produce the answer; once the session submits, the same step re-runs and
 * receives that answer, validated against the same schema as any model output.
 */
export class SessionProvider implements AiProvider {
  readonly name = "session" as const;
  constructor(private readonly response: AgentResponse | null) {}

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = req.jsonSchema ?? (z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>);
    delete jsonSchema.$schema;
    const base: AgentRequest = { schemaName: req.schemaName, jsonSchema, system: req.system, user: req.user, tier: req.tier };

    if (!this.response || this.response.schemaName !== req.schemaName) {
      throw new AgentNeededError(base);
    }
    const parsed = req.schema.safeParse(this.response.output);
    if (!parsed.success) {
      // Ask again, telling the session exactly what was wrong.
      const issues = parsed.error.issues.slice(0, 12).map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`).join("; ");
      throw new AgentNeededError({ ...base, note: `Попередня відповідь не пройшла перевірку: ${issues.slice(0, 1200)}` });
    }
    return { output: parsed.data, usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, model: this.response.executor === "chatgpt" ? "chatgpt" : "claude-session", provider: "session" };
  }
}
