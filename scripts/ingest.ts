import './env.js';
import { getDb } from '../server/db/client.js';
import { migrate } from '../server/db/migrate.js';
import { runIngestion } from '../server/ingest/pipeline.js';

// Usage: npm run ingest -- [--force] [source_key ...]
const args = process.argv.slice(2);
const db = await getDb();
await migrate(db);
const results = await runIngestion(db, { trigger: 'cli', force: args.includes('--force'), keys: args.filter((a) => !a.startsWith('-')) });
for (const r of results) {
  console.log(`${r.key.padEnd(18)} ${r.status.padEnd(8)} fetched=${r.fetched} new=${r.inserted} same=${r.unchanged} rejected=${r.rejected}${r.message ? `  ${r.message}` : ''}`);
}
await db.close();
if (results.some((r) => r.status === 'failed')) process.exitCode = 2;
