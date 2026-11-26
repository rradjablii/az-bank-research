import { createHash } from 'node:crypto';
import type { Db } from './db/client.js';
import * as repo from './repo.js';
import { loadIndexHistory, loadIndexInput } from './analytics.js';
import { recordEvent, deliverNotifications } from './events.js';
import { computeIndex } from '../shared/index-score.js';
import { REPORT_TYPES, reportPeriod, reportTitle, type ReportData, type ReportType } from '../shared/report.js';

export class NoData extends Error {}

export async function collectReportData(db: Db, type: ReportType): Promise<ReportData> {
  const market = [
    ...(await repo.loadMarket(db, { metric: 'deposit_rate', basis: 'new_business', segment: 'total', bucket: 'all' })),
    ...(await repo.loadMarket(db, { metric: 'loan_rate', basis: 'new_business', segment: 'total', bucket: 'all' })),
  ];
  const inflation = await repo.loadInflation(db);
  const latestRate = market.map((m) => m.periodDate).sort().at(-1);
  const latestCpi = inflation.filter((i) => i.yoy !== null).at(-1)?.month;
  if (!latestRate || !latestCpi) throw new NoData('Official series have not been collected yet');
  // Use the latest month covered by both official rates and inflation.
  const { referenceMonth } = await import('../shared/finance.js');
  const latest = [referenceMonth(latestRate), latestCpi].sort()[0]!;
  const { period, start, end } = reportPeriod(type, latest);
  const offers = (await repo.loadRates(db)).filter((r) => r.freshness === 'fresh' && r.category === 'deposit');
  const history = await loadIndexHistory(db);
  const sources = (await repo.loadSources(db)).filter((s) => s.recordCount > 0);
  return {
    type, period, periodStart: start, periodEnd: end,
    offersAsOf: offers.map((o) => o.lastVerifiedAt).sort().at(-1) ?? null,
    generatedAt: new Date().toISOString(),
    offers, market, inflation: inflation.filter((i) => i.month <= end),
    policy: (await repo.loadPolicy(db)).filter((x) => x.month <= end),
    index: type === 'competitiveness' ? computeIndex(await loadIndexInput(db)) : [],
    indexHistoryDays: new Set(history.map((h) => h.date)).size,
    sources: sources.map((s) => ({ name: s.name, url: s.url, lastVerifiedAt: s.lastVerifiedAt })),
  };
}

/** Hash of the observations only, so re-running on unchanged data does not publish a duplicate. */
function dataHash(d: ReportData) {
  const essence = {
    period: d.period,
    offers: d.offers.map((o) => [o.bankSlug, o.productKey, o.currency, o.termMin, o.payout, o.variant, o.rate]),
    market: d.market.map((m) => [m.metric, m.currencyGroup, m.periodDate, m.rate]),
    inflation: d.inflation.map((i) => [i.month, i.yoy]),
    policy: d.policy.map((x) => [x.month, x.refinancing]),
    index: d.index.map((i) => [i.bankSlug, i.score]),
  };
  return createHash('sha256').update(JSON.stringify(essence)).digest('hex');
}

export async function publishReport(db: Db, type: ReportType) {
  const data = await collectReportData(db, type);
  const hash = dataHash(data);
  const [existing] = await db.query<{ slug: string }>('SELECT slug FROM reports WHERE type=$1 AND period=$2 AND data_hash=$3', [type, data.period, hash]);
  if (existing) return { slug: existing.slug, created: false };
  const slug = `${type.replace(/_/g, '-')}-${data.period.toLowerCase()}-${hash.slice(0, 8)}`;
  await db.query('INSERT INTO reports (slug, type, period, data, data_hash) VALUES ($1,$2,$3,$4::jsonb,$5)', [slug, type, data.period, JSON.stringify(data), hash]);
  await recordEvent(db, {
    kind: 'report', bankSlug: null, currency: null,
    details: { slug, type, period: data.period, title: reportTitle(type, 'en') },
    // One alert per type and period, however many revisions follow.
    dedupeKey: `report|${type}|${data.period}`,
  });
  await deliverNotifications(db);
  return { slug, created: true };
}

/** Publishes each report once per period; used by the scheduled job. */
export async function publishDueReports(db: Db) {
  const published: string[] = [];
  for (const type of REPORT_TYPES) {
    try {
      const data = await collectReportData(db, type);
      const [have] = await db.query('SELECT 1 FROM reports WHERE type=$1 AND period=$2 LIMIT 1', [type, data.period]);
      if (!have) published.push((await publishReport(db, type)).slug);
    } catch (e) {
      if (!(e instanceof NoData)) throw e;
    }
  }
  return published;
}

export async function listReports(db: Db) {
  const rows = await db.query<Record<string, any>>('SELECT slug, type, period, published_at FROM reports ORDER BY published_at DESC, id DESC LIMIT 200');
  return rows.map((r) => ({ slug: r.slug as string, type: r.type as ReportType, period: r.period as string, publishedAt: new Date(r.published_at).toISOString() }));
}

export async function getReport(db: Db, slug: string) {
  const [r] = await db.query<Record<string, any>>('SELECT slug, data, published_at FROM reports WHERE slug=$1', [slug]);
  return r ? { slug: r.slug as string, publishedAt: new Date(r.published_at).toISOString(), data: r.data as ReportData } : null;
}
