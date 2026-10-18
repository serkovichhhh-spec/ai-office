import type { AiProvider } from "@/lib/ai/types";
import { reelsConcepts } from "./playbooks/reels-concepts";
import type { StepContext, StepResult } from "./types";

export interface Playbook {
  key: string;
  title: string;
  roles: readonly string[];
  execute(ctx: StepContext, ai: AiProvider): Promise<StepResult>;
}

export const PLAYBOOKS: Record<string, Playbook> = {
  [reelsConcepts.key]: reelsConcepts,
};

export function playbookFor(key: string): Playbook {
  const p = PLAYBOOKS[key];
  if (!p) throw new Error(`unknown playbook: ${key}`);
  return p;
}

/** Runs one step. Disabled agents are a configuration error, not a retryable one. */
export async function executeStep(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
  if (ctx.agent && !ctx.agent.enabled && ctx.step.agent_role !== "orchestrator") {
    throw new Error(`agent ${ctx.step.agent_role} is disabled in workspace ${ctx.workspace.slug}`);
  }
  return playbookFor(ctx.run.playbook_key).execute(ctx, ai);
}
