import type { z } from "zod";

export type ModelTier = "fast" | "balanced" | "strong";

export interface GenerateRequest<T> {
  /** Role instructions (system prompt). */
  system: string;
  /** Task text. Untrusted material (brief, knowledge) must already be wrapped in delimited data blocks. */
  user: string;
  /** Output contract; every provider's output is validated against it before it is stored. */
  schema: z.ZodType<T>;
  schemaName: string;
  /**
   * Explicit JSON Schema for the output, when `schema` cannot describe itself
   * (library contracts validated by Ajv). Providers prefer it over z.toJSONSchema(schema).
   */
  jsonSchema?: Record<string, unknown>;
  tier: ModelTier;
  maxOutputTokens?: number;
  /**
   * Deterministic template output used ONLY by the stub provider.
   * It is never shown as AI work: artifacts carry provider = "stub".
   */
  stub: () => T;
}

export interface Usage {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

export interface GenerateResult<T> {
  output: T;
  usage: Usage;
  model: string;
  provider: ProviderName;
}

export type ProviderName = "stub" | "anthropic" | "session";

export interface AiProvider {
  readonly name: ProviderName;
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

/** Error that the worker may retry (timeouts, 429, 5xx). */
export class RetryableAiError extends Error {
  readonly retryable = true;
}
