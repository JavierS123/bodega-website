import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Single shared Drizzle client.
 *
 * - `prepare: false` is REQUIRED for Supabase's Transaction pooler (port 6543),
 *   which does not support prepared statements.
 * - In dev, the client is cached on globalThis so HMR doesn't leak connections.
 * - The connection is created lazily on first use, so importing this module at
 *   build time (without DATABASE_URL) is safe.
 */
const globalForDb = globalThis as unknown as { __bodegaDb?: Database };

function createDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  const client = postgres(url, {
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 1 : 5, // serverless: 1 conn per lambda
  });
  return drizzle(client, { schema });
}

export function getDb(): Database {
  if (!globalForDb.__bodegaDb) {
    globalForDb.__bodegaDb = createDb();
  }
  return globalForDb.__bodegaDb;
}

/** Convenience proxy so callers can write `db.select()...` / `db.transaction(...)`. */
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
