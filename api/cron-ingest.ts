import { handleSchedule } from '@vercel/schedules';
import { getDb } from '../server/db/client.js';
import { runIngestion } from '../server/ingest/pipeline.js';
import { publishDueReports } from '../server/research.js';

// Private function: only Vercel's scheduler can invoke it (see vercel.json).
export const POST = handleSchedule(async (metadata) => {
  const db = await getDb();
  const results = await runIngestion(db, { trigger: 'schedule' });
  const reports = await publishDueReports(db);
  console.log(JSON.stringify({ event: 'ingest.schedule', executionId: metadata.executionId, results, reports }));
});
