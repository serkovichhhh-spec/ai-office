// Validates the Round 2 contract drafts with the same Ajv 2020 setup used in production
// (src/lib/orchestrator/contracts.ts). Usage: node validate.mjs <path-to-ai-office>
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(repo, "package.json"));
const Ajv2020 = require("ajv/dist/2020.js").default ?? require("ajv/dist/2020.js");

const lib = JSON.parse(readFileSync(join(repo, "src/lib/orchestrator/library/schemas.json"), "utf8"));
const add = JSON.parse(readFileSync(join(here, "schemas.additions.json"), "utf8"));
const examples = JSON.parse(readFileSync(join(here, "examples.json"), "utf8"));

const clash = Object.keys(add.$defs).filter((k) => k in lib.$defs);
if (clash.length) { console.error("NAME CLASH with existing $defs:", clash); process.exit(1); }

const merged = { ...lib, $defs: { ...lib.$defs, ...add.$defs } };
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(merged);

let ok = 0, bad = 0;
const report = [];
for (const [name, ex] of Object.entries(examples)) {
  const v = ajv.getSchema(`${merged.$id}#/$defs/${name}`);
  if (!v) { console.error("missing def", name); process.exit(1); }
  const validOk = v(ex.valid);
  report.push({ name, case: "valid", expected: true, got: validOk, errors: validOk ? [] : v.errors.map((e) => `${e.instancePath} ${e.message}`) });
  validOk ? ok++ : bad++;
  for (const inv of ex.invalid) {
    const data = { ...ex.valid, ...inv.patch };
    const r = v(data);
    report.push({ name, case: `invalid: ${inv.why}`, expected: false, got: r, errors: r ? [] : v.errors.slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message}`) });
    !r ? ok++ : bad++;
  }
}
for (const r of report) console.log(`${r.expected === r.got ? "PASS" : "FAIL"}  ${r.name.padEnd(20)} ${r.case}${r.errors.length ? "  → " + r.errors[0] : ""}`);
console.log(`\n${ok} passed, ${bad} failed`);
writeFileSync(join(here, "validation-report.json"), JSON.stringify(report, null, 2));
process.exit(bad ? 1 : 0);
