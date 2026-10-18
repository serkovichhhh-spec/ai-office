import { z } from "zod";
import { RetryableAiError, type AiProvider, type GenerateRequest, type GenerateResult, type ModelTier } from "./types";

export interface AnthropicConfig {
  apiKey: string;
  models: Record<ModelTier, string>;
  /** USD per million tokens, per model id. Missing entry → cost reported as 0 and flagged in logs. */
  prices: Record<string, { input: number; output: number }>;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// Defaults verified against platform.claude.com pricing on 2026-10-18; override via env if they change.
export const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-5-5",
  balanced: "claude-sonnet-5-5",
  strong: "claude-opus-5-5",
};
export const DEFAULT_PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const TOOL_NAME = "submit_result";

/** Claude Messages API with forced tool use, so output is structured JSON validated by zod. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  constructor(private readonly cfg: AnthropicConfig) {}

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const model = this.cfg.models[req.tier];
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    const inputSchema = z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>;
    delete inputSchema.$schema;

    let res: Response;
    try {
      res = await fetchImpl(`${this.cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxOutputTokens ?? 4000,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          tools: [{ name: TOOL_NAME, description: `Return the ${req.schemaName} result.`, input_schema: inputSchema }],
          tool_choice: { type: "tool", name: TOOL_NAME },
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 90_000),
      });
    } catch (e) {
      throw new RetryableAiError(`anthropic request failed: ${(e as Error).message}`);
    }

    if (res.status === 429 || res.status >= 500) {
      throw new RetryableAiError(`anthropic ${res.status}`);
    }
    if (!res.ok) {
      // 4xx other than 429: configuration or request problem; not retryable. Body may echo input, keep it short.
      const text = (await res.text()).slice(0, 300);
      throw new Error(`anthropic ${res.status}: ${text}`);
    }

    const body = (await res.json()) as {
      content: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const block = body.content.find((c) => c.type === "tool_use" && c.name === TOOL_NAME);
    if (!block) throw new RetryableAiError(`model returned no ${TOOL_NAME} block (stop: ${body.stop_reason})`);

    const parsed = req.schema.safeParse(block.input);
    if (!parsed.success) {
      throw new RetryableAiError(`model output failed ${req.schemaName} validation: ${parsed.error.message.slice(0, 300)}`);
    }

    const tokensIn = body.usage?.input_tokens ?? 0;
    const tokensOut = body.usage?.output_tokens ?? 0;
    const price = this.cfg.prices[model];
    const cost = price ? (tokensIn * price.input + tokensOut * price.output) / 1_000_000 : 0;

    return {
      output: parsed.data,
      usage: { tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: Number(cost.toFixed(6)) },
      model,
      provider: "anthropic",
    };
  }
}
