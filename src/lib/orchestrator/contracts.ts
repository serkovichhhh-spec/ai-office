/**
 * Output contracts from the playbook library (Draft 2020-12, playbook-library/schemas.json).
 * Validation uses Ajv; the zod wrapper lets the existing providers, MCP and worker treat
 * them like any other schema. `bundle()` produces a self-contained JSON Schema with only
 * the $defs a contract needs, so prompts stay small.
 */
import Ajv2020 from "ajv/dist/2020.js";
import { z } from "zod";
import schemas from "./library/schemas.json";

type JS = Record<string, unknown>;
export const ROUND2_CONTRACTS = ["BriefDiagnosis", "WorkPlan", "KnowledgeCandidate", "FactReport", "ChallengeReport", "DecisionMemo", "BrainstormSession", "BrainstormTurn", "BrainstormDecision"] as const;
const DEFS = (schemas as { $defs: Record<string, JS> }).$defs;
const SCHEMA_ID = (schemas as { $id?: string }).$id ?? "https://ai-office.invalid/schemas.json";
const canonical = (name: string) => name.endsWith(".v1") && ROUND2_CONTRACTS.some((n) => `${n}.v1` === name) ? name.slice(0, -3) : name;

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(schemas as JS);

export function hasContract(def: string): boolean {
  return canonical(def) in DEFS;
}

/** Self-contained schema: {$ref, $defs: transitive closure}. */
export function bundle(def: string): JS {
  def = canonical(def);
  if (!DEFS[def]) throw new Error(`unknown contract ${def}`);
  const needed = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref" && typeof v === "string") {
          const name = v.replace(/^.*#\/\$defs\//, "");
          if (!needed.has(name)) {
            needed.add(name);
            visit(DEFS[name]);
          }
        } else visit(v);
      }
    }
  };
  needed.add(def);
  visit(DEFS[def]);
  const $defs = Object.fromEntries([...needed].sort().map((n) => [n, DEFS[n]]));
  return { type: "object", $ref: `#/$defs/${def}`, $defs };
}

export interface SemanticCheck {
  (value: Record<string, unknown>): string[];
}

/** zod schema whose validation is Ajv (structure) + optional semantic checks (counts, consistency). */
export function contract<T = Record<string, unknown>>(def: string, semantic?: SemanticCheck): z.ZodType<T> {
  def = canonical(def);
  const validate = ajv.getSchema(`${SCHEMA_ID}#/$defs/${def}`);
  if (!validate) throw new Error(`unknown contract ${def}`);
  return z.any().superRefine((v, ctx) => {
    if (!validate(v)) {
      for (const e of (validate.errors ?? []).slice(0, 15)) {
        const extra = e.params && "additionalProperty" in e.params ? ` (${String(e.params.additionalProperty)})`
          : e.params && "allowedValues" in e.params ? ` (${(e.params.allowedValues as unknown[]).join(", ")})` : "";
        ctx.addIssue({ code: "custom", message: `${e.instancePath || "/"} ${e.message ?? "invalid"}${extra}` });
      }
      return;
    }
    for (const msg of semantic?.(v as Record<string, unknown>) ?? []) ctx.addIssue({ code: "custom", message: msg });
  }) as unknown as z.ZodType<T>;
}
