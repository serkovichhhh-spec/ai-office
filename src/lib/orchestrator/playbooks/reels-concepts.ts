import type { AiProvider } from "@/lib/ai/types";
import { ReviewSchema, ScriptsSchema, StrategySchema, type Review, type Scripts, type Strategy } from "../schemas";
import { briefText, carryOwner, composeSystem, dataBlock, feedbackParts, knowledgeText, ownerBlock } from "../prompting";
import type { StepContext, StepResult } from "../types";
import { latestArtifact, codeStep } from "../util";

/** Max times the reviewer may send scripts back within one revision of the run. */
export const MAX_REVIEW_LOOPS = 1;

const KEY = "reels_concepts";

export const reelsConcepts = {
  key: KEY,
  title: "Концепції та сценарії рілсів",
  roles: ["orchestrator", "strategist", "copywriter", "reviewer"],
  async execute(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
    switch (ctx.step.step_key) {
      case "intake":
        return intake(ctx);
      case "revision_intake":
        return revisionIntake(ctx);
      case "strategy":
        return strategy(ctx, ai);
      case "scripts":
        return scripts(ctx, ai);
      case "review":
        return review(ctx, ai);
      case "package":
        return pack(ctx);
      default:
        throw new Error(`${KEY}: unknown step ${ctx.step.step_key}`);
    }
  },
};

// ---------- orchestrator steps (deterministic code) ----------

function intake(ctx: StepContext): StepResult {
  const b = ctx.brief;
  const warnings: string[] = [];
  if (!b.audience.trim()) warnings.push("Не вказана аудиторія — стратег працюватиме з припущеннями.");
  if (!b.channel.trim()) warnings.push("Не вказаний канал.");
  if ((b.acceptance_criteria ?? []).length === 0) warnings.push("Немає критеріїв приймання — рев'юер перевірятиме лише бриф.");
  if (ctx.knowledge.length === 0) warnings.push("У workspace немає затверджених знань — факти не використовуватимуться.");
  return codeStep({
    output: { plan: ["strategy", "scripts", "review", "package"], warnings, knowledge_docs: ctx.knowledge.length },
    next: [{ step_key: "strategy", agent_role: "strategist", depends_on: ["intake"] }],
    activity: "planning",
    message: warnings.length ? `План готовий; зауважень: ${warnings.length}` : "План готовий",
  });
}

function revisionIntake(ctx: StepContext): StepResult {
  const feedback = String(ctx.step.input.owner_feedback ?? "");
  return codeStep({
    output: { owner_feedback: feedback, revision: ctx.step.input.revision ?? null },
    next: [{ step_key: "scripts", agent_role: "copywriter", input: { owner_feedback: feedback }, depends_on: ["revision_intake"] }],
    activity: "planning",
    message: "Отримано коментар власника — сценарії на доопрацювання",
  });
}

function pack(ctx: StepContext): StepResult {
  const strat = latestArtifact<Strategy>(ctx, "strategy");
  const scr = latestArtifact<Scripts>(ctx, "scripts");
  const rev = latestArtifact<Review>(ctx, "review");
  if (!strat || !scr) throw new Error("package: missing strategy or scripts artifact");
  const providers = new Set(ctx.artifacts.map((a) => (a.content as { _provider?: string })?._provider).filter(Boolean));
  const content = {
    brief: { id: ctx.brief.id, title: ctx.brief.title, objective: ctx.brief.objective, channel: ctx.brief.channel },
    revision: ctx.run.revision,
    strategy_summary: strat.content.summary,
    angles: strat.content.angles,
    scripts: scr.content.scripts,
    review: rev ? { verdict: rev.content.verdict, summary: rev.content.summary, open_issues: rev.content.issues } : null,
    unsupported_claims: rev?.content.unsupported_claims ?? [],
    sources_used: ctx.knowledge.map((k) => ({ title: k.title, url: k.source_url })),
    generated_by: [...providers],
  };
  return codeStep({
    output: { scripts: scr.content.scripts.length },
    artifacts: [{ kind: "deliverable", title: `Пакет рілсів: ${ctx.brief.title}`, content }],
    runStatus: "needs_approval",
    activity: "waiting_approval",
    message: "Пакет готовий і чекає на затвердження",
  });
}

