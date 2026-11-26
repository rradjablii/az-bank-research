import pg from 'pg';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  driver: 'postgres' | 'pglite';
}

export class DatabaseNotConfigured extends Error {
  constructor() {
    super('DATABASE_URL is not configured');
    this.name = 'DatabaseNotConfigured';
  }
}

function fromPool(pool: pg.Pool): Db {
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query(sql, params)).rows as T[];
    },
  });
  return {
    driver: 'postgres',
    ...wrap(pool),
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createPglite(dataDir?: string): Promise<Db> {
  // Variable specifier keeps the dev-only WASM database out of serverless bundles.
  const specifier = '@electric-sql/pglite';
  const { PGlite } = (await import(specifier)) as typeof import('@electric-sql/pglite');
  if (dataDir) (await import('node:fs')).mkdirSync(dataDir, { recursive: true });
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query(sql, params)).rows as T[];
    },
  });
  return {
    driver: 'pglite',
    ...wrap(lite),
    async exec(sql) {
      await lite.exec(sql);
    },
    tx: <T>(fn: (q: Queryable) => Promise<T>) => lite.transaction((t) => fn(wrap(t))) as Promise<T>,
    close: () => lite.close(),
  };
}

export async function createPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('pg pool error', e.message));
  if (process.env.VERCEL) {
    const { attachDatabasePool } = await import('@vercel/functions');
    attachDatabasePool(pool);
  }
  return fromPool(pool);
}

let shared: Promise<Db> | null = null;

/** Process-wide database. PGlite is used only outside Vercel when DATABASE_URL is empty. */
export function getDb(): Promise<Db> {
  if (!shared) {
    shared = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) return createPostgres(url);
      if (process.env.VERCEL) throw new DatabaseNotConfigured();
      const db = await createPglite(process.env.PGLITE_DIR ?? '.data/pglite');
      const { migrate } = await import('./migrate.js');
      await migrate(db);
      return db;
    })();
    shared.catch(() => (shared = null));
  }
  return shared;
}
