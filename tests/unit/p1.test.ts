import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { bundle } from "@/lib/orchestrator/contracts";
import { stubFromJsonSchema } from "@/lib/orchestrator/stubgen";
import { attachCmoSkill } from "@/lib/orchestrator/skills";
import { OUTPUT_SCHEMAS } from "@/lib/orchestrator/registry";

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
ajv.addFormat("date", (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s);
ajv.addFormat("date-time", (s: string) => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)));
ajv.addFormat("uri", (s: string) => { try { return Boolean(new URL(s).protocol); } catch { return false; } });

describe("P1 contracts and stubs", () => {
  for (const name of ["BriefDiagnosis", "WorkPlan", "KnowledgeCandidate", "FactReport", "ChallengeReport", "DecisionMemo", "BrainstormSession", "BrainstormTurn", "BrainstormDecision"]) {
    it(`generates a valid ${name} stub`, () => {
      const schema = bundle(name);
      const validate = ajv.compile(schema);
      expect(validate(stubFromJsonSchema(schema)), JSON.stringify(validate.errors)).toBe(true);
      for (const key of [name, `${name}.v1`]) {
        expect(OUTPUT_SCHEMAS[key]?.safeParse({}).success).toBe(false);
        expect(OUTPUT_SCHEMAS[key]?.safeParse(stubFromJsonSchema(schema)).success).toBe(true);
      }
    });
  }
  it("honours patterns, length limits and supported formats", () => {
    for (const pattern of ["^[a-z0-9_-]+$", "^id_[0-9]{4}$", "^[a-z][a-z0-9_]{2,40}@[0-9]{1,3}$", "^\\d{4}-\\d{2}-\\d{2}$"]) {
      const schema = { type: "string", pattern, minLength: 5, maxLength: 50 };
      expect(ajv.compile(schema)(stubFromJsonSchema(schema))).toBe(true);
    }
    for (const format of ["uuid", "date", "date-time", "uri"]) {
      const schema = { type: "string", format };
      expect(ajv.compile(schema)(stubFromJsonSchema(schema))).toBe(true);
    }
    expect(stubFromJsonSchema({ type: "string", maxLength: 0 })).toBe("");
    expect(() => stubFromJsonSchema({ type: "string", pattern: "(?=unsupported)" })).toThrow();
  });
});

describe("CMO attachment", () => {
  const env = { seat: "strategist", step: "diagnosis", data_class: "internal" };
  it("delivers full versioned files with a reproducible content hash", async () => {
    const result = await attachCmoSkill(env, "pavutyna");
    const pack = result.skills![0];
    expect(pack.version).toBe("1.0.0");
    expect(Object.keys(pack.files)).toEqual(["SKILL.md", "checklist.md", "rubric.json", "examples/good.md", "examples/bad.md"]);
    expect(pack.files).not.toHaveProperty("evaluation/golden-briefs.json");
    expect(pack.sha256).toBe(createHash("sha256").update(JSON.stringify(Object.entries(pack.files).sort(([a], [b]) => a.localeCompare(b)))).digest("hex"));
    expect(result.context?.file).toBe("context/pavutyna.md");
    expect(result.context?.version).toMatch(/^[a-f0-9]{64}$/);
  });
  it("preserves v1 envelopes and isolates workspace context", async () => {
    for (const changed of [{ seat: "copywriter" }, { step: "strategy" }]) {
      const legacy = { ...env, ...changed };
      expect(await attachCmoSkill(legacy, "pavutyna")).toBe(legacy);
    }
    expect(await attachCmoSkill(env, "other")).toBe(env);
    const publicEnv = { ...env, data_class: "public" };
    expect(await attachCmoSkill(publicEnv, "pavutyna")).toBe(publicEnv);
  });
  it("preserves the envelope data class in context", async () => {
    expect((await attachCmoSkill({ ...env, data_class: "confidential" }, "pavutyna")).context?.data_class).toBe("confidential");
  });
});
