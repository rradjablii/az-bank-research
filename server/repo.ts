import type { Queryable } from './db/client.js';
import type {
  ChangeEvent, Freshness, IngestionLog, InflationPoint, MarketPoint, PolicyPoint, ProductTermsRow, RateRow, SeriesSourceInfo, Snapshot, SourceInfo,
} from '../shared/types.js';
import { referenceMonth } from '../shared/finance.js';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const HOUR = 3_600_000;

export function freshness(
  s: { accessStatus: string; lastSuccessAt: string | null; lastStatus: string | null; staleAfterHours: number },
  now = Date.now(),
): Freshness {
  if (s.accessStatus !== 'active' || !s.lastSuccessAt) return 'unavailable';
  if (s.lastStatus === 'failed') return 'refresh_failed';
  return now - Date.parse(s.lastSuccessAt) > s.staleAfterHours * HOUR ? 'stale' : 'fresh';
}

export async function loadRates(db: Queryable): Promise<RateRow[]> {
  const rows = await db.query<Record<string, any>>(`
    SELECT o.id, b.slug, b.name AS bank, p.product_key, p.name AS product, p.category, p.product_type,
           o.currency, o.term_min_months, o.term_max_months, o.payout_frequency, o.variant, o.rate, o.rate_max,
           o.rate_qualifier, o.apr_min, o.apr_max, o.amount_min, o.amount_max, o.conditions, o.source_name, o.source_url,
           o.observed_date::text AS observed_date, o.collected_at, o.last_verified_at, o.verification_status,
           s.access_status, s.last_success_at, s.last_status, s.stale_after_hours
    FROM interest_rate_observations o
    JOIN bank_products p ON p.id = o.product_id
    JOIN banks b ON b.id = p.bank_id
    JOIN data_sources s ON s.id = o.source_id
    WHERE o.superseded_at IS NULL
    ORDER BY b.name, p.name, o.currency, o.term_min_months NULLS FIRST, o.payout_frequency`);
  return rows.map((r) => {
    const lastVerifiedAt = iso(r.last_verified_at)!;
    let state = freshness({
      accessStatus: r.access_status, lastSuccessAt: iso(r.last_success_at), lastStatus: r.last_status, staleAfterHours: r.stale_after_hours,
    });
    // Not re-verified by the source's latest successful run (e.g. one page failed).
    if (state === 'fresh' && Date.parse(iso(r.last_success_at)!) - Date.parse(lastVerifiedAt) > 10 * 60_000) state = 'refresh_failed';
    if (state === 'unavailable') state = 'stale';
    return {
      id: Number(r.id), bankSlug: r.slug, bankName: r.bank, productKey: r.product_key, productName: r.product,
      category: r.category, productType: r.product_type, currency: r.currency, termMin: r.term_min_months,
      termMax: r.term_max_months, payout: r.payout_frequency, variant: r.variant, rate: Number(r.rate), rateMax: num(r.rate_max),
      qualifier: r.rate_qualifier, aprMin: num(r.apr_min), aprMax: num(r.apr_max), amountMin: num(r.amount_min),
      amountMax: num(r.amount_max), conditions: r.conditions, sourceName: r.source_name, sourceUrl: r.source_url,
      observedDate: r.observed_date, collectedAt: iso(r.collected_at)!, lastVerifiedAt, freshness: state,
      verification: r.verification_status,
    };
  });
}

export interface MarketFilter {
  metric: string;
  basis: string;
  segment?: string;
  bucket?: string;
  currencyGroup?: string;
}

export async function loadMarket(db: Queryable, f: MarketFilter): Promise<MarketPoint[]> {
  const params: unknown[] = [f.metric, f.basis];
  let where = 'superseded_at IS NULL AND metric = $1 AND basis = $2';
  for (const [column, value] of [['segment', f.segment], ['maturity_bucket', f.bucket], ['currency_group', f.currencyGroup]] as const) {
    if (value) where += ` AND ${column} = $${params.push(value)}`;
  }
  const rows = await db.query<Record<string, any>>(
    `SELECT metric, basis, currency_group, segment, maturity_bucket, period_date::text AS period_date, frequency, rate
     FROM market_statistics WHERE ${where} ORDER BY period_date, currency_group, segment, maturity_bucket`,
    params,
  );
  return rows.map((r) => ({
    metric: r.metric, basis: r.basis, currencyGroup: r.currency_group, segment: r.segment, bucket: r.maturity_bucket,
    periodDate: r.period_date, frequency: r.frequency, rate: Number(r.rate),
  }));
}

