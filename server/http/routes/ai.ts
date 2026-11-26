import { z } from 'zod';
import { ask } from '../../ai/assistant.js';
import { configuredProvider, takeAiQuota } from '../../ai/index.js';
import type { LlmProvider } from '../../ai/provider.js';
import { sameOrigin } from '../../auth.js';
import { createRateLimiter } from '../security.js';
import { HttpError, body, type Route } from '../router.js';

const askBody = z.object({ question: z.string().trim().min(5).max(500), lang: z.enum(['en', 'az']), student: z.boolean().optional() }).strict();

export function aiRoutes(provider: () => LlmProvider | null = configuredProvider): Route[] {
  const limit = createRateLimiter(6, 60_000);
  return [
    { method: 'GET', path: 'ai/status', handler: async () => { const p = provider(); return { enabled: !!p, model: p?.model ?? null }; } },
    {
      method: 'POST', path: 'ai/ask', handler: async (c) => {
        // Each call can cost money: same-origin only, per-client rate limit and a daily cap.
        if (!sameOrigin(c.request)) throw new HttpError(403, 'bad_origin');
        if (!limit(c.ip).ok) throw new HttpError(429, 'rate_limited');
        const input = await body(c.request, askBody, 3000);
        const db = await c.db();
        let model = provider();
        const capped = !!model && !(await takeAiQuota(db));
        if (capped) model = null;
        const answer = await ask(db, input, model);
        return capped ? { ...answer, notice: 'daily_limit' } : answer;
      },
    },
  ];
}
