/**
 * Playbook library v1 (playbook-library/, approved 2026-10-19) compiled into runnable playbooks.
 *
 *   intake ─► prepare ─► build ─► review₁ ─┬─ pass (gates) ─────────────► package: ready_for_approval
 *               │blocked   │blocked        ├─ escalate ─────────────────► package: escalated
 *               ▼          ▼               └─ revise ─► build (revise) ─► review₂ ─ pass ─► ready / else escalated
 *            package: blocked
 *
 * The route after review is computed by the server from scores and issues, not from the
 * reviewer's word alone. Blocked and escalated packages can be revised or rejected, never
 * approved (DB trigger approvals_outcome_gate).
 */
import type { AiProvider, ModelTier } from "@/lib/ai/types";
import type { BriefFieldSpec, CatalogEntry } from "./catalog";
import { ENUM_LABEL, FIELD_LABEL, PLAYBOOK_GROUP } from "./catalog";
import { bundle, contract, type SemanticCheck } from "./contracts";
import briefSchemas from "./library/brief-schemas.json";
import libraryDefs from "./library/playbooks.json";
import registry from "./library/registry.json";
import { briefText, carryOwner, composeSystem, dataBlock, feedbackParts, knowledgeText, ownerBlock } from "./prompting";
import type { Playbook } from "./registry";
import { stubFromJsonSchema } from "./stubgen";
import type { StepContext, StepResult } from "./types";
import { codeStep, latestArtifact } from "./util";

export const LIBRARY_VERSION = (registry as { library_version: string }).library_version;
export const MAX_REVISIONS = 1;

interface LibStep {
  key: string;
  seat: string;
  executor: string;
  inputs: string[];
  task: string;
  output_schema: { $ref: string };
  quality_checks: string[];
}
interface LibDef {
  playbook_key: string;
  title: string;
  use_when: string;
  brief_fields: { key: string; type: string; required: boolean; hint: string }[];
  steps: LibStep[];
  review: { seat: string; executor: string; criteria: { key: string; what: string; pass_if: string }[]; send_back_to: string };
  package: { sections: string[] };
  handoff: { to: string; payload: string[] };
  risks: string[];
}
interface RegEntry {
  playbook_key: string;
  priority: "P1" | "P2" | "P3";
  version: number;
  main_output: string;
  deliverable_count_max: number;
}

const BASE_BRIEF = new Set(["title", "objective", "audience", "channel", "deliverable_count", "deadline", "acceptance_criteria", "references"]);
const STEP_TITLE: Record<string, string> = { prepare: "Підготовка", build: "Основний матеріал" };
export const SECTION_LABEL: Record<string, string> = {
  summary: "Підсумок", items: "Календар", cadence_rationale: "Логіка частоти", production_dependencies: "Що потрібно для продакшну",
  units: "Матеріали", publishing_checklist: "Чекліст публікації", creatives: "Креативи", export_checklist: "Чекліст експорту",
  directions: "Візуальні напрями", recommended_direction_id: "Рекомендований напрям", ranked_candidates: "Рейтинг ідей",
  selected_ids: "Обрані ідеї", discard_reasons: "Чому відкинуто решту", structure: "Структура кампанії", ads: "Оголошення",
  scripts: "Сценарії", production_checklist: "Чекліст продакшну", layouts: "Макети", supplier_questions: "Питання до друкарні",
  tasks: "Завдання запуску", measurement: "Вимірювання", readiness_checklist: "Чекліст готовності", findings: "Висновки",
  calculations: "Розрахунки", actions: "Дії", data_quality: "Якість даних", rows: "Матриця конкурентів",
  research_candidates: "Нові джерела на перевірку", delivery_checklist: "Чекліст доставки",
  claims_needing_source: "Потрібно підтвердити", assumptions: "Припущення", blocking_questions: "Блокуючі питання",
  source_uses: "Джерела тверджень", review: "Рев'ю",
};

const defs = libraryDefs as LibDef[];
const regByKey = new Map((registry as { playbooks: RegEntry[] }).playbooks.map((r) => [r.playbook_key, r]));
const briefDefs = (briefSchemas as { $defs: Record<string, { properties: Record<string, Record<string, unknown>>; required: string[] }> }).$defs;

