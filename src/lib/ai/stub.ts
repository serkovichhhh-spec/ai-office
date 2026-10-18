import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Stub provider: no model is called. Output comes from the request's deterministic
 * template and is validated like real output. Everything it produces is labelled
 * provider = "stub" end to end (steps, artifacts, UI badge).
 */
export class StubProvider implements AiProvider {
  readonly name = "stub" as const;

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const output = req.schema.parse(req.stub());
    return {
      output,
      usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
      model: "stub",
      provider: "stub",
    };
  }
}
