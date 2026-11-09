import fs from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

/**
 * Database bootstrap.
 *
 *  postgres://…        → node-postgres connection pool (production, Docker)
 *  pglite://<folder>   → embedded Postgres persisted to disk (zero-setup local dev)
 *  memory://           → embedded in-memory Postgres (tests)
 *
 * Both drivers speak real PostgreSQL, so SQL, enums, JSONB and transactions behave identically.
 */

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

interface Handle {
  db: Db;
  close: () => Promise<void>;
  driver: 'pg' | 'pglite';
}

let current: Handle | null = null;

export async function initDb(url: string): Promise<Handle> {
  if (current) return current;
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    current = {
      db: drizzle(pool, { schema }) as unknown as Db,
      close: () => pool.end(),
      driver: 'pg',
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const dir = url.replace(/^pglite:\/\//, '');
    const inMemory = url.startsWith('memory://');
    if (!inMemory) fs.mkdirSync(path.resolve(dir), { recursive: true });
    const client = inMemory ? new PGlite() : new PGlite(path.resolve(dir));
    await client.waitReady;
    current = {
      db: drizzle(client, { schema }) as unknown as Db,
      close: () => client.close(),
      driver: 'pglite',
    };
  }
  return current;
}

export async function migrateDb(): Promise<void> {
  const h = requireHandle();
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'drizzle');
  if (h.driver === 'pg') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(h.db as never, { migrationsFolder });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(h.db as never, { migrationsFolder });
  }
}

export async function closeDb(): Promise<void> {
  if (!current) return;
  const h = current;
  current = null;
  await h.close();
}

function requireHandle(): Handle {
  if (!current) throw new Error('Database not initialised — call initDb() first');
  return current;
}

/** Stable reference to the active database, usable at module scope. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = requireHandle().db as unknown as Record<PropertyKey, unknown>;
    const value = target[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
});

export { schema };
