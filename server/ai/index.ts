import type { Db } from '../db/client.js';
import { anthropicProvider } from './anthropic.js';
import type { LlmProvider } from './provider.js';

/** The configured provider, or null (evidence-only mode). Add providers here. */
export function configuredProvider(env: Record<string, string | undefined> = process.env): LlmProvider | null {
  const provider = env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'none');
  return provider === 'anthropic' ? anthropicProvider() : null;
}

/** Global daily cap on paid model calls, shared across instances. */
export async function takeAiQuota(db: Db, limit = Number(process.env.AI_DAILY_LIMIT || 200)): Promise<boolean> {
  const rows = await db.query(
    `INSERT INTO ai_usage (day, calls) VALUES (CURRENT_DATE, 1)
     ON CONFLICT (day) DO UPDATE SET calls = ai_usage.calls + 1 WHERE ai_usage.calls < $1 RETURNING calls`,
    [limit],
  );
  return limit > 0 && rows.length > 0;
}
