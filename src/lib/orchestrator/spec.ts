/**
 * Declarative playbooks (PlaybookSpec.v1).
 *
 * A spec describes a linear chain of AI steps, one evidence-based review with at most
 * MAX_REVIEW_LOOPS send-backs, and a package for the owner. The engine turns it into a
 * regular Playbook, so the worker, gateway, MCP and UI need no per-playbook code.
 *
 *   intake ─► step₁ ─► … ─► stepₙ ─► review ─┬─► package (needs_approval)
 *                 ▲                          │ verdict=revise and loops left
 *                 └──────── send_back_to ◄───┘
 *   owner «доопрацювати» ─► revision_intake ─► send_back_to ─► … ─► review ─► package
 */
import { z } from "zod";
import type { AiProvider, ModelTier } from "@/lib/ai/types";
import { briefText, composeSystem, dataBlock, knowledgeText } from "./prompting";
import { stubFromJsonSchema } from "./stubgen";
import type { StepContext, StepResult } from "./types";
import { codeStep, latestArtifact } from "./util";
import type { Playbook } from "./registry";

export const MAX_REVIEW_LOOPS = 1;

import type { BriefFieldSpec } from "./catalog";
export type { BriefFieldSpec } from "./catalog";

export interface StepSpec<T = unknown> {
  key: string;
  title: string;
  seat: string;
  schemaName: string;
  schema: z.ZodType<T>;
  tier?: ModelTier;
  maxOutputTokens?: number;
  /** Role prompt used when the seat has no system prompt configured in the workspace. */
  role: string;
  /** Artifact kinds (= earlier step keys) this step reads. */
  inputs: string[];
  /** Task text; brief, knowledge, inputs and feedback are appended by the engine as data blocks. */
  task: (ctx: StepContext) => string;
  /** Short human summary of the result for the event feed. */
  summary: (out: T) => string;
  /** Activity shown on the office floor while this step runs. */
  activity?: "researching" | "drafting" | "planning";
}

export interface ReviewCriterion {
  key: string;
  what: string;
  pass_if: string;
}

export interface PlaybookSpec {
  key: string;
  title: string;
  description: string;
  /** Short label for the brief form selector. */
  label: string;
  briefFields: BriefFieldSpec[];
  steps: StepSpec<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  review: { seat: string; sendBackTo: string; criteria: ReviewCriterion[] };
  package: { title: (ctx: StepContext) => string; sections: { kind: string; label: string }[] };
  handoff: { to: string; note: string };
}

// ---------------------------------------------------------------------------
// ReviewDecision.v1 — shared evidence-based review contract
// ---------------------------------------------------------------------------
export const ReviewDecisionSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  summary: z.string().min(1).max(1500),
  scores: z
    .array(
      z.object({
        criterion: z.string().min(1).max(60),
        score: z.number().int().min(1).max(5),
        comment: z.string().max(400),
      }),
    )
    .min(1)
    .max(10),
  issues: z
    .array(
      z.object({
        target: z.string().min(1).max(60),
        severity: z.enum(["low", "medium", "high"]),
        criterion: z.string().min(1).max(60),
        fragment: z.string().max(400),
        problem: z.string().min(1).max(500),
        fix: z.string().max(500),
      }),
    )
    .max(30),
  unsupported_claims: z.array(z.string().max(300)).max(20),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

/** Wording reused by every spec so the anti-fabrication rule is identical everywhere. */
export const CLAIMS_RULE =
  "Будь-яке твердження про ПАВУТИНУ (ціни, швидкості, покриття, адреси, телефони, акції), якого немає в <knowledge>, винеси в claims_needing_source і не подавай як факт.";

function stubFor<T>(schema: z.ZodType<T>, name: string): () => T {
  return () => {
    const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
    return schema.parse(stubFromJsonSchema(js as never, name));
  };
}

function inputsBlock(ctx: StepContext, kinds: string[]): string[] {
  return kinds.flatMap((k) => {
    const a = latestArtifact<unknown>(ctx, k);
    return a ? [dataBlock("artifact", `${k} v${a.version}:\n${JSON.stringify(a.content)}`)] : [];
  });
}

