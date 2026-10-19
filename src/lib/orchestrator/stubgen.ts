/**
 * Builds the smallest valid value for a JSON Schema (zod's z.toJSONSchema output or the
 * library's Draft 2020-12 bundles with $defs/$ref and allOf if/then).
 * Used ONLY by the stub provider and tests. Strings are marked "[STUB]".
 */
type JS = {
  type?: string | string[];
  properties?: Record<string, JS>;
  required?: string[];
  items?: JS;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JS[];
  oneOf?: JS[];
  allOf?: (JS & { if?: JS; then?: JS })[];
  $ref?: string;
  $defs?: Record<string, JS>;
  format?: string;
};

export function stubFromJsonSchema(schema: JS, label = "значення", root: JS = schema, depth = 0): unknown {
  if (depth > 40) return null;
  if (schema.$ref) {
    const name = schema.$ref.replace(/^.*#\/\$defs\//, "");
    const target = root.$defs?.[name];
    if (!target) throw new Error(`stubgen: unresolved ${schema.$ref}`);
    return stubFromJsonSchema(target, label, root, depth + 1);
  }
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const alt = schema.anyOf ?? schema.oneOf;
  if (alt?.length) {
    // Prefer a non-null branch so stubs exercise the real shape.
    const pick = alt.find((s) => s.type !== "null") ?? alt[0];
    return stubFromJsonSchema(pick, label, root, depth + 1);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") ?? schema.type[0] : schema.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const keys = schema.required ?? Object.keys(schema.properties ?? {});
      // Fields that other fields' conditions depend on (status) are generated first.
      for (const key of keys) {
        const prop = schema.properties?.[key];
        if (prop) out[key] = stubFromJsonSchema(prop, key, root, depth + 1);
      }
      for (const rule of schema.allOf ?? []) {
        if (!rule.if?.properties || !rule.then?.properties) continue;
        const matches = Object.entries(rule.if.properties).every(([k, c]) => c.const === undefined || out[k] === c.const);
        if (!matches) continue;
        for (const [k, override] of Object.entries(rule.then.properties)) {
          const base = schema.properties?.[k];
          if (base && k in out) out[k] = stubFromJsonSchema({ ...base, ...override }, k, root, depth + 1);
        }
      }
      return out;
    }
    case "array": {
      const max = schema.maxItems ?? Infinity;
      const n = Math.min(Math.max(schema.minItems ?? 0, max === 0 ? 0 : 1), max);
      return Array.from({ length: n }, (_, i) => stubFromJsonSchema(schema.items ?? { type: "string" }, `${label} ${i + 1}`, root, depth + 1));
    }
    case "string": {
      if (schema.format === "date") return "2026-11-01";
      if (schema.format === "date-time") return "2026-11-01T10:00:00+02:00";
      let s = `[STUB] ${label}`;
      if (schema.minLength && s.length < schema.minLength) s = s.padEnd(schema.minLength, ".");
      if (schema.maxLength && s.length > schema.maxLength) s = s.slice(0, schema.maxLength);
      return s;
    }
    case "integer":
    case "number": {
      const min = schema.minimum ?? 0;
      return schema.maximum !== undefined ? Math.min(Math.max(min, 1), schema.maximum) : Math.max(min, 1);
    }
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return null;
  }
}