// ---------- agent steps (AI provider) ----------

async function strategy(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
  const b = ctx.brief;
  const n = Math.min(Math.max(b.deliverable_count, 1), 5);
  const res = await ai.generate({
    schemaName: "strategy",
    schema: StrategySchema,
    tier: ctx.agent?.model_tier ?? "balanced",
    system: composeSystem(ctx.agent?.system_prompt, "Ти — маркетинговий стратег."),
    user: [
      `Сформуй ${n} різних кутів подачі для брифу workspace «${ctx.workspace.name}».`,
      dataBlock("brief", briefText(b)),
      dataBlock("knowledge", knowledgeText(ctx.knowledge)),
      "У полі evidence для кожного кута перелічи назви документів із <knowledge>, на які спираєшся.",
    ].join("\n\n"),
    stub: () => ({
      summary: `[STUB] Шаблонна стратегія на основі брифу «${b.title}». Текст не згенерований моделлю.`,
      angles: Array.from({ length: n }, (_, i) => ({
        title: `[STUB] Кут ${i + 1}`,
        insight: `Шаблон: інсайт для мети «${trim(b.objective, 200)}»`,
        hook_idea: `Шаблон хука №${i + 1}`,
        why_it_works: "Шаблон: пояснення з'явиться після підключення моделі.",
        evidence: ctx.knowledge.slice(0, 1).map((k) => k.title),
      })),
      open_questions: b.audience.trim() ? [] : ["Хто цільова аудиторія?"],
    }),
  });
  return aiStep(res, {
    artifact: { kind: "strategy", title: "Стратегія та кути подачі" },
    next: [{ step_key: "scripts", agent_role: "copywriter", depends_on: ["strategy"] }],
    activity: "researching",
    message: `Кутів подачі: ${res.output.angles.length}`,
  });
}

async function scripts(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
  const b = ctx.brief;
  const strat = latestArtifact<Strategy>(ctx, "strategy");
  if (!strat) throw new Error("scripts: strategy artifact missing");
  const feedback = feedbackParts(ctx.step.input);
  const prev = latestArtifact<Scripts>(ctx, "scripts");
  const res = await ai.generate({
    schemaName: "scripts",
    schema: ScriptsSchema,
    tier: ctx.agent?.model_tier ?? "balanced",
    maxOutputTokens: 6000,
    system: composeSystem(ctx.agent?.system_prompt, "Ти — копірайтер коротких відео."),
    user: [
      `Напиши рівно ${b.deliverable_count} сценаріїв рілсів за стратегією. Кожен — окремий кут подачі.`,
      dataBlock("brief", briefText(b)),
      dataBlock("artifact", JSON.stringify(strat.content)),
      dataBlock("knowledge", knowledgeText(ctx.knowledge)),
      prev && feedback.length ? dataBlock("artifact", `Попередня версія сценаріїв:\n${JSON.stringify(prev.content)}`) : "",
      feedback.length ? dataBlock("feedback", feedback.join("\n---\n")) : "",
      "Твердження, яких немає в <knowledge>, винеси в claims_needing_source.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    stub: () => ({
      scripts: Array.from({ length: b.deliverable_count }, (_, i) => {
        const angle = strat.content.angles[i % strat.content.angles.length];
        return {
          title: `[STUB] Сценарій ${i + 1}`,
          angle: angle.title,
          duration_sec: 20,
          hook: `[STUB] ${angle.hook_idea}`,
          scenes: [
            { shot: "Шаблонний кадр 1", on_screen_text: "Текст на екрані (шаблон)", voiceover: "Озвучка (шаблон)" },
            { shot: "Шаблонний кадр 2", on_screen_text: "", voiceover: "" },
          ],
          cta: b.channel ? `CTA для ${b.channel} (шаблон)` : "CTA (шаблон)",
          claims_needing_source: [],
        };
      }),
    }),
  });
  return aiStep(res, {
    artifact: { kind: "scripts", title: `Сценарії (${res.output.scripts.length})` },
    // Carry the review-loop counter so the reviewer knows how many send-backs already happened.
    next: [{ step_key: "review", agent_role: "reviewer", input: { review_loop: Number(ctx.step.input.review_loop ?? 0), ...carryOwner(ctx.step.input) }, depends_on: ["scripts"] }],
    activity: "drafting",
    message: feedback.length ? "Сценарії доопрацьовано за коментарями" : `Сценаріїв: ${res.output.scripts.length}`,
  });
}