function aiResult<T>(
  res: { output: T; usage: StepResult["usage"]; model: string; provider: string },
  artifact: { kind: string; title: string },
  next: StepResult["next_steps"],
  activity: string,
  message: string,
): StepResult {
  return {
    output: { ok: true },
    provider: res.provider,
    model: res.model,
    usage: res.usage,
    artifacts: [{ kind: artifact.kind, title: artifact.title, content: { ...(res.output as object), _provider: res.provider } }],
    next_steps: next,
    run_status: null,
    activity,
    message,
  };
}

export function validateSpec(spec: PlaybookSpec): void {
  const keys = spec.steps.map((s) => s.key);
  if (new Set(keys).size !== keys.length) throw new Error(`${spec.key}: duplicate step keys`);
  for (const reserved of ["intake", "revision_intake", "review", "package"]) {
    if (keys.includes(reserved)) throw new Error(`${spec.key}: step key "${reserved}" is reserved`);
  }
  if (!keys.includes(spec.review.sendBackTo)) throw new Error(`${spec.key}: sendBackTo must be one of the steps`);
  spec.steps.forEach((s, i) => {
    for (const inp of s.inputs) {
      if (!keys.slice(0, i).includes(inp)) throw new Error(`${spec.key}.${s.key}: input "${inp}" is not an earlier step`);
    }
  });
  for (const sec of spec.package.sections) {
    if (!keys.includes(sec.kind)) throw new Error(`${spec.key}: package section "${sec.kind}" is not a step`);
  }
}

