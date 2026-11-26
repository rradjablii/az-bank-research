import { z } from 'zod';
import { DatabaseNotConfigured, getDb, type Db } from '../db/client.js';
import { runIngestion, type RunOptions } from '../ingest/pipeline.js';
import type { LlmProvider } from '../ai/provider.js';
import { configuredProvider } from '../ai/index.js';
import { createRateLimiter } from './security.js';
import { HttpError, json, matchRoute, type Route } from './router.js';
import { publicRoutes } from './routes/public.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { aiRoutes } from './routes/ai.js';

/**
 * Browsers always revalidate, so a visitor never sees an old copy first. Only the
 * CDN holds shared responses briefly; every payload carries its verification times.
 */
export const CACHE_HEADERS = {
  'cache-control': 'public, max-age=0, must-revalidate',
  'cdn-cache-control': 'public, s-maxage=120, stale-while-revalidate=300',
};

export interface AppDeps {
  db: () => Promise<Db>;
  ingest: (db: Db, o: RunOptions) => ReturnType<typeof runIngestion>;
  ai?: () => LlmProvider | null;
}

export function createApp(deps: AppDeps = { db: getDb, ingest: runIngestion }) {
  const readLimit = createRateLimiter(300, 60_000);
  const routes: Route[] = [...publicRoutes, ...accountRoutes(), ...adminRoutes(deps.ingest), ...aiRoutes(deps.ai ?? configuredProvider)];

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // On Vercel a rewrite passes the sub-path as ?__path=; locally it is in the pathname.
    const path = (url.searchParams.get('__path') ?? url.pathname.replace(/^\/api\/?/, '')).replace(/\/+$/, '');
    const ip = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

    try {
      const limited = readLimit(ip);
      if (!limited.ok) return json({ error: 'rate_limited' }, 429, { 'retry-after': String(limited.retryAfter) });
      const match = matchRoute(routes, request.method, path);
      if (!match) return json({ error: 'not_found' }, 404);
      if (match === 'method_not_allowed') return json({ error: 'method_not_allowed' }, 405);
      const result = await match.route.handler({ request, url, db: deps.db, ip, params: match.params });
      if (result instanceof Response) return result;
      return json(result, 200, match.route.cache ? CACHE_HEADERS : {});
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status);
      if (e instanceof z.ZodError) return json({ error: 'invalid_request', details: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
      if (e instanceof SyntaxError) return json({ error: 'invalid_json' }, 400);
      if (e instanceof DatabaseNotConfigured) return json({ error: 'database_not_configured' }, 503);
      console.error('api.error', path, e);
      return json({ error: 'internal_error' }, 500);
    }
  };
}
