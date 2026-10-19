import { z } from "zod";
import type { StepContext } from "./types";

export const TOPICS = ["company", "product", "benefits", "offer_terms", "coverage", "brand", "audience", "competition", "measurement"] as const;
const Ref = z.object({ record_id: z.string().min(1).max(100), version: z.string().min(1).max(100), pointer: z.string().min(1).max(300) }).strict();
const Topic = z.object({
  topic: z.enum(TOPICS), status: z.enum(["verified", "hypothesis", "missing", "not_applicable"]),
  summary: z.string().min(1).max(2200), refs: z.array(Ref).max(20),
  limitations: z.array(z.string().min(1).max(500)).max(15),
}).strict();

/** Self-contained CMO brief consumed by every downstream seat. */
export const MarketingBriefSchema = z.object({
  status: z.enum(["ready", "blocked"]),
  summary: z.string().min(1).max(1500),
  business_goal: z.string().min(1).max(1000),
  topics: z.array(Topic).length(TOPICS.length),
  strategic_choice: z.object({
    target_segment: z.string().min(1).max(1000),
    need_and_barrier: z.string().min(1).max(1000),
    value_proposition: z.string().min(1).max(1200),
    reason_to_believe: z.string().min(1).max(1000),
    main_message: z.string().min(1).max(800),
    cta_and_customer_path: z.string().min(1).max(1200),
    rationale: z.string().min(1).max(1500),
  }).strict(),
  assignments: z.array(z.object({
    step: z.enum(["prepare", "build", "review"]), seat: z.string().min(1).max(80),
    task: z.string().min(1).max(1800), deliverable: z.string().min(1).max(1200),
    acceptance_criteria: z.array(z.string().min(1).max(500)).min(1).max(15),
  }).strict()).length(3),
  previous_decisions: z.array(z.string().min(1).max(800)).max(30),
  assumptions: z.array(z.string().min(1).max(800)).max(30),
  gaps: z.array(z.object({
    topic: z.enum(TOPICS), problem: z.string().min(1).max(800),
    kind: z.enum(["missing_fact", "context_not_delivered", "stale_or_conflicting", "tool_unavailable"]),
    owner: z.string().min(1).max(100), next_action: z.string().min(1).max(800),
    blocking: z.boolean(),
  }).strict()).max(30),
  blocking_questions: z.array(z.string().min(1).max(1000)).max(30),
}).strict();
export type MarketingBrief = z.infer<typeof MarketingBriefSchema>;

/** Minimal deterministic requirements; further task-specific gaps remain the CMO's duty. */
export function requiredTopics(playbook: string): string[] {
  const required = ["company", "product"];
  if (!["campaign_analysis", "competitor_analysis"].includes(playbook)) required.push("brand");
  if (["paid_media_campaign", "offer_launch", "outdoor_print_pack"].includes(playbook)) required.push("coverage", "benefits");
  if (["paid_media_campaign", "offer_launch"].includes(playbook)) required.push("offer_terms");
  if (playbook === "campaign_analysis") required.push("measurement");
  if (playbook === "competitor_analysis") required.push("competition");
  return required;
}

function pointerValue(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) return undefined;
  let value = root;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Verify identity/version/pointers, not semantic entailment (that remains independent QA). */
export function evidenceErrors(value: unknown, ctx: StepContext): string[] {
  const errors: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if ("record_id" in obj && "version" in obj && "pointer" in obj) {
      const doc = ctx.knowledge.find((k) => k.id === obj.record_id);
      if (!doc || doc.version !== obj.version) errors.push(`Недоступне або застаріле джерело: ${String(obj.record_id)} v${String(obj.version)}`);
      else if (pointerValue(doc, String(obj.pointer)) === undefined) errors.push(`Невірний KnowledgeRef.pointer: ${String(obj.pointer)}`);
    }
    if (typeof obj.output_pointer === "string" && pointerValue(value, obj.output_pointer) === undefined) {
      errors.push(`source_uses.output_pointer не існує: ${obj.output_pointer}`);
    }
    Object.values(obj).forEach(visit);
  };
  visit(value);
  return [...new Set(errors)].slice(0, 30);
}

