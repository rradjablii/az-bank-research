import './env.js';
import { getDb } from '../server/db/client.js';
import { migrate } from '../server/db/migrate.js';

if (process.argv.includes('--if-configured') && !process.env.DATABASE_URL) {
  console.log('DATABASE_URL not set; skipping migrations.');
  process.exit(0);
}
const db = await getDb();
const applied = await migrate(db);
console.log(`[${db.driver}] ${applied.length ? `applied: ${applied.join(', ')}` : 'schema up to date'}`);
await db.close();
