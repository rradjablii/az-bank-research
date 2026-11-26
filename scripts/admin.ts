import './env.js';
import { getDb } from '../server/db/client.js';
import { migrate } from '../server/db/migrate.js';

// Usage: npm run admin:grant -- user@example.com   (or admin:revoke)
const [action, email] = process.argv.slice(2);
if ((action !== 'grant' && action !== 'revoke') || !email) {
  console.error('Usage: tsx scripts/admin.ts grant|revoke <email>');
  process.exit(1);
}
const db = await getDb();
await migrate(db);
const rows = await db.query('UPDATE users SET role=$2 WHERE email=$1 RETURNING id', [email.trim().toLowerCase(), action === 'grant' ? 'admin' : 'user']);
console.log(rows.length ? `${action}ed admin role` : 'No account with that e-mail. Register in the app first.');
await db.close();
