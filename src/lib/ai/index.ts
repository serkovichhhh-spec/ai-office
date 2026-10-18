import { AnthropicProvider, DEFAULT_MODELS, DEFAULT_PRICES } from "./anthropic";
import { StubProvider } from "./stub";
import type { AiProvider } from "./types";

/** Selects the provider from env. Anything other than an explicit, keyed "anthropic" is the stub. */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider {
  if (env.AI_PROVIDER === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
    }
    const models = {
      fast: env.ANTHROPIC_MODEL_FAST || DEFAULT_MODELS.fast,
      balanced: env.ANTHROPIC_MODEL_BALANCED || DEFAULT_MODELS.balanced,
      strong: env.ANTHROPIC_MODEL_STRONG || DEFAULT_MODELS.strong,
    };
    return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, models, prices: DEFAULT_PRICES });
  }
  return new StubProvider();
}

export * from "./types";