async function review(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
  const b = ctx.brief;
  const scr = latestArtifact<Scripts>(ctx, "scripts");
  if (!scr) throw new Error("review: scripts artifact missing");
  const res = await ai.generate({
    schemaName: "review",
    schema: ReviewSchema,
    tier: ctx.agent?.model_tier ?? "fast",
    system: composeSystem(ctx.agent?.system_prompt, "Ти — QA-рев'юер маркетингових матеріалів."),
    user: [
      "Перевір сценарії на відповідність брифу та критеріям приймання. Познач твердження без джерела в <knowledge>.",
      "verdict = revise лише якщо є проблеми рівня high або порушено критерій приймання.",
      dataBlock("brief", briefText(b)),
      dataBlock("artifact", JSON.stringify(scr.content)),
      dataBlock("knowledge", knowledgeText(ctx.knowledge)),
      ownerBlock(ctx.step.input),
    ].join("\n\n"),
    stub: () => ({
      verdict: "pass" as const,
      summary: "[STUB] Автоматична перевірка не виконувалась: модель не підключена. Перевірте сценарії вручну.",
      issues: [],
      unsupported_claims: scr.content.scripts.flatMap((s) => s.claims_needing_source),
    }),
  });

  // Bounded loop: count review steps in the current run revision that already sent work back.
  const loopsSoFar = Number(ctx.step.input.review_loop ?? 0);
  const sendBack = res.output.verdict === "revise" && loopsSoFar < MAX_REVIEW_LOOPS;
  const next = sendBack
    ? [
        {
          step_key: "scripts",
          agent_role: "copywriter",
          input: { reviewer_feedback: formatIssues(res.output), review_loop: loopsSoFar + 1, ...carryOwner(ctx.step.input) },
          depends_on: ["review"],
        },
      ]
    : [{ step_key: "package", agent_role: "orchestrator", depends_on: ["review"] }];
  return aiStep(res, {
    artifact: { kind: "review", title: `Рев'ю: ${res.output.verdict === "pass" ? "пройдено" : "на доопрацювання"}` },
    next,
    activity: "reviewing",
    message: sendBack
      ? `Рев'юер повернув сценарії (проблем: ${res.output.issues.length})`
      : res.output.verdict === "revise"
        ? "Ліміт доопрацювань вичерпано — передаю власнику із зауваженнями"
        : "Рев'ю пройдено",
  });
}

// ---------- helpers ----------

function formatIssues(r: Review): string {
  return [r.summary, ...r.issues.map((i) => `#${i.script_index + 1} [${i.severity}] ${i.issue}${i.fix ? ` → ${i.fix}` : ""}`)].join("\n");
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function aiStep<T>(
  res: { output: T; usage: StepResult["usage"]; model: string; provider: string },
  o: { artifact: { kind: string; title: string }; next: StepResult["next_steps"]; activity: string; message: string },
): StepResult {
  return {
    output: { ok: true },
    provider: res.provider,
    model: res.model,
    usage: res.usage,
    artifacts: [{ kind: o.artifact.kind, title: o.artifact.title, content: { ...(res.output as object), _provider: res.provider } }],
    next_steps: o.next,
    run_status: null,
    activity: o.activity,
    message: o.message,
  };
}
