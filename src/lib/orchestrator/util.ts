import type { NextStep, StepContext, StepResult } from "./types";

export function latestArtifact<T>(ctx: StepContext, kind: string): { version: number; content: T } | null {
  let best: { version: number; content: T } | null = null;
  for (const a of ctx.artifacts) {
    if (a.kind === kind && (!best || a.version > best.version)) best = { version: a.version, content: a.content as T };
  }
  return best;
}

/** Result of a deterministic (non-AI) orchestrator step. */
export function codeStep(o: {
  output: unknown;
  next?: NextStep[];
  artifacts?: StepResult["artifacts"];
  runStatus?: StepResult["run_status"];
  activity: string;
  message: string;
}): StepResult {
  return {
    output: o.output,
    provider: "code",
    model: null,
    usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
    artifacts: o.artifacts ?? [],
    next_steps: o.next ?? [],
    run_status: o.runStatus ?? null,
    activity: o.activity,
    message: o.message,
  };
}
