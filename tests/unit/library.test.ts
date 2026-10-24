import { describe, expect, it } from "vitest";
import { StubProvider } from "@/lib/ai/stub";
import type { AiProvider, GenerateRequest } from "@/lib/ai/types";
import { LIBRARY_PLAYBOOKS } from "@/lib/orchestrator/library";
import { PLAYBOOK_CATALOG, playbookFor } from "@/lib/orchestrator/registry";
import type { StepContext, StepResult } from "@/lib/orchestrator/types";

const KNOW = [{ id: "11111111-2222-4333-8444-555555555555", version: "abc123def456", title: "Брендбук", kind: "brand", body: "Червоний #FF0000", source_url: null, freshness_date: null }];

function ctx(key: string, version: number, step_key: string, input: Record<string, unknown>, artifacts: StepContext["artifacts"], fields: Record<string, unknown> = {}): StepContext {
  return {
    step: { id: "s", run_id: "r", workspace_id: "w", step_key, agent_role: "x", cycle: 1, attempt: 1, input },
    run: { id: "r", revision: 1, playbook_key: key, playbook_version: version, budget_usd: 1, cost_usd: 0 },
    brief: {
      id: "b", title: "Тест", objective: "Мета", audience: "Сім'ї", channel: "Instagram", deliverable_count: 1, deliverables: [], references: [],
      acceptance_criteria: ["Критерій"], deadline: null, priority: "high", playbook_key: key, fields,
    },
    workspace: { id: "w", slug: "pavutyna", name: "PAVUTYNA" },
    agent: null,
    knowledge: KNOW,
    artifacts,
  };
}

async function drive(key: string, version: number, ai: AiProvider, opts: { start?: string; input?: Record<string, unknown>; artifacts?: StepContext["artifacts"]; fields?: Record<string, unknown> } = {}) {
  const pb = playbookFor(key, version);
  const artifacts = opts.artifacts ?? [];
  const trail: string[] = [];
  const executors: Record<string, string | undefined> = {};
  let queue: { key: string; input: Record<string, unknown> }[] = [{ key: opts.start ?? "intake", input: opts.input ?? {} }];
  let last: StepResult | null = null;
  const prompts: Record<string, string> = {};
  const spy: AiProvider = { name: ai.name, generate: async <T,>(req: GenerateRequest<T>) => { prompts[req.schemaName] = req.user; return ai.generate(req); } };
  for (let guard = 0; queue.length && guard < 20; guard++) {
    const { key: k, input } = queue.shift()!;
    trail.push(k);
    last = await pb.execute(ctx(key, version, k, input, artifacts, opts.fields), spy);
    for (const a of last.artifacts) artifacts.push({ kind: a.kind, version: artifacts.filter((x) => x.kind === a.kind).length + 1, content: a.content, id: `${a.kind}-id` });
    for (const n of last.next_steps) executors[n.step_key] = n.executor;
    queue = last.next_steps.map((n) => ({ key: n.step_key, input: n.input ?? {} }));
  }
  return { trail, last: last!, artifacts, prompts, executors };
}

/** Answers ReviewDecision with a scripted decision; everything else via stub. */
class Reviewer implements AiProvider {
  readonly name = "stub" as const;
  constructor(private decisions: ("pass" | "revise" | "escalate")[]) {}
  async generate<T>(req: GenerateRequest<T>) {
    if (req.schemaName !== "ReviewDecision") return new StubProvider().generate(req);
    const d = this.decisions.shift() ?? "pass";
    const stub = req.stub() as Record<string, unknown>;
    const out = d === "pass" ? stub : {
      ...stub, decision: d,
      scores: (stub.scores as { key: string }[]).map((s) => ({ ...s, score: s.key === "evidence" ? 3 : 4 })),
      issues: [{ id: "I1", severity: "critical", artifact_pointer: "/summary", fragment: "Ціна 199 грн", criterion: "evidence", fix: "Прибрати ціну", resolution: "open" }],
    };
    return { output: req.schema.parse(out), usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, model: "stub", provider: "stub" as const };
  }
}

