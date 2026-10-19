import { describe, expect, it } from "vitest";
import type { AiProvider, GenerateRequest } from "@/lib/ai/types";
import { PROFESSIONAL_PLAYBOOKS } from "@/lib/orchestrator/library";
import { blockedBriefStub, evidenceErrors, MarketingBriefSchema, marketingBriefErrors, type MarketingBrief } from "@/lib/orchestrator/marketing-brief";
import { composeSystem, knowledgeText } from "@/lib/orchestrator/prompting";
import { ROLE_CONTRACTS } from "@/lib/orchestrator/role-contracts";
import { executeStep, playbookFor } from "@/lib/orchestrator/registry";
import type { StepContext } from "@/lib/orchestrator/types";

const seats = { prepare: "creative_director", build: "print_designer", review: "reviewer" };
const knowledge = [{ id: "fact-1", version: "v1", title: "Продуктовий паспорт", kind: "fact", body: "Умови, географія, бренд та дані для тесту", source_url: "https://example.org/product", freshness_date: "2026-10-19" }];
const ref = { record_id: "fact-1", version: "v1", pointer: "/body" };
function readyBrief(roles = seats): MarketingBrief {
  const b = blockedBriefStub(roles);
  return { ...b, status: "ready", summary: "Бриф для локального залучення нових абонентів", business_goal: "Зібрати звернення мешканців доступних будинків",
    topics: b.topics.map((t) => ({ ...t, status: "verified", summary: "Умови та їхні обмеження викладено у продуктовому паспорті", refs: [ref], limitations: [] })),
    strategic_choice: { target_segment: "Мешканці багатоквартирних будинків у підтвердженій зоні", need_and_barrier: "Потрібне домашнє підключення; не знають умов переходу", value_proposition: "Підтверджена пропозиція із паспорта", reason_to_believe: "Описані в паспорті умови", main_message: "Підключення для мешканців визначеної зони", cta_and_customer_path: "Залишити заявку, отримати відповідь щодо адреси", rationale: "Локальна пропозиція відповідає зоні площини" },
    assignments: b.assignments.map((a) => ({ ...a, task: "Розробити матеріал згідно продуктового паспорта", deliverable: "Матеріал за контрактом поточного кроку", acceptance_criteria: ["Факти з джерел; повний обсяг; врахувати носій"] })),
    gaps: [], blocking_questions: [],
  };
}
function ctx(step: string, artifacts: StepContext["artifacts"] = [], input: Record<string, unknown> = {}): StepContext {
  return {
    step: { id: "s", run_id: "r", workspace_id: "w", step_key: step, agent_role: "print_designer", cycle: 1, attempt: 1, input },
    run: { id: "r", revision: 1, playbook_key: "outdoor_print_pack", playbook_version: 2, budget_usd: 1, cost_usd: 0 },
    brief: { id: "b", title: "Білборд", objective: "Нові підключення", audience: "Мешканці ЖК", channel: "OOH", deliverable_count: 1, deliverables: [], references: [], acceptance_criteria: ["Відповідність покриттю"], deadline: null, priority: "high", playbook_key: "outdoor_print_pack", fields: {} },
    workspace: { id: "w", name: "PAVUTYNA", slug: "pavutyna" }, agent: null, knowledge, artifacts,
  };
}
function stripProvider(v: unknown): Record<string, unknown> {
  const { _provider, ...obj } = v as Record<string, unknown>; void _provider; return obj;
}
function repairStubEvidence(v: unknown): void {
  if (Array.isArray(v)) { v.forEach(repairStubEvidence); return; }
  if (!v || typeof v !== "object") return;
  const obj = v as Record<string, unknown>;
  if ("record_id" in obj && "version" in obj && "pointer" in obj) Object.assign(obj, ref);
  if ("output_pointer" in obj) obj.output_pointer = "/summary";
  Object.values(obj).forEach(repairStubEvidence);
}

/** Session-like executor fixture. Tests routing/contracts, not model quality. */
function fixtureProvider(cmo: MarketingBrief, issuePath?: string): AiProvider {
  let reviews = 0;
  return { name: "session", async generate<T>(req: GenerateRequest<T>) {
    let output: unknown = req.schemaName === "MarketingBrief" ? cmo : req.stub();
    if (req.schemaName !== "MarketingBrief") repairStubEvidence(output);
    if (req.schemaName === "ReviewDecision" && issuePath && reviews++ === 0) {
      const o = output as Record<string, unknown>;
      o.decision = "revise";
      o.scores = (o.scores as Record<string, unknown>[]).map((s) => ({ ...s, score: s.key === "evidence" ? 3 : 4 }));
      o.issues = [{ id: "Q1", severity: "major", artifact_pointer: issuePath, fragment: "<missing>", criterion: "evidence", fix: "Підтвердити продуктовий контекст", resolution: "open" }];
    }
    output = req.schema.parse(output);
    return { output: output as T, model: "fixture", provider: "session", usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 } };
  } };
}

