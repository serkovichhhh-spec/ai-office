/** Runs the actual migrations and SQL acceptance files on an isolated WASM PostgreSQL.
 * No network/database credentials. Multi-session concurrency still needs native Postgres.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const db = new PGlite();
try {
  const migrations = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  const tests = (await readdir('tests/sql')).filter(f => /^\d+.*tests\.sql$/.test(f)).sort();
  let count = 0;
  for (const path of ['tests/sql/00_supabase_shim.sql', ...migrations.map(f => `supabase/migrations/${f}`), ...tests.map(f => `tests/sql/${f}`)]) {
    const sql = (await readFile(path, 'utf8')).replace(/^\\.*$/gm, '');
    try { await db.exec(sql); } catch (e) { console.error(`FAIL ${path}`);
      try { console.error((await db.query('select name,detail from t.results where not ok')).rows); } catch {}
      throw e; }
    if (path.startsWith('tests/sql/') && !path.includes('shim')) {
      const { rows } = await db.query<{total:number; failed:number}>('select count(*)::int total, count(*) filter (where not ok)::int failed from t.results');
      count += rows[0].total;
      if (rows[0].failed) throw new Error(`${path}: ${rows[0].failed} failed`);
      console.log(`PASS ${path}: ${rows[0].total}`);
    }
  }
  console.log(`SQL acceptance: ${count} passed (embedded PostgreSQL)`);
} catch (e) {
  // Do not print the driver's complete SQL/config, which can become very large.
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally { await db.close(); }