export function marketingBriefErrors(v: MarketingBrief, ctx: StepContext, seats: Record<string, string>): string[] {
  const errors = evidenceErrors(v, ctx);
  if (new Set(v.topics.map((t) => t.topic)).size !== TOPICS.length) errors.push("topics: кожна категорія має бути рівно один раз");
  for (const t of v.topics) {
    if (t.status === "verified" && t.refs.length === 0) errors.push(`${t.topic}: verified потребує джерела`);
    if (["missing", "not_applicable"].includes(t.status) && t.refs.length) errors.push(`${t.topic}: не додавай refs до відсутнього/незастосовного факту`);
  }
  const steps = v.assignments.map((a) => a.step);
  if (new Set(steps).size !== 3) errors.push("assignments: prepare, build і review мають бути рівно один раз");
  for (const a of v.assignments) if (seats[a.step] !== a.seat) errors.push(`assignments.${a.step}: seat має бути ${seats[a.step]}`);
  if (v.status === "ready") {
    for (const [key, text] of Object.entries({ business_goal: v.business_goal, ...v.strategic_choice })) {
      if (/^(ца|усі|всі|аудиторія|цільова аудиторія|tbd|todo|n\/?a|невідомо|уточнити|\[stub\])\s*[.!]?$/i.test(text.trim())) errors.push(`${key}: заглушка замість робочої вводної`);
    }
    if (v.blocking_questions.length || v.gaps.some((g) => g.blocking)) errors.push("ready не допускає блокуючих прогалин");
    for (const key of requiredTopics(ctx.run.playbook_key)) {
      if (!v.topics.some((t) => t.topic === key && t.status === "verified")) errors.push(`ready потребує підтвердженого контексту: ${key}`);
    }
  } else if (!v.blocking_questions.length || !v.gaps.some((g) => g.blocking)) errors.push("blocked потребує питання та відповідальної блокуючої прогалини");
  return errors;
}

export function marketingBriefContract(ctx: StepContext, seats: Record<string, string>) {
  return MarketingBriefSchema.superRefine((v, check) => {
    for (const message of marketingBriefErrors(v, ctx, seats)) check.addIssue({ code: "custom", message });
  });
}

export function marketingBriefTask(ctx: StepContext, seats: Record<string, string>): string {
  return `Підготуй самодостатній професійний бриф CMO для всіх виконавців плейбука ${ctx.run.playbook_key}.
Прочитай УСІ доступні документи й попередні рішення. Не обмежуйся брендбуком. Витягни факти про компанію, продукт, переваги, умови, покриття і джерела; зістав їх саме з задачею.
Обов'язково підтвердити для ready: ${requiredTopics(ctx.run.playbook_key).join(", ")}. Для інших topics поясни застосовність; аудиторні інсайти без дослідження познач hypothesis. Не вигадуй УТП: відрізняй вигоду від доведеної унікальності.
Для offer_terms і coverage розкрий обмеження: сегмент, адреса/географія, умови підключення, період, обладнання, застереження. Якщо кампанія без цінового оффера, явно вкажи це; не вигадуй тариф.
Для competition дай висновки з фактично перевірених джерел або чесно назви відсутність дослідження. Якщо воно необхідне за задачею/правкою, відсутність результатів є blocking gap відповідального research_analyst. За доступного пошуку виконай дослідження; якщо інструмента немає, не імітуй його. Не додавай непідтверджені зовнішні факти у verified.
Призначення фіксовані: ${JSON.stringify(seats)}. Декомпозуй завдання всередині цих кроків, без створення нових кроків чи вигаданих виконавців.
Для кожного передай конкретний результат, критерії якості та потрібні факти. Визнач бізнес-мету, сегмент, бар'єр, ціннісну пропозицію, докази, головний меседж, CTA та реальний шлях після нього, спосіб вимірювання.
Кожен verified topic потребує KnowledgeRef з наданого контексту. Для відсутніх, недоставлених, суперечливих даних чи інструментів вкажи вид прогалини, відповідального і точну наступну дію. Не змушуй власника повторювати наявні в джерелах дані. Не блокуй роботу через нерелевантну інформацію.
Поверни один MarketingBrief JSON за схемою. ready означає достатній бриф, а не готовий або затверджений рекламний матеріал.`;
}

/** Stub always blocks. A template is never a professional CMO decision. */
export function blockedBriefStub(seats: Record<string, string>): MarketingBrief {
  return {
    status: "blocked", summary: "[STUB] Бриф CMO не підготовлено моделлю.", business_goal: "[STUB] Потрібне опрацювання запиту.",
    topics: TOPICS.map((topic) => ({ topic, status: "missing", summary: "[STUB] Не перевірено", refs: [], limitations: ["Модель не виконувала аналіз"] })),
    strategic_choice: { target_segment: "[STUB]", need_and_barrier: "[STUB]", value_proposition: "[STUB]", reason_to_believe: "[STUB]", main_message: "[STUB]", cta_and_customer_path: "[STUB]", rationale: "[STUB]" },
    assignments: (["prepare", "build", "review"] as const).map((step) => ({ step, seat: seats[step], task: "[STUB] Не виконано", deliverable: "[STUB]", acceptance_criteria: ["Підготувати реальний бриф"] })),
    previous_decisions: [], assumptions: [],
    gaps: [{ topic: "company", problem: "Бриф не виконано моделлю", kind: "tool_unavailable", owner: "orchestrator", next_action: "Виконати крок реальним виконавцем", blocking: true }],
    blocking_questions: ["[STUB] Потрібен реальний виконавець CMO"],
  };
}
