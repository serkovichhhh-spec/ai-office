import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function createSql(url: string): Sql {
  return postgres(url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
    // Return DATE columns as 'YYYY-MM-DD' strings: React cannot render Date objects and
    // calendar dates should not shift with time zones.
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
    connection: { application_name: "ai-office" },
  });
}

/**
 * Runs `fn` as the given Supabase user: role `authenticated` + JWT claims, inside one transaction,
 * so every query is filtered by the same RLS policies Supabase would apply.
 */
export async function asUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("invalid user id");
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true),
                    set_config('role', 'authenticated', true)`;
    return fn(tx);
  }) as Promise<T>;
}