export async function loadInflation(db: Queryable): Promise<InflationPoint[]> {
  const rows = await db.query<{ month: string; measure: string; value: string }>(
    `SELECT period_date::text AS month, measure, value FROM inflation_observations WHERE superseded_at IS NULL ORDER BY period_date`,
  );
  const byMonth = new Map<string, InflationPoint>();
  const field = { cpi_mom: 'mom', cpi_yoy: 'yoy', cpi_avg_annual: 'avgAnnual' } as const;
  for (const r of rows) {
    const p = byMonth.get(r.month) ?? { month: r.month, mom: null, yoy: null, avgAnnual: null };
    p[field[r.measure as keyof typeof field]] = Number(r.value);
    byMonth.set(r.month, p);
  }
  return [...byMonth.values()];
}

export async function loadSources(db: Queryable): Promise<SourceInfo[]> {
  const rows = await db.query<Record<string, any>>(`
    SELECT s.*,
      (SELECT count(*) FROM interest_rate_observations o WHERE o.source_id = s.id AND o.superseded_at IS NULL)
      + (SELECT count(*) FROM market_statistics m WHERE m.source_id = s.id AND m.superseded_at IS NULL)
      + (SELECT count(*) FROM inflation_observations i WHERE i.source_id = s.id AND i.superseded_at IS NULL)
      + (SELECT count(*) FROM policy_rates pr WHERE pr.source_id = s.id AND pr.superseded_at IS NULL) AS records
    FROM data_sources s ORDER BY (s.kind <> 'official_statistics'), (s.access_status <> 'active'), s.publisher`);
  return rows.map((s) => {
    const base = {
      accessStatus: s.access_status, lastSuccessAt: iso(s.last_success_at), lastStatus: s.last_status, staleAfterHours: s.stale_after_hours,
    };
    return {
      key: s.key, name: s.name, publisher: s.publisher, kind: s.kind, url: s.url, format: s.format,
      updateFrequency: s.update_frequency, accessStatus: s.access_status, accessNote: s.access_note,
      lastAttemptAt: iso(s.last_attempt_at), lastVerifiedAt: base.lastSuccessAt, lastStatus: s.last_status,
      freshness: freshness(base), recordCount: Number(s.records),
    };
  });
}

