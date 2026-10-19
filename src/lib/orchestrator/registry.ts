import type { z } from "zod";
import type { AiProvider } from "@/lib/ai/types";
import { reelsConcepts } from "./playbooks/reels-concepts";
import { oohConcepts } from "./playbooks/ooh-concepts";
import { ReviewSchema, ScriptsSchema, StrategySchema } from "./schemas";
import { ReviewDecisionSchema, type PlaybookSpec } from "./spec";
import type { StepContext, StepResult } from "./types";

export interface Playbook {
  key: string;
  title: string;
  roles: readonly string[];
  /** Present for declarative playbooks; drives the brief form and the package view. */
  spec?: PlaybookSpec;
  execute(ctx: StepContext, ai: AiProvider): Promise<StepResult>;
}

export const PLAYBOOKS: Record<string, Playbook> = {
  [reelsConcepts.key]: reelsConcepts,
  [oohConcepts.key]: oohConcepts,
};

/** Brief-form catalogue (serialisable: no functions, no zod). */
export const PLAYBOOK_CATALOG = [
  {
    key: reelsConcepts.key,
    title: reelsConcepts.title,
    label: "Рілси й короткі відео",
    description: "Стратегія → сценарії → рев'ю → пакет на затвердження.",
    fields: [] as PlaybookSpec["briefFields"],
  },
  ...Object.values(PLAYBOOKS)
    .filter((p) => p.spec)
    .map((p) => ({ key: p.key, title: p.title, label: p.spec!.label, description: p.spec!.description, fields: p.spec!.briefFields })),
];

/** Every output contract by schema name — used by the MCP server for instant validation feedback. */
export const OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  strategy: StrategySchema,
  scripts: ScriptsSchema,
  review: ReviewSchema,
  review_decision: ReviewDecisionSchema,
  ...Object.fromEntries(Object.values(PLAYBOOKS).flatMap((p) => (p.spec?.steps ?? []).map((s) => [s.schemaName, s.schema]))),
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
