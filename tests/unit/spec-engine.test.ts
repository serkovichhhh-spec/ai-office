import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StubProvider } from "@/lib/ai/stub";
import type { AiProvider, GenerateRequest } from "@/lib/ai/types";
import { oohConcepts, oohConceptsSpec } from "@/lib/orchestrator/playbooks/ooh-concepts";
import { OUTPUT_SCHEMAS, PLAYBOOK_CATALOG } from "@/lib/orchestrator/registry";
import { playbookFromSpec, validateSpec, type PlaybookSpec } from "@/lib/orchestrator/spec";
import { stubFromJsonSchema } from "@/lib/orchestrator/stubgen";
import type { StepContext, StepResult } from "@/lib/orchestrator/types";

function ctx(step_key: string, input: Record<string, unknown>, artifacts: StepContext["artifacts"]): StepContext {
  return {
    step: { id: "s", run_id: "r", workspace_id: "w", step_key, agent_role: "x", cycle: 1, attempt: 1, input },
    run: { id: "r", revision: 1, playbook_key: "ooh_concepts", budget_usd: 1, cost_usd: 0 },
    brief: {
      id: "b", title: "Білборди", objective: "Впізнаваність у новому районі", audience: "Мешканці ЖК", channel: "OOH",
      deliverable_count: 3, deliverables: [], references: [], acceptance_criteria: [], deadline: null, priority: "high",
      playbook_key: "ooh_concepts", fields: { formats: "6×3 — 8 шт.", tone: "calm" },
    },
    workspace: { id: "w", slug: "pavutyna", name: "PAVUTYNA" },
    agent: null,
    knowledge: [{ title: "Брендбук", kind: "brand", body: "Червоний #FF0000", source_url: null, freshness_date: null }],
    artifacts,
  };
}

/** Drives a playbook like the worker would: follow next_steps, collect artifacts, stop at approval. */
async function drive(ai: AiProvider, start = "intake", startInput: Record<string, unknown> = {}, artifacts: StepContext["artifacts"] = []) {
  const trail: string[] = [];
  let queue: { key: string; input: Record<string, unknown> }[] = [{ key: start, input: startInput }];
  let last: StepResult | null = null;
  const prompts: Record<string, string> = {};
  const spy: AiProvider = {
    name: ai.name,
    generate: async <T,>(req: GenerateRequest<T>) => {
      prompts[req.schemaName] = req.user;
      return ai.generate(req);
    },
  };
  for (let guard = 0; queue.length && guard < 20; guard++) {
    const { key, input } = queue.shift()!;
    trail.push(key);
    last = await oohConcepts.execute(ctx(key, input, artifacts), spy);
    for (const a of last.artifacts) {
      const v = artifacts.filter((x) => x.kind === a.kind).length + 1;
      artifacts.push({ kind: a.kind, version: v, content: a.content });
    }
    queue = last.next_steps.map((n) => ({ key: n.step_key, input: n.input ?? {} }));
  }
  return { trail, last: last!, artifacts, prompts };
}

class Reviewer implements AiProvider {
  readonly name = "stub" as const;
  constructor(private verdicts: ("pass" | "revise")[]) {}
  async generate<T>(req: GenerateRequest<T>) {
    if (req.schemaName === "review_decision") {
      const verdict = this.verdicts.shift() ?? "pass";
      const out = {
        verdict, summary: "Перевірено", scores: [{ criterion: "readability", score: verdict === "pass" ? 4 : 2, comment: "" }],
        issues: verdict === "revise" ? [{ target: "concepts", severity: "high", criterion: "readability", fragment: "ДОВГИЙ ЗАГОЛОВОК", problem: "14 слів", fix: "до 7 слів" }] : [],
        unsupported_claims: ["Ціна 199 грн"],
      };
      return { output: req.schema.parse(out), usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, model: "stub", provider: "stub" as const };
    }
    return new StubProvider().generate(req);
  }
}

describe("declarative playbook engine", () => {
  it("runs intake → strategy → concepts → design_specs → review → package", async () => {
    const { trail, last, artifacts, prompts } = await drive(new StubProvider());
    expect(trail).toEqual(["intake", "strategy", "concepts", "design_specs", "review", "package"]);
    expect(last.run_status).toBe("needs_approval");
    const pkg = artifacts.find((a) => a.kind === "deliverable")!.content as { schema_version: string; sections: { kind: string }[]; handoff: { to: string } };
    expect(pkg.schema_version).toBe("Package.v1");
    expect(pkg.sections.map((s) => s.kind)).toEqual(["strategy", "concepts", "design_specs"]);
    expect(pkg.handoff.to).toBe("print_designer");
    // Brief fields and earlier artifacts reach the model as delimited data.
    expect(prompts.ooh_strategy).toContain("6×3 — 8 шт.");
    expect(prompts.ooh_design_specs).toContain("<artifact>\nconcepts v1");
    expect(prompts.ooh_concepts).toContain("рівно 3");
  });

  it("sends back once, then escalates to the owner", async () => {
    const { trail, last, prompts } = await drive(new Reviewer(["revise", "revise"]));
    expect(trail).toEqual(["intake", "strategy", "concepts", "design_specs", "review", "concepts", "design_specs", "review", "package"]);
    expect(last.message).toContain("чекає на затвердження");
    expect(prompts.ooh_concepts).toContain("<feedback>");
    expect(prompts.ooh_concepts).toContain("до 7 слів");
  });

  it("collects unsupported claims from review into the package", async () => {
    const { artifacts } = await drive(new Reviewer(["pass"]));
    const pkg = artifacts.find((a) => a.kind === "deliverable")!.content as { unsupported_claims: string[] };
    expect(pkg.unsupported_claims).toContain("Ціна 199 грн");
  });

  it("owner revision restarts from sendBackTo with the owner's comment", async () => {
    const first = await drive(new StubProvider());
    const again = await drive(new StubProvider(), "revision_intake", { owner_feedback: "Прибрати провокаційний тон" }, first.artifacts);
    expect(again.trail).toEqual(["revision_intake", "concepts", "design_specs", "review", "package"]);
    expect(again.prompts.ooh_concepts).toContain("Прибрати провокаційний тон");
    expect(again.artifacts.filter((a) => a.kind === "concepts").length).toBe(2);
  });

  it("rejects invalid specs", () => {
    const bad = (patch: Partial<PlaybookSpec>) => () => validateSpec({ ...oohConceptsSpec, ...patch });
    expect(bad({ review: { ...oohConceptsSpec.review, sendBackTo: "nope" } })).toThrow(/sendBackTo/);
    expect(bad({ steps: [{ ...oohConceptsSpec.steps[0], key: "review" }] })).toThrow(/reserved/);
    expect(bad({ steps: [oohConceptsSpec.steps[1]] })).toThrow(/not an earlier step/);
    expect(() => playbookFromSpec({ ...oohConceptsSpec, steps: [...oohConceptsSpec.steps, oohConceptsSpec.steps[0]] })).toThrow(/duplicate/);
  });

  it("stub generator satisfies every registered output schema", () => {
    for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
      const js = z.toJSONSchema(schema, { target: "draft-7" });
      expect(() => schema.parse(stubFromJsonSchema(js as never, name)), name).not.toThrow();
    }
  });

  it("catalogue lists both playbooks with serialisable fields", () => {
    expect(PLAYBOOK_CATALOG.map((p) => p.key)).toEqual(["reels_concepts", "ooh_concepts"]);
    expect(JSON.parse(JSON.stringify(PLAYBOOK_CATALOG))[1].fields[0].key).toBe("formats");
  });
});