export async function loadLogs(db: Queryable, limit = 40): Promise<IngestionLog[]> {
  const rows = await db.query<Record<string, any>>(
    `SELECT l.*, s.key FROM ingestion_logs l JOIN data_sources s ON s.id = l.source_id ORDER BY l.started_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((l) => ({
    id: Number(l.id), sourceKey: l.key, startedAt: iso(l.started_at)!, finishedAt: iso(l.finished_at), status: l.status,
    trigger: l.trigger, fetched: l.records_fetched, inserted: l.records_inserted, unchanged: l.records_unchanged,
    rejected: l.records_rejected, message: l.message,
  }));
}

export async function loadSnapshots(db: Queryable): Promise<Snapshot[]> {
  const rows = await db.query<Record<string, any>>(
    `SELECT snapshot_date::text AS date, product_type, currency, term_months, payout, n_offers, n_banks, mean_rate, median_rate, min_rate, max_rate
     FROM historical_snapshots ORDER BY snapshot_date DESC LIMIT 20000`,
  );
  return rows.reverse().map((r) => ({
    date: r.date, productType: r.product_type, currency: r.currency, term: r.term_months || null, payout: r.payout,
    nOffers: r.n_offers, nBanks: r.n_banks, mean: Number(r.mean_rate), median: Number(r.median_rate), min: Number(r.min_rate), max: Number(r.max_rate),
  }));
}

/** Official series are also stale when the publisher's latest period is old. */
export async function loadSeriesInfo(db: Queryable, key: 'cbar_rates' | 'cbar_cpi') {
  const [s] = (await loadSources(db)).filter((x) => x.key === key);
  const [latest] = await db.query<{ d: string | null }>(
    key === 'cbar_rates'
      ? 'SELECT max(period_date)::text AS d FROM market_statistics WHERE superseded_at IS NULL'
      : `SELECT max(period_date)::text AS d FROM inflation_observations WHERE superseded_at IS NULL AND measure = 'cpi_yoy'`,
  );
  if (!s) return null;
  const latestPeriod = latest?.d ?? null;
  const refMonth = latestPeriod && (key === 'cbar_rates' ? referenceMonth(latestPeriod) : latestPeriod);
  const old = refMonth ? Date.now() - Date.parse(refMonth) > 100 * 24 * HOUR : false;
  const info: SeriesSourceInfo & { latestPeriod: string | null } = {
    key: s.key, name: s.name, url: s.url, lastVerifiedAt: s.lastVerifiedAt,
    freshness: s.freshness === 'fresh' && old ? 'stale' : s.freshness, latestPeriod,
  };
  return info;
}

export async function loadTerms(db: Queryable): Promise<ProductTermsRow[]> {
  const rows = await db.query<Record<string, any>>(`
    SELECT b.slug, p.product_key, t.terms, t.source_url, t.last_verified_at
    FROM product_terms t JOIN bank_products p ON p.id = t.product_id JOIN banks b ON b.id = p.bank_id
    WHERE t.superseded_at IS NULL ORDER BY b.slug, p.product_key`);
  return rows.map((r) => ({
    ...(r.terms as ProductTermsRow), bankSlug: r.slug, productKey: r.product_key, sourceUrl: r.source_url, lastVerifiedAt: iso(r.last_verified_at)!,
  }));
}

export async function loadPolicy(db: Queryable): Promise<PolicyPoint[]> {
  const rows = await db.query<{ month: string; measure: string; value: string }>(
    'SELECT period_date::text AS month, measure, value FROM policy_rates WHERE superseded_at IS NULL ORDER BY period_date',
  );
  const byMonth = new Map<string, PolicyPoint>();
  const field = { refinancing: 'refinancing', corridor_floor: 'floor', corridor_ceiling: 'ceiling' } as const;
  for (const r of rows) {
    const p = byMonth.get(r.month) ?? { month: r.month, refinancing: null, floor: null, ceiling: null };
    p[field[r.measure as keyof typeof field]] = Number(r.value);
    byMonth.set(r.month, p);
  }
  return [...byMonth.values()];
}

export async function loadEvents(db: Queryable, bankSlug?: string, limit = 100): Promise<ChangeEvent[]> {
  const rows = await db.query<Record<string, any>>(
    `SELECT id, kind, bank_slug, currency, details, created_at FROM change_events
     ${bankSlug ? 'WHERE bank_slug = $2' : ''} ORDER BY id DESC LIMIT $1`,
    bankSlug ? [limit, bankSlug] : [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), kind: r.kind, bankSlug: r.bank_slug, currency: r.currency, details: r.details, createdAt: iso(r.created_at)!,
  }));
}

export interface BankSummary {
  slug: string;
  name: string;
  website: string;
  accessStatus: string;
  accessNote: string | null;
  freshness: Freshness;
  lastVerifiedAt: string | null;
}

export async function loadBanks(db: Queryable): Promise<BankSummary[]> {
  const sources = await loadSources(db);
  const banks = await db.query<{ slug: string; name: string; website: string; key: string }>(
    'SELECT b.slug, b.name, b.website, s.key FROM banks b JOIN data_sources s ON s.bank_id = b.id ORDER BY b.name',
  );
  const byKey = new Map(sources.map((s) => [s.key, s]));
  return banks.map(({ key, ...b }) => {
    const s = byKey.get(key)!;
    return { ...b, accessStatus: s.accessStatus, accessNote: s.accessNote, freshness: s.freshness, lastVerifiedAt: s.lastVerifiedAt };
  });
}

/** Every observation ever stored for a bank, newest first (the product change history). */
export async function loadBankHistory(db: Queryable, slug: string, limit = 400) {
  const rows = await db.query<Record<string, any>>(
    `SELECT p.name AS product, o.currency, o.term_min_months, o.term_max_months, o.payout_frequency, o.variant, o.rate,
            o.verification_status, o.collected_at, o.superseded_at
     FROM interest_rate_observations o JOIN bank_products p ON p.id = o.product_id JOIN banks b ON b.id = p.bank_id
     WHERE b.slug = $1 ORDER BY o.collected_at DESC, p.name, o.currency, o.term_min_months LIMIT $2`,
    [slug, limit],
  );
  return rows.map((r) => ({
    productName: r.product as string, currency: r.currency as string, termMin: r.term_min_months as number | null,
    termMax: r.term_max_months as number | null, payout: r.payout_frequency as string, variant: r.variant as string,
    rate: Number(r.rate), verification: r.verification_status as string, from: iso(r.collected_at)!, until: iso(r.superseded_at),
  }));
}
