import type { z } from "zod";
import type { AiProvider } from "@/lib/ai/types";
import type { CatalogEntry } from "./catalog";
import { LIBRARY_PLAYBOOKS } from "./library";
import { contract, ROUND2_CONTRACTS } from "./contracts";
import { oohConcepts } from "./playbooks/ooh-concepts";
import { reelsConcepts } from "./playbooks/reels-concepts";
import { ReviewSchema, ScriptsSchema, StrategySchema } from "./schemas";
import { ReviewDecisionSchema } from "./spec";
import type { StepContext, StepResult } from "./types";

export interface Playbook {
  key: string;
  /** Runs keep the version they started with; new briefs use the latest. */
  version: number;
  title: string;
  roles: readonly string[];
  /** Brief-form entry; absent for legacy playbooks that keep running but are not offered any more. */
  catalog?: CatalogEntry;
  /** Human titles for this playbook's step keys. */
  stepTitles?: Record<string, string>;
  /** Output contracts by schema name (for MCP instant validation). */
  schemas?: Record<string, z.ZodType>;
  execute(ctx: StepContext, ai: AiProvider): Promise<StepResult>;
}

const ALL: Playbook[] = [
  { ...reelsConcepts, version: 1, stepTitles: { strategy: "Стратегія", scripts: "Сценарії" } },
  { ...oohConcepts, version: 1 },
  ...LIBRARY_PLAYBOOKS,
];

export const PLAYBOOKS: Record<string, Playbook> = Object.fromEntries(ALL.map((p) => [`${p.key}@${p.version}`, p]));

/** Latest version per key that is offered in the brief form. */
export const PLAYBOOK_CATALOG: CatalogEntry[] = ALL.filter((p) => p.catalog && !p.catalog.hidden)
  .map((p) => p.catalog!)
  .sort((a, b) => (a.priority ?? "P9").localeCompare(b.priority ?? "P9") || a.group.localeCompare(b.group) || a.title.localeCompare(b.title));

/** Every output contract by schema name — used by the MCP server for instant validation feedback. */
export const OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  strategy: StrategySchema,
  scripts: ScriptsSchema,
  review: ReviewSchema,
  review_decision: ReviewDecisionSchema,
  ...Object.fromEntries(ALL.flatMap((p) => Object.entries(p.schemas ?? {}))),
  ...Object.fromEntries(ROUND2_CONTRACTS.flatMap((name) => {
    const schema = contract(name);
    return [[name, schema], [`${name}.v1`, schema]];
  })),
};

export function playbookFor(key: string, version = 1): Playbook {
  const p = PLAYBOOKS[`${key}@${version}`];
  if (!p) throw new Error(`unknown playbook: ${key} v${version}`);
  return p;
}

export function stepTitle(key: string): string | undefined {
  for (const p of ALL) if (p.stepTitles?.[key]) return p.stepTitles[key];
  return undefined;
}

/** Runs one step. Disabled agents are a configuration error, not a retryable one. */
export async function executeStep(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
  if (ctx.agent && !ctx.agent.enabled && ctx.step.agent_role !== "orchestrator") {
    throw new Error(`agent ${ctx.step.agent_role} is disabled in workspace ${ctx.workspace.slug}`);
  }
  return playbookFor(ctx.run.playbook_key, Number(ctx.run.playbook_version ?? 1)).execute(ctx, ai);
}