export function playbookFromSpec(spec: PlaybookSpec, opts: { version?: number; hidden?: boolean } = {}): Playbook & { spec: PlaybookSpec } {
  validateSpec(spec);
  const order = spec.steps.map((s) => s.key);
  const stepByKey = new Map(spec.steps.map((s) => [s.key, s]));

  /** Next hop after `key`, carrying the review-loop counter forward. */
  const after = (key: string, loop: number): StepResult["next_steps"] => {
    const i = order.indexOf(key);
    const nextKey = order[i + 1];
    if (nextKey) return [{ step_key: nextKey, agent_role: stepByKey.get(nextKey)!.seat, input: { review_loop: loop }, depends_on: [key] }];
    return [{ step_key: "review", agent_role: spec.review.seat, input: { review_loop: loop }, depends_on: [key] }];
  };

  async function runStep(ctx: StepContext, ai: AiProvider, s: StepSpec): Promise<StepResult> {
    const loop = Number(ctx.step.input.review_loop ?? 0);
    const feedback = [ctx.step.input.owner_feedback, ctx.step.input.reviewer_feedback].filter(Boolean).map(String);
    const prev = feedback.length ? latestArtifact<unknown>(ctx, s.key) : null;
    const res = await ai.generate({
      schemaName: s.schemaName,
      schema: s.schema,
      tier: s.tier ?? ctx.agent?.model_tier ?? "balanced",
      maxOutputTokens: s.maxOutputTokens,
      system: composeSystem(ctx.agent?.system_prompt, s.role),
      user: [
        s.task(ctx),
        dataBlock("brief", briefText(ctx.brief)),
        ...inputsBlock(ctx, s.inputs),
        dataBlock("knowledge", knowledgeText(ctx.knowledge)),
        prev ? dataBlock("artifact", `Попередня версія (${s.key} v${prev.version}):\n${JSON.stringify(prev.content)}`) : "",
        feedback.length ? dataBlock("feedback", feedback.join("\n---\n")) : "",
        feedback.length ? "Виправ саме те, що вказано в <feedback>; те, що не критикували, не погіршуй." : "",
        CLAIMS_RULE,
      ]
        .filter(Boolean)
        .join("\n\n"),
      stub: stubFor(s.schema, s.schemaName),
    });
    return aiResult(
      res,
      { kind: s.key, title: s.title },
      after(s.key, loop),
      s.activity ?? "drafting",
      feedback.length ? `${s.title}: доопрацьовано за коментарями` : s.summary(res.output),
    );
  }

  async function review(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
    const loop = Number(ctx.step.input.review_loop ?? 0);
    const criteria = spec.review.criteria.map((c) => `- ${c.key}: ${c.what} Пройдено, якщо: ${c.pass_if}`).join("\n");
    const res = await ai.generate({
      schemaName: "review_decision",
      schema: ReviewDecisionSchema,
      tier: ctx.agent?.model_tier ?? "balanced",
      system: composeSystem(ctx.agent?.system_prompt, "Ти — незалежний QA-рев'юер маркетингових матеріалів."),
      user: [
        "Перевір результат за критеріями. Сформуй оцінку незалежно, не спираючись на самооцінку автора.",
        `Критерії (оцінка 1–5 кожен, у scores.criterion — ключ критерію):\n${criteria}`,
        dataBlock("brief", briefText(ctx.brief)),
        ...inputsBlock(ctx, order),
        dataBlock("knowledge", knowledgeText(ctx.knowledge)),
        "Кожна проблема: target = ключ кроку, fragment = точна цитата, criterion = порушений критерій, fix = конкретне виправлення.",
        "verdict = revise, лише якщо є проблема high або критерій оцінено нижче 3. Не відкривай нових побажань, якщо це повторне рев'ю: перевір, чи усунуто попередні зауваження.",
        "У unsupported_claims перелічи твердження про ПАВУТИНУ без підтвердження в <knowledge>.",
      ].join("\n\n"),
      stub: () => ({
        verdict: "pass" as const,
        summary: "[STUB] Автоматична перевірка не виконувалась: модель не підключена.",
        scores: spec.review.criteria.map((c) => ({ criterion: c.key, score: 3, comment: "[STUB]" })),
        issues: [],
        unsupported_claims: [],
      }),
    });
    const sendBack = res.output.verdict === "revise" && loop < MAX_REVIEW_LOOPS;
    const target = spec.review.sendBackTo;
    const next = sendBack
      ? [{ step_key: target, agent_role: stepByKey.get(target)!.seat, input: { reviewer_feedback: formatIssues(res.output), review_loop: loop + 1 }, depends_on: ["review"] }]
      : [{ step_key: "package", agent_role: "orchestrator", depends_on: ["review"] }];
    return aiResult(
      res,
      { kind: "review", title: `Рев'ю: ${res.output.verdict === "pass" ? "пройдено" : "на доопрацювання"}` },
      next,
      "reviewing",
      sendBack
        ? `Рев'юер повернув на доопрацювання (зауважень: ${res.output.issues.length})`
        : res.output.verdict === "revise"
          ? "Ліміт доопрацювань вичерпано — передаю власнику із зауваженнями"
          : "Рев'ю пройдено",
    );
  }

  function intake(ctx: StepContext): StepResult {
    const b = ctx.brief;
    const warnings: string[] = [];
    if (!b.audience.trim()) warnings.push("Не вказана аудиторія — команда працюватиме з припущеннями.");
    if ((b.acceptance_criteria ?? []).length === 0) warnings.push("Немає критеріїв приймання — рев'ю спиратиметься на бриф і критерії сценарію.");
    if (ctx.knowledge.length === 0) warnings.push("У workspace немає затверджених знань — факти не використовуватимуться.");
    const fields = (b.fields ?? {}) as Record<string, unknown>;
    for (const f of spec.briefFields) {
      if (f.required && !String(fields[f.key] ?? "").trim()) warnings.push(`Не заповнено: ${f.label}.`);
    }
    const first = spec.steps[0];
    return codeStep({
      output: { playbook: spec.key, plan: [...order, "review", "package"], warnings, knowledge_docs: ctx.knowledge.length },
      next: [{ step_key: first.key, agent_role: first.seat, input: { review_loop: 0 }, depends_on: ["intake"] }],
      activity: "planning",
      message: warnings.length ? `План готовий; зауважень: ${warnings.length}` : "План готовий",
    });
  }

  function revisionIntake(ctx: StepContext): StepResult {
    const feedback = String(ctx.step.input.owner_feedback ?? "");
    const target = stepByKey.get(spec.review.sendBackTo)!;
    return codeStep({
      output: { owner_feedback: feedback, revision: ctx.step.input.revision ?? null },
      next: [{ step_key: target.key, agent_role: target.seat, input: { owner_feedback: feedback, review_loop: 0 }, depends_on: ["revision_intake"] }],
      activity: "planning",
      message: `Коментар власника — на доопрацювання: ${target.title}`,
    });
  }

  function pack(ctx: StepContext): StepResult {
    const rev = latestArtifact<ReviewDecision>(ctx, "review");
    const sections = spec.package.sections.map((sec) => {
      const a = latestArtifact<Record<string, unknown>>(ctx, sec.kind);
      if (!a) throw new Error(`package: missing artifact ${sec.kind}`);
      const { _provider, ...content } = a.content;
      void _provider;
      return { kind: sec.kind, label: sec.label, version: a.version, content };
    });
    const claims = new Set<string>(rev?.content.unsupported_claims ?? []);
    for (const s of sections) collectClaims(s.content, claims);
    const providers = new Set(ctx.artifacts.map((a) => (a.content as { _provider?: string })?._provider).filter(Boolean));
    const content = {
      schema_version: "Package.v1",
      playbook: spec.key,
      brief: { id: ctx.brief.id, title: ctx.brief.title, objective: ctx.brief.objective, channel: ctx.brief.channel, fields: ctx.brief.fields ?? {} },
      revision: ctx.run.revision,
      sections,
      review: rev ? { verdict: rev.content.verdict, summary: rev.content.summary, scores: rev.content.scores, open_issues: rev.content.issues } : null,
      unsupported_claims: [...claims].slice(0, 40),
      sources_used: ctx.knowledge.map((k) => ({ title: k.title, url: k.source_url })),
      handoff: spec.handoff,
      generated_by: [...providers],
    };
    return codeStep({
      output: { sections: sections.length },
      artifacts: [{ kind: "deliverable", title: spec.package.title(ctx), content }],
      runStatus: "needs_approval",
      activity: "waiting_approval",
      message: "Пакет готовий і чекає на затвердження",
    });
  }

  const roles = [...new Set(["orchestrator", ...spec.steps.map((s) => s.seat), spec.review.seat])];
  return {
    key: spec.key,
    version: opts.version ?? 1,
    title: spec.title,
    roles,
    spec,
    catalog: {
      key: spec.key, version: opts.version ?? 1, title: spec.title, label: spec.label, description: spec.description,
      group: "Дизайн і креатив", maxCount: 6, fields: spec.briefFields, hidden: opts.hidden,
    },
    stepTitles: Object.fromEntries(spec.steps.map((s) => [s.key, s.title])),
    schemas: Object.fromEntries([...spec.steps.map((s) => [s.schemaName, s.schema]), ["review_decision", ReviewDecisionSchema]]),
    async execute(ctx, ai) {
      const k = ctx.step.step_key;
      if (k === "intake") return intake(ctx);
      if (k === "revision_intake") return revisionIntake(ctx);
      if (k === "review") return review(ctx, ai);
      if (k === "package") return pack(ctx);
      const s = stepByKey.get(k);
      if (!s) throw new Error(`${spec.key}: unknown step ${k}`);
      return runStep(ctx, ai, s);
    },
  };
}

function formatIssues(r: ReviewDecision): string {
  return [
    r.summary,
    ...r.issues.map((i) => `[${i.severity}] ${i.target} · ${i.criterion}: ${i.problem}${i.fragment ? ` («${i.fragment}»)` : ""}${i.fix ? ` → ${i.fix}` : ""}`),
  ].join("\n");
}

/** Gathers every claims_needing_source array found anywhere in a step output. */
function collectClaims(v: unknown, into: Set<string>): void {
  if (Array.isArray(v)) v.forEach((x) => collectClaims(x, into));
  else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) {
      if (k === "claims_needing_source" && Array.isArray(val)) val.forEach((c) => typeof c === "string" && into.add(c));
      else collectClaims(val, into);
    }
  }
}
