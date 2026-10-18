import "server-only";
import { createSql, type Sql } from "./db-core";

export { asUser, type Sql, type Tx } from "./db-core";

let client: Sql | null = null;

/**
 * Connection as role `office_app` (no BYPASSRLS). DATABASE_URL is server-only and never
 * reaches the browser bundle.
 */
export function db(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    client = createSql(url);
  }
  return client;
}
