import { z } from 'zod';
import * as repo from '../../repo.js';
import { loadConfidence, loadIndexHistory, loadIndexInput } from '../../analytics.js';
import { getReport, listReports } from '../../research.js';
import { DATASETS, exportCsv } from '../../export.js';
import { reportPdf } from '../../pdf.js';
import { renderReport } from '../../../shared/report.js';
import { HttpError, query, type Route } from '../router.js';

const marketQuery = z
  .object({
    metric: z.enum(['deposit_rate', 'loan_rate']),
    basis: z.enum(['outstanding', 'new_business']),
    segment: z.enum(['total', 'legal_entities', 'individuals']).optional(),
    bucket: z.string().regex(/^[a-z0-9_]{1,10}$/).optional(),
    currencyGroup: z.enum(['AZN', 'FX']).optional(),
  })
  .strict();
const langQuery = z.object({ lang: z.enum(['en', 'az']).default('en') });

const file = (data: BodyInit, type: string, name: string) =>
  new Response(data, {
    headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=0, must-revalidate', 'cdn-cache-control': 'public, s-maxage=120' },
  });

const get = (path: string, handler: Route['handler']): Route => ({ method: 'GET', path, handler, cache: true });

export const publicRoutes: Route[] = [
  { method: 'GET', path: 'health', handler: async (c) => { const db = await c.db(); await db.query('SELECT 1'); return { ok: true, driver: db.driver }; } },
  get('meta', async (c) => {
    const db = await c.db();
    return { generatedAt: new Date().toISOString(), sources: await repo.loadSources(db), rates: await repo.loadSeriesInfo(db, 'cbar_rates'), inflation: await repo.loadSeriesInfo(db, 'cbar_cpi') };
  }),
  // Rejected values are never served as data.
  get('rates', async (c) => ({ rows: (await repo.loadRates(await c.db())).filter((r) => r.verification !== 'rejected') })),
  get('market', async (c) => {
    const filter = query(c.url, marketQuery);
    const db = await c.db();
    return { points: await repo.loadMarket(db, filter), source: await repo.loadSeriesInfo(db, 'cbar_rates') };
  }),
  get('inflation', async (c) => { const db = await c.db(); return { points: await repo.loadInflation(db), source: await repo.loadSeriesInfo(db, 'cbar_cpi') }; }),
  get('policy', async (c) => { const db = await c.db(); return { points: await repo.loadPolicy(db), source: await repo.loadSeriesInfo(db, 'cbar_cpi') }; }),
  get('snapshots', async (c) => ({ snapshots: await repo.loadSnapshots(await c.db()) })),
  get('logs', async (c) => ({ logs: await repo.loadLogs(await c.db()) })),
  get('terms', async (c) => ({ terms: await repo.loadTerms(await c.db()) })),
  get('banks', async (c) => ({ banks: await repo.loadBanks(await c.db()) })),
  get('banks/:slug', async (c) => {
    const db = await c.db();
    const bank = (await repo.loadBanks(db)).find((b) => b.slug === c.params.slug);
    if (!bank) throw new HttpError(404, 'not_found');
    return { bank, history: await repo.loadBankHistory(db, bank.slug), events: await repo.loadEvents(db, bank.slug, 50) };
  }),
  get('events', async (c) => ({ events: await repo.loadEvents(await c.db()) })),
  get('index', async (c) => {
    const db = await c.db();
    const input = await loadIndexInput(db);
    // Inputs are returned so the client can recompute scores and test other weights.
    return { terms: input.terms, history: input.history, inflation: input.inflation, rates: input.rates, scoreHistory: await loadIndexHistory(db) };
  }),
  get('confidence', async (c) => ({ sources: await loadConfidence(await c.db()) })),
  get('reports', async (c) => ({ reports: await listReports(await c.db()) })),
  get('reports/:slug', async (c) => {
    const report = await getReport(await c.db(), c.params.slug!);
    if (!report) throw new HttpError(404, 'not_found');
    return report;
  }),
  get('reports/:slug/pdf', async (c) => {
    const { lang } = query(c.url, langQuery);
    const report = await getReport(await c.db(), c.params.slug!);
    if (!report) throw new HttpError(404, 'not_found');
    return file((await reportPdf(renderReport(report.data, lang))) as BodyInit, 'application/pdf', `azfi-${report.slug}-${lang}.pdf`);
  }),
  get('export/:dataset', async (c) => {
    const dataset = z.enum(DATASETS).safeParse(c.params.dataset);
    if (!dataset.success) throw new HttpError(404, 'not_found');
    // BOM so spreadsheet software reads Azerbaijani text correctly.
    return file(`﻿${await exportCsv(await c.db(), dataset.data)}`, 'text/csv; charset=utf-8', `azfi-${dataset.data}-${new Date().toISOString().slice(0, 10)}.csv`);
  }),
];