describe("playbook library v1", () => {
  it("registers 13 playbooks; catalogue offers library reels v2 and outdoor_print_pack, not the old ones", () => {
    expect(LIBRARY_PLAYBOOKS).toHaveLength(13);
    const keys = PLAYBOOK_CATALOG.map((p) => `${p.key}@${p.version}`);
    expect(keys).toContain("reels_concepts@2");
    expect(keys).not.toContain("reels_concepts@1");
    expect(keys).not.toContain("ooh_concepts@1");
    expect(PLAYBOOK_CATALOG.filter((p) => p.priority === "P1").map((p) => p.key).sort()).toEqual(
      ["cmo_brief_diagnosis", "graphic_design_pack", "offer_launch", "outdoor_print_pack", "paid_media_campaign", "reels_concepts"]);
    expect(() => playbookFor("reels_concepts", 1)).not.toThrow(); // old runs keep working
  });

  for (const pb of LIBRARY_PLAYBOOKS) {
    it(`${pb.key}: stub run goes intake → prepare → build → review → package (ready)`, async () => {
      const fields = pb.key === "reels_concepts" ? { duration_seconds: 15 } : {};
      const { trail, last, artifacts } = await drive(pb.key, pb.version, new StubProvider(), { fields });
      const authors = pb.key === "cmo_brief_diagnosis" ? ["diagnosis", "plan"] : ["prepare", "build"];
      expect(trail).toEqual(["intake", ...authors, "review", "package"]);
      expect(last.run_status).toBe("needs_approval");
      const pkg = artifacts.find((a) => a.kind === "deliverable")!.content as { outcome: string; sections: unknown[] };
      expect(pkg.outcome).toBe("ready_for_approval");
      expect(pkg.sections.length).toBeGreaterThan(0);
    });
  }

  it("author and reviewer are different executors in every playbook", async () => {
    for (const pb of LIBRARY_PLAYBOOKS) {
      const fields = pb.key === "reels_concepts" ? { duration_seconds: 15 } : {};
      const { executors } = await drive(pb.key, pb.version, new StubProvider(), { fields });
      expect(executors.review, pb.key).toBeDefined();
      expect(executors.review, pb.key).not.toBe(pb.key === "cmo_brief_diagnosis" ? executors.plan : executors.build);
    }
  });

  it("revise once → review₂ → escalated when still failing", async () => {
    const { trail, artifacts, prompts } = await drive("outdoor_print_pack", 1, new Reviewer(["revise", "revise"]));
    expect(trail).toEqual(["intake", "prepare", "build", "review", "build", "review", "package"]);
    expect((artifacts.find((a) => a.kind === "deliverable")!.content as { outcome: string }).outcome).toBe("escalated");
    expect(prompts.PrintOutput).toContain("I1 [critical]");
    expect(prompts.ReviewDecision).toContain("повторне");
  });

  it("escalate goes straight to the owner", async () => {
    const { trail, artifacts } = await drive("paid_media_campaign", 1, new Reviewer(["escalate"]));
    expect(trail).toEqual(["intake", "prepare", "build", "review", "package"]);
    expect((artifacts.find((a) => a.kind === "deliverable")!.content as { outcome: string }).outcome).toBe("escalated");
  });

  it("CMO diagnosis: needs_owner_input stops before the plan and sends ≤3 owner questions", async () => {
    const asking: AiProvider = {
      name: "stub",
      async generate<T>(req: GenerateRequest<T>) {
        if (req.schemaName === "BriefDiagnosis") {
          const base = (await new StubProvider().generate(req)).output as Record<string, unknown>;
          const out = { ...base, status: "needs_owner_input", questions_to_owner: [
            { id: "Q1", question: "Яка підтверджена автономність мережі на Позняках?", why_it_matters: "Від цього залежить головне повідомлення білборда." }] };
          return { output: req.schema.parse(out), usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, model: "stub", provider: "stub" as const };
        }
        return new StubProvider().generate(req);
      },
    };
    const { trail, artifacts, prompts } = await drive("cmo_brief_diagnosis", 1, asking);
    expect(trail).toEqual(["intake", "diagnosis", "package"]);
    const pkg = artifacts.find((a) => a.kind === "deliverable")!.content as { outcome: string; blocking_questions: string[] };
    expect(pkg.outcome).toBe("blocked");
    expect(pkg.blocking_questions[0]).toContain("автономність");
    expect(prompts.BriefDiagnosis).toContain("brief_id");
    expect(prompts.BriefDiagnosis).toContain("owned_media_copy@1");
  });

  it("CMO diagnosis rejects a plan that routes to a non-existent playbook", async () => {
    const bad: AiProvider = {
      name: "stub",
      async generate<T>(req: GenerateRequest<T>) {
        const res = await new StubProvider().generate(req);
        if (req.schemaName !== "WorkPlan") return res;
        const out = { ...(res.output as Record<string, unknown>) };
        (out.workstreams as Record<string, unknown>[])[0].playbook = "magic_billboard@9";
        const parsed = req.schema.safeParse(out);
        expect(parsed.success).toBe(false);
        return res;
      },
    };
    await drive("cmo_brief_diagnosis", 1, bad);
  });

  it("blocked preparation skips to a blocked package with questions", async () => {
    const blocking: AiProvider = {
      name: "stub",
      async generate<T>(req: GenerateRequest<T>) {
        if (req.schemaName === "Preparation") {
          const out = { ...(req.stub() as object), status: "blocked", work_items: [], blocking_questions: ["Немає специфікації друкарні"] };
          return { output: req.schema.parse(out), usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, model: "stub", provider: "stub" as const };
        }
        return new StubProvider().generate(req);
      },
    };
    const { trail, artifacts } = await drive("outdoor_print_pack", 1, blocking);
    expect(trail).toEqual(["intake", "prepare", "package"]);
    const pkg = artifacts.find((a) => a.kind === "deliverable")!.content as { outcome: string; blocking_questions: string[] };
    expect(pkg.outcome).toBe("blocked");
    expect(pkg.blocking_questions).toEqual(["Немає специфікації друкарні"]);
  });

  it("semantic checks reject inconsistent results", async () => {
    const pb = playbookFor("paid_media_campaign", 1);
    const c = ctx("paid_media_campaign", 1, "build", {}, []);
    let captured: GenerateRequest<unknown> | null = null;
    await pb.execute(c, { name: "stub", generate: async (req) => { captured = req as GenerateRequest<unknown>; return new StubProvider().generate(req); } }).catch(() => {});
    const req = captured! as GenerateRequest<Record<string, unknown>>;
    const good = req.stub();
    expect(req.schema.safeParse(good).success).toBe(true);
    const twoAds = { ...good, ads: [...(good.ads as unknown[]), ...(good.ads as unknown[])] };
    const r = req.schema.safeParse(twoAds);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("рівно 1");
  });

  it("review pass that contradicts thresholds is rejected", async () => {
    const pb = playbookFor("owned_media_copy", 1);
    let captured: GenerateRequest<Record<string, unknown>> | null = null;
    await pb.execute(ctx("owned_media_copy", 1, "review", {}, []), { name: "stub", generate: async (req) => { captured = req as never; return new StubProvider().generate(req); } });
    const ok = captured!.stub();
    const bad = { ...ok, scores: (ok.scores as { key: string }[]).map((s) => ({ ...s, score: 3 })) };
    expect(captured!.schema.safeParse(bad).success).toBe(false);
  });

  it("knowledge ids and versions reach the prompt for citations", async () => {
    const { prompts } = await drive("graphic_design_pack", 1, new StubProvider());
    expect(prompts.Preparation).toContain("record_id=11111111-2222-4333-8444-555555555555 version=abc123def456");
  });
});
