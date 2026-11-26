import { z } from 'zod';
import * as admin from '../../admin.js';
import { sameOrigin, sessionUser } from '../../auth.js';
import { publishReport, NoData } from '../../research.js';
import type { runIngestion, RunOptions } from '../../ingest/pipeline.js';
import { REPORT_TYPES } from '../../../shared/report.js';
import { createRateLimiter, isAdmin } from '../security.js';
import { HttpError, body, query, type Ctx, type Route } from '../router.js';
import type { Db } from '../../db/client.js';

const refreshBody = z.object({ sources: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(40).optional(), force: z.boolean().optional() }).strict();
const reviewBody = z.object({ action: z.enum(['approve', 'reject', 'correct']), rate: z.number().positive().max(100).optional(), note: z.string().trim().min(3).max(500) }).strict();
const page = z.coerce.number().int().min(1).max(10_000).default(1);

export function adminRoutes(ingest: (db: Db, o: RunOptions) => ReturnType<typeof runIngestion>): Route[] {
  const limit = createRateLimiter(120, 60_000);
  const failures = createRateLimiter(10, 60_000);

  /** Either the shared secret (scripts) or a signed-in user with the admin role. */
  async function requireAdmin(c: Ctx): Promise<string> {
    if (!limit(c.ip).ok) throw new HttpError(429, 'rate_limited');
    const header = c.request.headers.get('authorization');
    if (header) {
      if (isAdmin(header)) return 'admin-secret';
    } else {
      const user = await sessionUser(await c.db(), c.request);
      if (user) {
        if (user.role !== 'admin') throw new HttpError(403, 'forbidden');
        if (c.request.method !== 'GET' && !sameOrigin(c.request)) throw new HttpError(403, 'bad_origin');
        return user.email;
      }
    }
    if (!failures(c.ip).ok) throw new HttpError(429, 'rate_limited');
    throw new HttpError(401, 'unauthorized');
  }

  const guarded = (method: Route['method'], path: string, handler: (c: Ctx, actor: string) => Promise<unknown>): Route => ({
    method, path: `admin/${path}`, handler: async (c) => handler(c, await requireAdmin(c)),
  });

  return [
    guarded('POST', 'refresh', async (c) => {
      const input = await body(c.request, refreshBody, 4000);
      return { results: await ingest(await c.db(), { trigger: 'manual', keys: input.sources, force: input.force }) };
    }),
    guarded('GET', 'overview', async (c) => ({ sources: await admin.overview(await c.db()) })),
    guarded('GET', 'raw/:source', async (c) => ({ records: await admin.rawRecords(await c.db(), c.params.source!, query(c.url, z.object({ page })).page) })),
    guarded('GET', 'rejected', async (c) => ({ records: await admin.rejectedRecords(await c.db(), query(c.url, z.object({ page })).page) })),
    guarded('GET', 'observations', async (c) => {
      const filter = query(c.url, z.object({ page, status: z.enum(['auto_validated', 'pending_review', 'approved', 'corrected', 'rejected']).optional(), bank: z.string().regex(/^[a-z0-9_]{1,40}$/).optional() }));
      return { observations: await admin.observations(await c.db(), filter) };
    }),
    guarded('POST', 'observations/:id/review', async (c, actor) => {
      const observation = z.coerce.number().int().positive().parse(c.params.id);
      const input = await body(c.request, reviewBody);
      try {
        return await admin.review(await c.db(), actor, observation, input);
      } catch (e) {
        if (e instanceof admin.NotFound) throw new HttpError(404, 'not_found');
        if (e instanceof admin.Conflict) throw new HttpError(409, 'conflict');
        throw e;
      }
    }),
    guarded('GET', 'audit', async (c) => ({ entries: await admin.auditLog(await c.db(), query(c.url, z.object({ page })).page) })),
    guarded('POST', 'reports', async (c) => {
      const { type } = await body(c.request, z.object({ type: z.enum(REPORT_TYPES) }).strict());
      try {
        return await publishReport(await c.db(), type);
      } catch (e) {
        if (e instanceof NoData) throw new HttpError(409, 'no_data');
        throw e;
      }
    }),
  ];
}