function defName(step: LibStep): string {
  return step.output_schema.$ref.replace(/^.*#\/\$defs\//, "");
}

// ---------------------------------------------------------------------------
// Semantic checks beyond JSON Schema (playbook-library/semantic-rules.md)
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

function genericChecks(v: Obj): string[] {
  const out: string[] = [];
  if (v.status === "ready") {
    if (arr(v.blocking_questions).length) out.push("status=ready, але blocking_questions не порожній");
    if (arr(v.claims_needing_source).some((c) => c.disposition === "placeholder")) {
      out.push("status=ready не допускає claims з disposition=placeholder — або підтвердити, або status=blocked");
    }
  }
  if (v.status === "blocked" && arr(v.blocking_questions).length === 0) out.push("status=blocked потребує хоча б одного blocking_questions");
  return out;
}

function buildChecks(key: string, ctx: StepContext): SemanticCheck {
  const reg = regByKey.get(key)!;
  const n = ctx.brief.deliverable_count;
  return (v) => {
    const out = genericChecks(v);
    if (v.status !== "ready") return out;
    const main = v[reg.main_output];
    if (Array.isArray(main) && main.length !== n) out.push(`${reg.main_output}: має бути рівно ${n} (deliverable_count), а є ${main.length}`);
    if (key === "paid_media_campaign") {
      const budget = arr((v.structure as Obj | undefined)?.budget);
      const sum = budget.reduce((s, b) => s + Number(b.share_percent ?? 0), 0);
      if (budget.length && Math.abs(sum - 100) > 1e-6) out.push(`structure.budget: сума share_percent = ${sum}, має бути 100`);
    }
    if (key === "reels_concepts") {
      const want = Number((ctx.brief.fields ?? {}).duration_seconds ?? NaN);
      arr(v.scripts).forEach((s, i) => {
        const d = Number(s.duration_seconds);
        if (Number.isFinite(want) && Math.abs(d - want) > 0.01) out.push(`scripts[${i}].duration_seconds=${d}, у брифі ${want}`);
        const shots = arr(s.shots).slice().sort((a, b) => Number(a.order) - Number(b.order));
        let t = 0;
        for (const sh of shots) {
          if (Math.abs(Number(sh.start_seconds) - t) > 0.01) { out.push(`scripts[${i}]: кадр ${String(sh.order)} починається з ${String(sh.start_seconds)}, очікувалось ${t}`); break; }
          if (Number(sh.end_seconds) <= Number(sh.start_seconds)) { out.push(`scripts[${i}]: кадр ${String(sh.order)} має end <= start`); break; }
          t = Number(sh.end_seconds);
        }
        if (shots.length && Math.abs(t - d) > 0.01) out.push(`scripts[${i}]: останній кадр закінчується на ${t}, а тривалість ${d}`);
      });
    }
    if (key === "creative_ideation") {
      const ranked = arr(v.ranked_candidates);
      ranked.forEach((c, i) => {
        const w = Number(c.brief_score) * 0.35 + Number(c.distinctiveness_score) * 0.25 + Number(c.feasibility_score) * 0.25 + Number(c.evidence_score) * 0.15;
        if (Math.abs(w - Number(c.weighted_score)) > 0.01) out.push(`ranked_candidates[${i}].weighted_score=${String(c.weighted_score)}, за формулою ${w.toFixed(2)}`);
      });
      const flagged = ranked.filter((c) => c.selected === true).map((c) => String((c.concept as Obj | undefined)?.id));
      const ids = (v.selected_ids as string[] | undefined) ?? [];
      if (flagged.sort().join() !== ids.slice().sort().join()) out.push("selected_ids не збігаються з кандидатами, позначеними selected=true");
    }
    return out;
  };
}

function reviewChecks(def: LibDef): SemanticCheck {
  const keys = def.review.criteria.map((c) => c.key);
  return (v) => {
    const out: string[] = [];
    const scores = arr(v.scores);
    const got = scores.map((s) => String(s.key));
    if (got.slice().sort().join() !== keys.slice().sort().join()) out.push(`scores мають містити рівно критерії: ${keys.join(", ")}`);
    for (const i of arr(v.issues)) if (!keys.includes(String(i.criterion))) out.push(`issue ${String(i.id)}: невідомий criterion ${String(i.criterion)}`);
    if (v.decision === "pass" && !gatesPass(v)) out.push("decision=pass суперечить порогам: evidence має бути 5, решта ≥ 4, без відкритих critical/major");
    return out;
  };
}

function gatesPass(v: Obj): boolean {
  const scores = arr(v.scores);
  const ok = scores.every((s) => (s.key === "evidence" ? Number(s.score) === 5 : Number(s.score) >= 4));
  const openBlocking = arr(v.issues).some((i) => i.resolution === "open" && (i.severity === "critical" || i.severity === "major"));
  return scores.length > 0 && ok && !openBlocking;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
function libraryPlaybook(def: LibDef): Playbook {
  const reg = regByKey.get(def.playbook_key) as RegEntry;
  if (!reg) throw new Error(`registry entry missing for ${def.playbook_key}`);
  const steps = def.steps;
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const order = steps.map((s) => s.key);
  const reviewTarget = def.review.send_back_to;

  // Stub output (stub provider and tests only): minimal valid JSON, then made semantically consistent.
  const stubFor = (name: string, ctx: StepContext) => () => fixStub(def.playbook_key, stubFromJsonSchema(bundle(name) as never, name) as Obj, ctx);

  const toPackage = (outcome: "ready_for_approval" | "blocked" | "escalated", from: string): StepResult["next_steps"] => [
    { step_key: "package", agent_role: "orchestrator", input: { outcome }, depends_on: [from] },
  ];

  async function authorStep(ctx: StepContext, ai: AiProvider, s: LibStep): Promise<StepResult> {
    const loop = Number(ctx.step.input.review_loop ?? 0);
    const feedback = feedbackParts(ctx.step.input);
    const prev = feedback.length ? latestArtifact<unknown>(ctx, s.key) : null;
    const name = defName(s);
    const missing = (ctx.step.input.missing_inputs as string[] | undefined) ?? [];
    const res = await ai.generate({
      schemaName: name,
      schema: contract<Obj>(name, s.key === "build" ? buildChecks(def.playbook_key, ctx) : genericChecks),
      jsonSchema: bundle(name),
      tier: (ctx.agent?.model_tier ?? "balanced") as ModelTier,
      maxOutputTokens: 12000,
      system: composeSystem(ctx.agent?.system_prompt, `Ти — ${s.seat} у маркетинговому відділі.`),
      user: [
        `Плейбук «${def.title}» (${def.playbook_key} v${reg.version}), крок ${s.key}.`,
        s.task.replaceAll("deliverable_count", `deliverable_count (= ${ctx.brief.deliverable_count})`),
        `Перевірки якості цього кроку: ${s.quality_checks.join("; ")}.`,
        dataBlock("brief", briefText(ctx.brief)),
        ...s.inputs.filter((i) => i.startsWith("artifact:")).flatMap((i) => {
          const a = latestArtifact<unknown>(ctx, i.slice(9));
          return a ? [dataBlock("artifact", `${i.slice(9)} v${a.version}:\n${JSON.stringify(a.content)}`)] : [];
        }),
        dataBlock("knowledge", knowledgeText(ctx.knowledge)),
        missing.length ? `У брифі не заповнені обов'язкові входи: ${missing.join(", ")}. Якщо без них результат неможливий — status=blocked із точними blocking_questions.` : "",
        prev ? dataBlock("artifact", `Попередня версія (${s.key} v${prev.version}):\n${JSON.stringify(prev.content)}`) : "",
        feedback.length ? dataBlock("feedback", feedback.join("\n---\n")) : "",
        feedback.length ? "Поверни ПОВНИЙ замінний результат (не патч). Виправ усі critical/major за їхніми ID; не погіршуй того, що не критикували." : "",
        "Посилання на знання: KnowledgeRef {record_id, version, pointer} — record_id і version з заголовка документа в <knowledge>, pointer зазвичай \"/body\".",
        "source_uses.output_pointer — JSON Pointer (RFC 6901) на поле твого результату, яке спирається на знання.",
        "Факти лише з <knowledge>. Решту — у claims_needing_source: disposition=excluded, якщо прибрано з матеріалу; placeholder означає status=blocked.",
      ].filter(Boolean).join("\n\n"),
      stub: stubFor(name, ctx),
    });
    const out = res.output as Obj;
    let next: StepResult["next_steps"];
    if (out.status === "blocked") next = toPackage("blocked", s.key);
    else {
      const i = order.indexOf(s.key);
      const nk = order[i + 1];
      next = nk
        ? [{ step_key: nk, agent_role: byKey.get(nk)!.seat, executor: byKey.get(nk)!.executor, input: { review_loop: loop, ...carryOwner(ctx.step.input) }, depends_on: [s.key] }]
        : [{ step_key: "review", agent_role: def.review.seat, executor: def.review.executor, input: { review_loop: loop, ...carryOwner(ctx.step.input) }, depends_on: [s.key] }];
    }
    const count = Array.isArray(out[reg.main_output]) ? (out[reg.main_output] as unknown[]).length : null;
    return {
      output: { ok: true, status: out.status ?? null },
      provider: res.provider,
      model: res.model,
      usage: res.usage,
      artifacts: [{ kind: s.key, title: `${STEP_TITLE[s.key] ?? s.key}: ${def.title}`, content: { ...out, _provider: res.provider } }],
      next_steps: next,
      run_status: null,
      activity: s.key === "prepare" ? "researching" : "drafting",
      message: out.status === "blocked"
        ? `${STEP_TITLE[s.key] ?? s.key}: заблоковано — бракує входів (${arr(out.blocking_questions).length} питань)`
        : feedback.length ? `${STEP_TITLE[s.key] ?? s.key}: доопрацьовано за зауваженнями`
          : `${STEP_TITLE[s.key] ?? s.key} готово${count !== null && s.key === "build" ? ` (${count})` : ""}`,
    };
  }

  async function review(ctx: StepContext, ai: AiProvider): Promise<StepResult> {
    const loop = Number(ctx.step.input.review_loop ?? 0);
    const target = latestArtifact<Obj>(ctx, reviewTarget);
    const targetMeta = ctx.artifacts.filter((a) => a.kind === reviewTarget).at(-1);
    const prevReview = loop > 0 ? latestArtifact<Obj>(ctx, "review") : null;
    const criteria = def.review.criteria.map((c) => `- ${c.key}: ${c.what} Пройдено, якщо ${c.pass_if}.`).join("\n");
    const res = await ai.generate({
      schemaName: "ReviewDecision",
      schema: contract<Obj>("ReviewDecision", reviewChecks(def)),
      jsonSchema: bundle("ReviewDecision"),
      tier: (ctx.agent?.model_tier ?? "balanced") as ModelTier,
      maxOutputTokens: 6000,
      system: composeSystem(ctx.agent?.system_prompt, "Ти — незалежний QA-рев'юер маркетингових матеріалів."),
      user: [
        `Незалежне рев'ю плейбука «${def.title}» (${loop === 0 ? "перше" : "повторне"} рев'ю). Оціни кожен критерій окремо (1–5), без середнього.`,
        criteria,
        "Шкала: 1 непридатно; 2 суттєві проблеми; 3 потрібне доопрацювання; 4 виконано з некритичними зауваженнями; 5 повністю виконано з доказами.",
        "pass — лише якщо evidence=5, решта ≥ 4 і немає відкритих critical/major. revise — якщо можна виправити без зміни брифу/знань. escalate — якщо без нових знань або рішення власника не виправити.",
        "Critical: неправдиве твердження, невірна ціна/покриття/CTA, немає обов'язкового джерела чи прав. Major: невиконаний обсяг, непридатна композиція/сценарій, некоректна метрика, неможливий продакшн. Minor: стилістика.",
        "Кожне issue: id, artifact_pointer (JSON Pointer), точний fragment ('<missing>' для відсутнього поля), criterion, severity, конкретний fix, resolution.",
        `reviewed_artifact_id = "${targetMeta?.id ?? reviewTarget}", reviewed_version = "${targetMeta?.version ?? ""}".`,
        prevReview
          ? `Попереднє рев'ю нижче. resolved_issue_ids — ID усунених зауважень; нерозв'язані повтори з тим самим ID. Нові зауваження — лише критичні пропущені раніше або внесені доопрацюванням.`
          : "Це перше рев'ю: resolved_issue_ids = [].",
        dataBlock("brief", briefText(ctx.brief)),
        ...order.flatMap((k) => {
          const a = latestArtifact<unknown>(ctx, k);
          return a ? [dataBlock("artifact", `${k} v${a.version}:\n${JSON.stringify(a.content)}`)] : [];
        }),
        prevReview ? dataBlock("artifact", `review v${prevReview.version}:\n${JSON.stringify(prevReview.content)}`) : "",
        dataBlock("knowledge", knowledgeText(ctx.knowledge)),
        ownerBlock(ctx.step.input),
      ].filter(Boolean).join("\n\n"),
      stub: () => ({
        decision: "pass",
        reviewed_artifact_id: String(targetMeta?.id ?? reviewTarget),
        reviewed_version: String(targetMeta?.version ?? "1"),
        scores: def.review.criteria.map((c) => ({ key: c.key, score: c.key === "evidence" ? 5 : 4, evidence_pointer: "/summary", reason: "[STUB] автоматична перевірка не виконувалась" })),
        issues: [],
        resolved_issue_ids: [],
        summary: "[STUB] Рев'ю не виконувалось: модель не підключена.",
      }),
    });
    const r = res.output as Obj;
    let next: StepResult["next_steps"];
    let message: string;
    if (r.decision === "pass" && gatesPass(r)) {
      next = toPackage("ready_for_approval", "review");
      message = "Рев'ю пройдено";
    } else if (r.decision === "escalate") {
      next = toPackage("escalated", "review");
      message = "Рев'юер ескалював власнику — без нових знань чи рішення не виправити";
    } else if (loop < MAX_REVISIONS) {
      const s = byKey.get(reviewTarget)!;
      next = [{ step_key: s.key, agent_role: s.seat, executor: s.executor, input: { reviewer_feedback: formatIssues(r), review_loop: loop + 1, ...carryOwner(ctx.step.input) }, depends_on: ["review"] }];
      message = `Рев'юер повернув на доопрацювання (зауважень: ${arr(r.issues).filter((i) => i.resolution === "open").length})`;
    } else {
      next = toPackage("escalated", "review");
      message = "Після доопрацювання критерії не виконані — ескалація власнику";
    }
    return {
      output: { ok: true, decision: r.decision },
      provider: res.provider,
      model: res.model,
      usage: res.usage,
      artifacts: [{ kind: "review", title: `Рев'ю ${loop + 1}: ${r.decision === "pass" ? "пройдено" : r.decision === "escalate" ? "ескалація" : "на доопрацювання"}`, content: { ...r, _provider: res.provider } }],
      next_steps: next,
      run_status: null,
      activity: "reviewing",
      message,
    };
  }

  function intake(ctx: StepContext): StepResult {
    const schema = briefDefs[def.playbook_key];
    const fields = (ctx.brief.fields ?? {}) as Obj;
    const missing = (schema?.required ?? []).filter((k) => !BASE_BRIEF.has(k) && (fields[k] === undefined || fields[k] === "" || (Array.isArray(fields[k]) && (fields[k] as unknown[]).length === 0)));
    const warnings = missing.map((k) => `Не заповнено: ${FIELD_LABEL[k] ?? k}`);
    if (ctx.knowledge.length === 0) warnings.push("У workspace немає затверджених знань — фактичні твердження будуть заблоковані.");
    if (ctx.brief.deliverable_count > reg.deliverable_count_max) warnings.push(`deliverable_count більший за ліміт ${reg.deliverable_count_max}`);
    const first = steps[0];
    return codeStep({
      output: { playbook: def.playbook_key, version: reg.version, library: LIBRARY_VERSION, plan: [...order, "review", "package"], missing_inputs: missing, warnings },
      next: [{ step_key: first.key, agent_role: first.seat, executor: first.executor, input: { review_loop: 0, missing_inputs: missing }, depends_on: ["intake"] }],
      activity: "planning",
      message: warnings.length ? `План готовий; зауважень: ${warnings.length}` : "План готовий",
    });
  }

  function revisionIntake(ctx: StepContext): StepResult {
    const feedback = String(ctx.step.input.owner_feedback ?? "");
    const s = byKey.get(reviewTarget)!;
    return codeStep({
      output: { owner_feedback: feedback, revision: ctx.step.input.revision ?? null },
      next: [{ step_key: s.key, agent_role: s.seat, executor: s.executor, input: { owner_feedback: feedback, review_loop: 0 }, depends_on: ["revision_intake"] }],
      activity: "planning",
      message: "Коментар власника — на доопрацювання",
    });
  }

  function pack(ctx: StepContext): StepResult {
    const outcome = String(ctx.step.input.outcome ?? "ready_for_approval") as "ready_for_approval" | "blocked" | "escalated";
    const build = latestArtifact<Obj>(ctx, reviewTarget);
    const prep = latestArtifact<Obj>(ctx, order[0]);
    const rev = latestArtifact<Obj>(ctx, "review");
    const source = build ?? prep;
    const sections = def.package.sections.flatMap((key) => {
      if (key === "review") return [];
      const fromBuild = build?.content[key];
      const value = fromBuild !== undefined ? fromBuild : prep?.content[key];
      if (value === undefined) return [];
      return [{ kind: key, label: SECTION_LABEL[key] ?? key, version: (fromBuild !== undefined ? build?.version : prep?.version) ?? 1, content: value }];
    });
    const claims = [
      ...arr(build?.content.claims_needing_source),
      ...(build ? [] : arr(prep?.content.claims_needing_source)),
    ].map((c) => `${String(c.text)}${c.disposition === "excluded" ? " (прибрано з матеріалу)" : ""}`);
    const blocking = arr((source?.content.blocking_questions as unknown) ?? []).map(String);
    const providers = new Set(ctx.artifacts.map((a) => (a.content as { _provider?: string })?._provider).filter(Boolean));
    const content = {
      schema_version: "Package.v1",
      playbook: def.playbook_key,
      playbook_version: reg.version,
      library_version: LIBRARY_VERSION,
      outcome,
      brief: { id: ctx.brief.id, title: ctx.brief.title, objective: ctx.brief.objective, channel: ctx.brief.channel, fields: ctx.brief.fields ?? {} },
      revision: ctx.run.revision,
      sections,
      blocking_questions: blocking,
      review: rev
        ? {
            verdict: String(rev.content.decision),
            summary: String(rev.content.summary),
            scores: arr(rev.content.scores).map((s) => ({ criterion: String(s.key), score: Number(s.score), comment: String(s.reason ?? "") })),
            open_issues: arr(rev.content.issues).filter((i) => i.resolution === "open").map((i) => ({
              target: String(i.artifact_pointer), severity: String(i.severity), criterion: String(i.criterion), problem: String(i.fragment), fix: String(i.fix),
            })),
          }
        : null,
      unsupported_claims: claims.slice(0, 60),
      sources_used: ctx.knowledge.map((k) => ({ title: k.title, url: k.source_url, id: k.id ?? null, version: k.version ?? null })),
      artifact_refs: ctx.artifacts.filter((a) => [...order, "review"].includes(a.kind)).map((a) => ({ kind: a.kind, version: a.version, id: a.id ?? null, hash: a.hash ?? null })),
      handoff: { to: def.handoff.to, note: `Передати: ${def.handoff.payload.filter((p) => p !== "approved_manifest").map((p) => SECTION_LABEL[p] ?? p).join(", ")}` },
      generated_by: [...providers],
    };
    const label = outcome === "ready_for_approval" ? "чекає на затвердження" : outcome === "blocked" ? "заблоковано: бракує входів" : "ескалація: потрібне рішення власника";
    return codeStep({
      output: { outcome, sections: sections.length },
      artifacts: [{ kind: "deliverable", title: `${def.title}: ${ctx.brief.title}`, content }],
      runStatus: "needs_approval",
      activity: "waiting_approval",
      message: `Пакет готовий — ${label}`,
    });
  }

  const roles = [...new Set(["orchestrator", ...steps.map((s) => s.seat), def.review.seat])];
  const catalog: CatalogEntry = {
    key: def.playbook_key,
    version: reg.version,
    title: def.title,
    label: def.title,
    description: def.use_when,
    priority: reg.priority,
    group: PLAYBOOK_GROUP[def.playbook_key] ?? "Інше",
    maxCount: reg.deliverable_count_max,
    fields: briefFields(def),
  };
  return {
    key: def.playbook_key,
    version: reg.version,
    title: def.title,
    roles,
    catalog,
    stepTitles: STEP_TITLE,
    schemas: Object.fromEntries([...steps.map((s) => defName(s)), "ReviewDecision"].map((n) => [n, contract(n)])),
    async execute(ctx, ai) {
      const k = ctx.step.step_key;
      if (k === "intake") return intake(ctx);
      if (k === "revision_intake") return revisionIntake(ctx);
      if (k === "review") return review(ctx, ai);
      if (k === "package") return pack(ctx);
      const s = byKey.get(k);
      if (!s) throw new Error(`${def.playbook_key}: unknown step ${k}`);
      return authorStep(ctx, ai, s);
    },
  };
}

function fixStub(key: string, v: Obj, ctx: StepContext): Obj {
  if (key === "paid_media_campaign" && v.structure) {
    const budget = arr((v.structure as Obj).budget);
    budget.forEach((b, i) => { b.share_percent = i === 0 ? 100 - (budget.length - 1) : 1; });
  }
  if (key === "reels_concepts") {
    const want = Number((ctx.brief.fields ?? {}).duration_seconds ?? 15);
    for (const s of arr(v.scripts)) {
      s.duration_seconds = want;
      const shots = arr(s.shots);
      shots.forEach((sh, i) => { sh.order = i + 1; sh.start_seconds = (want / shots.length) * i; sh.end_seconds = (want / shots.length) * (i + 1); });
      const cb = s.capture_brief as Obj | undefined;
      if (cb) arr(cb.shots).forEach((sh, i) => { const src = shots[i]; if (src) Object.assign(sh, { order: src.order, start_seconds: src.start_seconds, end_seconds: src.end_seconds }); });
    }
  }
  if (key === "creative_ideation" && Array.isArray(v.ranked_candidates)) {
    const ranked = arr(v.ranked_candidates);
    ranked.forEach((c, i) => { c.selected = i < ctx.brief.deliverable_count; });
    v.selected_ids = ranked.filter((c) => c.selected).map((c) => String((c.concept as Obj | undefined)?.id));
  }
  return v;
}

function formatIssues(r: Obj): string {
  return [
    String(r.summary ?? ""),
    ...arr(r.issues).filter((i) => i.resolution === "open").map((i) => `${String(i.id)} [${String(i.severity)}] ${String(i.criterion)} @ ${String(i.artifact_pointer)}: «${String(i.fragment)}» → ${String(i.fix)}`),
  ].join("\n");
}

function briefFields(def: LibDef): BriefFieldSpec[] {
  const schema = briefDefs[def.playbook_key];
  const hints = new Map(def.brief_fields.map((f) => [f.key, f.hint]));
  return Object.entries(schema.properties)
    .filter(([k]) => !BASE_BRIEF.has(k))
    .map(([k, s]) => {
      const required = schema.required.includes(k);
      const base = { key: k, label: FIELD_LABEL[k] ?? k, required, hint: hints.get(k) };
      const items = s.items as Record<string, unknown> | undefined;
      if (Array.isArray(s.enum)) {
        return { ...base, type: "select" as const, options: (s.enum as string[]).map((v) => ({ value: v, label: ENUM_LABEL[v] ?? v })) };
      }
      if (k.endsWith("_knowledge_ids")) return { ...base, type: "knowledge_multi" as const };
      if (k.endsWith("_knowledge_id")) return { ...base, type: "knowledge" as const };
      if (s.type === "array") return { ...base, type: "list" as const, maxLength: Number(items?.maxLength ?? 1000) };
      if (s.type === "integer" || s.type === "number") return { ...base, type: "number" as const, min: s.minimum as number | undefined, max: s.maximum as number | undefined };
      if (s.format === "date") return { ...base, type: "date" as const };
      if (s.format === "date-time") return { ...base, type: "datetime" as const };
      const max = Number(s.maxLength ?? 1000);
      return { ...base, type: max > 300 ? ("textarea" as const) : ("text" as const), maxLength: max };
    });
}

export const LIBRARY_PLAYBOOKS: Playbook[] = defs.map(libraryPlaybook);
