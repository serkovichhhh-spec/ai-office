/** Cross-platform local-only runner. All migrations run in a disposable database. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const root = join(import.meta.dirname, "../..");
const url = new URL(process.env.E2E_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("SQL tests require a local Postgres");
const database = `office_sql_${process.pid}`;
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
let created = false;
let sql: ReturnType<typeof postgres> | undefined;
try {
  const [{ server_version_num: version }] = await admin.unsafe("show server_version_num");
  if (Number(version) < 160000 || Number(version) >= 170000) throw new Error("SQL tests require PostgreSQL 16");
  console.log(`Local PostgreSQL ${version}`);
  await admin.unsafe(`create database ${database}`);
  created = true;
  url.pathname = `/${database}`;
  sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const files = ["tests/sql/00_supabase_shim.sql",
    ...readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => `supabase/migrations/${f}`),
    ...readdirSync(join(root, "tests/sql")).filter((f) => /^[1-4]\d_.*\.sql$/.test(f)).sort().map((f) => `tests/sql/${f}`),
    ...readdirSync(join(root, "tests/sql")).filter((f) => /^[5-9]\d_.*\.sql$/.test(f)).sort().map((f) => `tests/sql/${f}`)];
  for (const file of files) {
    // Only presentation directives used by the existing psql tests are stripped.
    const source = readFileSync(join(root, file), "utf8").replace(/^\\(?:set |o(?: |$)).*$/gm, "");
    if (/^\\/m.test(source)) throw new Error(`Unsupported psql directive in ${file}`);
    try {
      await sql.unsafe(source);
    } catch (e) {
      if (file.startsWith("tests/sql/") && !file.includes("00_")) {
        const failures = await sql`select name, detail from t.results where not ok order by id`.catch(() => []);
        if (failures.length) console.error(file, failures);
      }
      throw e;
    }
    if (file.startsWith("tests/sql/") && !file.includes("00_")) {
      const failures = await sql`select name, detail from t.results where not ok order by id`;
      const [counts] = await sql`select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results`;
      console.log(`${file}: ${counts.passed} passed, ${counts.failed} failed`);
      if (failures.length) { console.error(failures); process.exitCode = 1; }
    }
  }
} catch (e) {
  console.error("SQL tests failed:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await sql?.end();
  if (created) await admin.unsafe(`drop database ${database} with (force)`);
  await admin.end();
}
