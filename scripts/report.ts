import './env.js';
import { getDb } from '../server/db/client.js';
import { migrate } from '../server/db/migrate.js';
import { publishDueReports } from '../server/research.js';

const db = await getDb();
await migrate(db);
const published = await publishDueReports(db);
console.log(published.length ? `published: ${published.join(', ')}` : 'all reports for the current period already exist');
await db.close();
