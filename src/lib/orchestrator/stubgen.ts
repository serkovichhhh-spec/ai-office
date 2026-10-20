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
  prefixItems?: JS[];
  uniqueItems?: boolean;
  contains?: JS;
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
  pattern?: string;
};

// Deliberately bounded subset: identifiers, dates, UUIDs, groups/alternatives and
// character classes with quantifiers. Unsupported regexes fail loudly, never emit invalid stubs.
function patternValue(pattern: string, budget: number): string {
  let pos = 0;
  const sequence = (): string => {
    const branches: string[] = [];
    let value = "";
    while (pos < pattern.length && pattern[pos] !== ")") {
      let atom = pattern[pos++];
      if (atom === "|") { branches.push(value); value = ""; continue; }
      if (atom === "^" || atom === "$") continue;
      if (atom === "(") {
        if (pattern.slice(pos, pos + 2) === "?:") pos += 2;
        else if (pattern[pos] === "?") throw new Error("stubgen: unsupported regex group");
        atom = sequence();
        if (pattern[pos++] !== ")") throw new Error("stubgen: unclosed regex group");
      } else if (atom === "[") {
        const end = pattern.indexOf("]", pos);
        if (end < 0) throw new Error("stubgen: unclosed character class");
        const cls = pattern.slice(pos, end);
        const re = new RegExp(`^[${cls}]$`);
        atom = [..."aA01_-x:/ ."].find((c) => re.test(c)) ?? "";
        if (!atom) throw new Error("stubgen: unsupported character class");
        pos = end + 1;
      } else if (atom === "\\") {
        const escaped = pattern[pos++];
        atom = ({ d: "0", w: "a", s: " ", D: "a", W: "-", S: "a" } as Record<string, string>)[escaped] ?? escaped;
        if (!atom || /^[1-9]$/.test(escaped)) throw new Error("stubgen: unsupported regex escape");
      } else if (atom === ".") atom = "a";
      let count = 1;
      const q = pattern[pos];
      if (q === "+" || q === "*" || q === "?") {
        pos++;
        count = q === "?" ? Math.min(budget, 1) : Math.max(q === "+" ? 1 : 0, budget);
      } else if (q === "{") {
        const m = /^\{(\d+)(?:,(\d*)?)?\}/.exec(pattern.slice(pos));
        if (!m) throw new Error("stubgen: unsupported regex quantifier");
        pos += m[0].length;
        const min = Number(m[1]);
        const max = m[0].includes(",") ? (m[2] ? Number(m[2]) : 10000) : min;
        count = Math.min(max, Math.max(min, budget));
      }
      if (count > 10000 || value.length + atom.length * count > 10000) throw new Error("stubgen: regex expansion too large");
      value += atom.repeat(count);
    }
    branches.push(value);
    return branches[0];
  };
  const result = sequence();
  if (pos !== pattern.length) throw new Error("stubgen: unexpected regex group");
  return result;
}

const FORMATS: Record<string, string> = {
  uuid: "00000000-0000-4000-8000-000000000001",
  date: "2026-11-01",
  "date-time": "2026-11-01T10:00:00Z",
  uri: "https://example.test/stub",
};

function stringStub(schema: JS, label: string): string {
  const re = schema.pattern ? new RegExp(schema.pattern) : undefined;
  const fits = (v: string) => v.length >= (schema.minLength ?? 0) && v.length <= (schema.maxLength ?? Infinity) && (!re || re.test(v));
  const formatted = schema.format ? FORMATS[schema.format] : undefined;
  if (formatted) {
    if (fits(formatted)) return formatted;
    throw new Error(`stubgen: incompatible ${schema.format} string constraints`);
  }
  if (schema.pattern) {
    for (const v of Object.values(FORMATS)) if (fits(v)) return v;
    for (let budget = 0; budget <= Math.min(schema.maxLength ?? 512, 512); budget++) {
      const v = patternValue(schema.pattern, budget);
      if (fits(v)) return v;
    }
    throw new Error(`stubgen: cannot satisfy pattern ${schema.pattern}`);
  }
  let s = `[STUB] ${label}`;
  s = s.padEnd(schema.minLength ?? 0, ".");
  return schema.maxLength === undefined ? s : s.slice(0, schema.maxLength);
}

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
      // Conditions can change discriminator fields used by earlier rules; converge
      // before returning (e.g. sensitive topic -> owner input -> required questions).
      for (let pass = 0; pass <= (schema.allOf?.length ?? 0); pass++) for (const rule of schema.allOf ?? []) {
        if (!rule.if?.properties || !rule.then?.properties) continue;
        const matches = Object.entries(rule.if.properties).every(([k, c]) => {
          if (c.const !== undefined) return out[k] === c.const;
          if (c.enum) return c.enum.includes(out[k]);
          if (c.contains) return Array.isArray(out[k]) && (out[k] as unknown[]).some((v) =>
            c.contains!.enum ? c.contains!.enum.includes(v) : v === c.contains!.const);
          return true;
        });
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
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const item = schema.prefixItems?.[i] ?? schema.items ?? { type: "string" };
        let value = stubFromJsonSchema(item, `${label} ${i + 1}`, root, depth + 1);
        if (schema.uniqueItems && out.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
          const unused = item.enum?.find((v) => !out.some((old) => JSON.stringify(old) === JSON.stringify(v)));
          if (unused === undefined) throw new Error("stubgen: cannot satisfy uniqueItems");
          value = unused;
        }
        out.push(value);
      }
      return out;
    }
    case "string": {
      return stringStub(schema, label);
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