describe("professional workflow", () => {
  it("defines duties, skills, reporting and handoff for all 16 supported roles", () => {
    expect(Object.keys(ROLE_CONTRACTS)).toHaveLength(16);
    for (const [key, r] of Object.entries(ROLE_CONTRACTS)) {
      expect(r.skills.length).toBeGreaterThanOrEqual(5);
      expect(r.duties.length).toBeGreaterThan(150);
      expect(r.handoff).toBeTruthy();
      expect(r.reportsTo === "owner" || r.reportsTo in ROLE_CONTRACTS, key).toBe(true);
    }
    expect(composeSystem("Ти пишеш лише рілси", "Завдання: друкований носій", "copywriter")).toContain("Завдання: друкований носій");
    expect(knowledgeText(knowledge)).toContain("https://example.org/product");
  });

  it("blocks execution without a CMO brief before invoking an author", async () => {
    let calls = 0;
    const ai: AiProvider = { name: "session", generate: async () => { calls++; throw new Error("must not call"); } };
    const r = await playbookFor("outdoor_print_pack", 2).execute(ctx("build"), ai);
    expect(calls).toBe(0);
    expect(r.next_steps[0].input).toMatchObject({ outcome: "blocked" });
  });

  it("rejects duplicate topics, filler, stale refs, wrong owners and false-ready briefs", () => {
    const c = ctx("marketing_brief");
    expect(marketingBriefErrors(readyBrief(), c, seats)).toEqual([]);
    const b = readyBrief(); b.topics[0] = b.topics[1]; b.strategic_choice.target_segment = "ЦА";
    b.assignments[0].seat = "copywriter";
    b.gaps = [{ topic: "coverage", problem: "Немає адрес", kind: "context_not_delivered", owner: "orchestrator", next_action: "Завантажити географію", blocking: true }];
    const errors = marketingBriefErrors(b, c, seats).join(";");
    expect(errors).toContain("рівно один раз"); expect(errors).toContain("заглушка"); expect(errors).toContain("seat"); expect(errors).toContain("блокуючих");
    expect(evidenceErrors({ refs: [{ ...ref, version: "old" }] }, c).join()).toContain("застаріле");
    expect(evidenceErrors({ source_uses: [{ output_pointer: "/not-found", refs: [ref] }] }, c).join()).toContain("не існує");
    expect(evidenceErrors({ refs: [{ ...ref, pointer: "/not-found" }] }, c).join()).toContain("pointer");
  });

  it("stale context is blocked even when a previous CMO brief was ready", async () => {
    const b = readyBrief(); b.topics[0].refs = [{ ...ref, version: "old" }];
    const c = ctx("prepare", [{ kind: "marketing_brief", version: 1, content: { ...b, _provider: "session" } }]);
    const r = await playbookFor("outdoor_print_pack", 2).execute(c, fixtureProvider(b));
    expect(r.next_steps[0].input?.outcome).toBe("blocked");
  });

  it("owner revisions restart at CMO and persist the decision", async () => {
    const r = await playbookFor("outdoor_print_pack", 2).execute(ctx("revision_intake", [], { owner_feedback: "Спочатку дослідити конкурентів" }), fixtureProvider(readyBrief()));
    expect(r.next_steps[0]).toMatchObject({ step_key: "marketing_brief", agent_role: "orchestrator", executor: "chatgpt" });
    expect(r.artifacts[0].content).toMatchObject({ feedback: "Спочатку дослідити конкурентів" });
  });

  it("missing and disabled AI seats cannot silently execute using a fallback", async () => {
    await expect(executeStep(ctx("build"), fixtureProvider(readyBrief()))).rejects.toThrow("not configured");
    const c = ctx("marketing_brief"); c.step.agent_role = "orchestrator";
    c.agent = { role_key: "orchestrator", display_name: "CMO", model_tier: "strong", system_prompt: "", provenance: "test", enabled: false };
    await expect(executeStep(c, fixtureProvider(readyBrief()))).rejects.toThrow("disabled");
  });

  for (const pb of PROFESSIONAL_PLAYBOOKS) {
    it(`${pb.key}: real-contract fixture reaches all stages with context and independent review`, async () => {
      const prepSeat = pb.roles.find((r) => !["orchestrator", "reviewer"].includes(r))!;
      // Read the actual declared roles from the original library; no new graph is generated by AI.
      const cmoRoles: Record<string, { prepare: string; build: string; review: string }> = {
        smm_content_plan: { prepare: "smm", build: "smm", review: "reviewer" },
        social_content_pack: { prepare: "smm", build: "content_maker", review: "reviewer" },
        graphic_design_pack: { prepare: "creative_director", build: "graphic_designer", review: "reviewer" },
        campaign_art_direction: { prepare: "creative_director", build: "creative_director", review: "reviewer" },
        creative_ideation: { prepare: "creative", build: "creative", review: "reviewer" },
        paid_media_campaign: { prepare: "strategist", build: "ads_specialist", review: "reviewer" },
        reels_concepts: { prepare: "strategist", build: "scriptwriter", review: "reviewer" },
        outdoor_print_pack: seats,
        offer_launch: { prepare: "strategist", build: "orchestrator", review: "reviewer" },
        campaign_analysis: { prepare: "performance_analyst", build: "performance_analyst", review: "reviewer" },
        competitor_analysis: { prepare: "research_analyst", build: "research_analyst", review: "reviewer" },
        owned_media_copy: { prepare: "strategist", build: "copywriter", review: "reviewer" },
      };
      expect(prepSeat).toBeTruthy();
      const ai = fixtureProvider(readyBrief(cmoRoles[pb.key]));
      const artifacts: StepContext["artifacts"] = [];
      const trail: string[] = []; const prompts: string[] = []; const assigned: Record<string, string | undefined> = {};
      let queue = [{ step_key: "intake", input: {} as Record<string, unknown> }];
      for (let guard = 0; queue.length && guard < 15; guard++) {
        const s = queue.shift()!; trail.push(s.step_key);
        const c = ctx(s.step_key, artifacts, s.input); c.run.playbook_key = pb.key; c.run.playbook_version = pb.version;
        c.brief.playbook_key = pb.key;
        const r = await pb.execute(c, { name: "session", generate: async <T,>(req: GenerateRequest<T>) => { if (["Preparation", "ReviewDecision"].includes(req.schemaName)) prompts.push(req.user); return ai.generate(req); } });
        for (const a of r.artifacts) artifacts.push({ kind: a.kind, id: a.kind + "-id", version: artifacts.filter((x) => x.kind === a.kind).length + 1, content: a.content });
        for (const n of r.next_steps) assigned[n.step_key] = n.executor;
        queue = r.next_steps.map((n) => ({ step_key: n.step_key, input: n.input ?? {} }));
      }
      expect(trail).toEqual(["intake", "marketing_brief", "prepare", "build", "review", "package"]);
      expect(prompts.every((p) => p.includes("marketing_brief v1"))).toBe(true);
      expect(assigned.build).toBe("chatgpt"); expect(assigned.review).toBe("claude_session");
      const pkg = artifacts.find((a) => a.kind === "deliverable")!.content as Record<string, unknown>;
      expect(pkg.outcome).toBe("ready_for_approval"); expect(pkg.file_quality_verified).toBe(false);
    });
  }

  it.each(["/marketing_brief/topics", "/prepare/constraints"])("routes upstream defect %s to its owner and propagates feedback", async (path) => {
    const pb = playbookFor("outdoor_print_pack", 2);
    const artifacts: StepContext["artifacts"] = [
      { kind: "marketing_brief", version: 1, content: { ...readyBrief(), _provider: "session" } },
      { kind: "prepare", version: 1, content: {} }, { kind: "build", id: "build-id", version: 1, content: {} },
    ];
    const r = await pb.execute(ctx("review", artifacts), fixtureProvider(readyBrief(), path));
    expect(r.next_steps[0].step_key).toBe(path.includes("marketing_brief") ? "marketing_brief" : "prepare");
    expect(r.next_steps[0].input?.reviewer_feedback).toContain("Q1");
    const next = await pb.execute(ctx(r.next_steps[0].step_key, artifacts, r.next_steps[0].input), fixtureProvider(readyBrief()));
    expect(next.next_steps[0].input?.reviewer_feedback).toContain("Q1");
  });

  it("does not allow a package to claim ready without evidence and review", async () => {
    const r = await playbookFor("outdoor_print_pack", 2).execute(ctx("package", [], { outcome: "ready_for_approval" }), fixtureProvider(readyBrief()));
    expect((r.artifacts[0].content as Record<string, unknown>).outcome).toBe("blocked");
    expect(MarketingBriefSchema.safeParse(stripProvider({ ...readyBrief(), _provider: "session" })).success).toBe(true);
  });
});
