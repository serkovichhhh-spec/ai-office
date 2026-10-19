/** Test-only postgres.js facade over the actual embedded PostgreSQL engine.
 * Serial execution: it exercises SQL/RLS and runtime code, not connection concurrency.
 */
import { PGlite } from '@electric-sql/pglite';
import type { Sql } from '../src/lib/db-core';
export function embeddedSql(database: PGlite, role = 'postgres'): Sql {
  let transaction = false;
  const exec = async (query: string, values: unknown[] = []) => {
    if (!transaction) await database.exec(`set role ${role}`);
    const params = values.map(v => v && typeof v === 'object' && '__json' in v ? JSON.stringify((v as {__json:unknown}).__json) : v);
    const result = params.length ? await database.query(query, params) : (await database.exec(query)).at(-1);
    return result?.rows ?? [];
  };
  const tag = (parts: TemplateStringsArray, ...values: unknown[]) => exec(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
  const api = Object.assign(tag, {
    unsafe: exec,
    json: (v:unknown) => ({__json:v}),
    begin: async (fn:(sql:Sql)=>Promise<unknown>) => {
      await database.exec(`set role ${role}; begin`);
      transaction=true;
      try { const result=await fn(api as unknown as Sql); await database.exec('commit'); return result; }
      catch(e) { await database.exec('rollback'); throw e; }
      finally { transaction=false; }
    },
    end: async () => {},
  });
  return api as unknown as Sql;
}
