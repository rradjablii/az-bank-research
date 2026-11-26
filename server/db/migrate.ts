import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './client.js';

/** Applies db/migrations/*.sql once each, in filename order. */
export async function migrate(db: Db, dir = join(process.cwd(), 'db/migrations')): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    // exec() sends the whole script in one simple query, which Postgres runs atomically.
    await db.exec(`${sql}\nINSERT INTO schema_migrations (name) VALUES ('${file.replace(/[^\w.-]/g, '')}');`);
    applied.push(file);
  }
  return applied;
}
