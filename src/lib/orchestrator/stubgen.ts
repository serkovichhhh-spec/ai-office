/**
 * Builds the smallest valid value for a JSON Schema (as produced by z.toJSONSchema).
 * Used ONLY by the stub provider and tests, so declarative playbooks need no hand-written
 * templates. Strings are marked "[STUB]" so nobody mistakes them for AI work.
 */
type JS = {
  type?: string | string[];
  properties?: Record<string, JS>;
  required?: string[];
  items?: JS;
  minItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JS[];
};

export function stubFromJsonSchema(schema: JS, label = "значення"): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return stubFromJsonSchema(schema.anyOf[0], label);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const key of schema.required ?? Object.keys(schema.properties ?? {})) {
        const prop = schema.properties?.[key];
        if (prop) out[key] = stubFromJsonSchema(prop, key);
      }
      return out;
    }
    case "array": {
      const n = Math.max(schema.minItems ?? 0, 1);
      return Array.from({ length: n }, (_, i) => stubFromJsonSchema(schema.items ?? { type: "string" }, `${label} ${i + 1}`));
    }
    case "string": {
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
    default:
      return null;
  }
}
