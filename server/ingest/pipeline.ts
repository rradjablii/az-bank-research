import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/client.js';
import { adapters as defaultAdapters } from './adapters/index.js';
import { createFetcher, type Fetcher } from './fetcher.js';
import { normalizeOffers, offerKey, type NormalizedOffer } from './normalize.js';
import { needsReview } from './review.js';
import { deliverNotifications, recordEvent } from '../events.js';
import { takeIndexSnapshot } from '../analytics.js';
import type { Collected, SourceAdapter } from './types.js';
import { describe } from '../../shared/stats.js';
import { STANDARD_TERMS, selectOffers, hasTerm } from '../../shared/selection.js';
import { CURRENCIES, type Payout, type ProductType } from '../../shared/types.js';
import { loadRates } from '../repo.js';

export interface RunOptions {
  trigger: 'manual' | 'schedule' | 'cli';
  /** Source keys; default all. */
  keys?: string[];
  /** Ignore the minimum refresh interval. */
  force?: boolean;
  adapters?: SourceAdapter[];
  fetcherFor?: (a: SourceAdapter) => Fetcher;
}

export interface SourceResult {
  key: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  fetched: number;
  duplicates: number;
  inserted: number;
  unchanged: number;
  rejected: number;
  message: string | null;
}

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }));

/** Registers banks and sources so unavailable ones are visible too. */
export async function syncSources(db: Db, list: SourceAdapter[]) {
  for (const a of list) {
    let bankId: number | null = null;
    if (a.bank) {
      const [b] = await db.query<{ id: number }>(
        `INSERT INTO banks (slug, name, website) VALUES ($1,$2,$3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, website = EXCLUDED.website, updated_at = now()
         RETURNING id`,
        [a.bank.slug, a.bank.name, a.bank.website],
      );
      bankId = b!.id;
    }
    await db.query(
      `INSERT INTO data_sources (key, name, publisher, kind, url, format, update_frequency, access_status, access_note, bank_id, min_refresh_hours, stale_after_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, publisher=EXCLUDED.publisher, kind=EXCLUDED.kind, url=EXCLUDED.url,
         format=EXCLUDED.format, update_frequency=EXCLUDED.update_frequency, access_status=EXCLUDED.access_status,
         access_note=EXCLUDED.access_note, bank_id=EXCLUDED.bank_id, min_refresh_hours=EXCLUDED.min_refresh_hours,
         stale_after_hours=EXCLUDED.stale_after_hours, updated_at=now()`,
      [a.key, a.name, a.publisher, a.kind, a.url, a.format, a.updateFrequency, a.accessStatus, a.accessNote ?? null, bankId, a.minRefreshHours, a.staleAfterHours],
    );
  }
}

async function storeRaw(q: Queryable, sourceId: number, logId: number, docs: Collected['documents']) {
  const ids = new Map<string, number>();
  for (const d of docs) {
    const json = JSON.stringify(d.payload);
    const hash = createHash('sha256').update(json).digest('hex');
    const [row] = await q.query<{ id: string }>(
      `INSERT INTO raw_source_records (source_id, ingestion_log_id, source_url, content_hash, payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (source_id, source_url, content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash
       RETURNING id`,
      [sourceId, logId, d.url, hash, json],
    );
    ids.set(d.url, Number(row!.id));
  }
  return ids;
}

/**
 * Set-based upsert that preserves history: identical values are re-verified,
 * revised values supersede the old row and insert a new one.
 */
async function upsertSeries(
  q: Queryable,
  table: 'market_statistics' | 'inflation_observations' | 'policy_rates',
  keys: Record<string, string>,
  value: string,
  extra: Record<string, string>,
  sourceId: number,
  rows: Record<string, unknown>[],
) {
  if (!rows.length) return { inserted: 0, unchanged: 0 };
  const cols = { ...keys, [value]: 'numeric', ...extra, raw_record_id: 'bigint' };
  const recordset = `jsonb_to_recordset($1::jsonb) AS n(${Object.entries(cols).map(([c, t]) => `${c} ${t}`).join(', ')})`;
  const match = Object.keys(keys).map((k) => `t.${k} = n.${k}`).join(' AND ');
  const json = JSON.stringify(rows);
  const same = await q.query(
    `UPDATE ${table} t SET last_verified_at = now() FROM ${recordset}
     WHERE t.superseded_at IS NULL AND ${match} AND t.${value} = round(n.${value}, 4) RETURNING 1`,
    [json],
  );
  await q.query(
    `UPDATE ${table} t SET superseded_at = now() FROM ${recordset}
     WHERE t.superseded_at IS NULL AND ${match} AND t.${value} <> round(n.${value}, 4)`,
    [json],
  );
  const names = Object.keys(cols);
  const added = await q.query(
    `INSERT INTO ${table} (source_id, ${names.join(', ')})
     SELECT $2, ${names.map((c) => `n.${c}`).join(', ')} FROM ${recordset}
     WHERE NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.superseded_at IS NULL AND ${match})
     RETURNING 1`,
    [json, sourceId],
  );
  return { inserted: added.length, unchanged: same.length };
}

const dedupe = <T>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];

interface CurrentRow {
  id: string;
  product_key: string;
  currency: string;
  term_min_months: number | null;
  term_max_months: number | null;
  payout_frequency: string;
  variant: string;
  amount_min: string | null;
  rate: string;
  source_rate: string | null;
  rate_max: string | null;
  rate_qualifier: string;
  apr_min: string | null;
  apr_max: string | null;
  amount_max: string | null;
  conditions: string | null;
  verification_status: string;
}

const n4 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 1e4) / 1e4);

async function storeOffers(
  q: Queryable,
  adapter: SourceAdapter,
  sourceId: number,
  offers: NormalizedOffer[],
  raw: Map<string, number>,
  complete: boolean,
) {
  const [source] = await q.query<{ bank_id: number }>('SELECT bank_id FROM data_sources WHERE id = $1', [sourceId]);
  const bankId = source!.bank_id;
  const known = await q.query<{ product_key: string }>('SELECT product_key FROM bank_products WHERE bank_id = $1', [bankId]);
  const knownKeys = new Set(known.map((k) => k.product_key));
  // The very first load of a bank is a baseline, not a set of "changes".
  const baseline = !known.length;
  const productIds = new Map<string, number>();
  for (const o of dedupe(offers, (x) => x.productKey)) {
    const [p] = await q.query<{ id: number }>(
      `INSERT INTO bank_products (bank_id, source_id, product_key, name, category, product_type, product_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (bank_id, product_key) DO UPDATE SET source_id=EXCLUDED.source_id, name=EXCLUDED.name,
         category=EXCLUDED.category, product_type=EXCLUDED.product_type, product_url=EXCLUDED.product_url, last_seen_at=now()
       RETURNING id`,
      [bankId, sourceId, o.productKey, o.productName, o.productType === 'consumer_loan' ? 'loan' : 'deposit', o.productType, o.productUrl],
    );
    productIds.set(o.productKey, p!.id);
    if (!baseline && !knownKeys.has(o.productKey)) {
      await recordEvent(q, {
        kind: 'new_product', bankSlug: adapter.bank!.slug, currency: null,
        details: { bankName: adapter.bank!.name, productName: o.productName, productKey: o.productKey },
        dedupeKey: `product|${adapter.bank!.slug}|${o.productKey}`,
      });
    }
  }

  const current = await q.query<CurrentRow>(
    `SELECT o.*, p.product_key FROM interest_rate_observations o JOIN bank_products p ON p.id = o.product_id
     WHERE o.source_id = $1 AND o.superseded_at IS NULL`,
    [sourceId],
  );
  const byKey = new Map(
    current.map((r) => [
      offerKey({
        productKey: r.product_key, currency: r.currency as 'AZN', termMin: r.term_min_months, termMax: r.term_max_months,
        payout: r.payout_frequency as Payout, variant: r.variant as 'standard', amountMin: n4(r.amount_min),
      }),
      r,
    ]),
  );

  let inserted = 0;
  let unchanged = 0;
  for (const o of offers) {
    const k = offerKey(o);
    const prior = byKey.get(k);
    byKey.delete(k);
    if (
      prior &&
      // Compare with what the source said last time, so a reviewer's correction survives.
      n4(prior.source_rate ?? prior.rate) === n4(o.rate) &&
      n4(prior.rate_max) === n4(o.rateMax) &&
      prior.rate_qualifier === o.qualifier &&
      n4(prior.apr_min) === n4(o.aprMin) &&
      n4(prior.apr_max) === n4(o.aprMax) &&
      n4(prior.amount_max) === n4(o.amountMax) &&
      (prior.conditions ?? null) === (o.conditions ?? null)
    ) {
      await q.query(
        'UPDATE interest_rate_observations SET last_verified_at = now(), observed_date = COALESCE($2::date, observed_date) WHERE id = $1',
        [prior.id, o.observedDate ?? null],
      );
      unchanged++;
      continue;
    }
    const category = o.productType === 'consumer_loan' ? 'loan' : 'deposit';
    const status = prior && needsReview(Number(prior.rate), o.rate, category) ? 'pending_review' : 'auto_validated';
    if (prior) await q.query('UPDATE interest_rate_observations SET superseded_at = now() WHERE id = $1', [prior.id]);
    const [row] = await q.query<{ id: string }>(
      `INSERT INTO interest_rate_observations (product_id, source_id, raw_record_id, currency, term_min_months, term_max_months,
         payout_frequency, variant, rate, rate_max, rate_qualifier, apr_min, apr_max, amount_min, amount_max, conditions,
         source_name, source_url, observed_date, verification_status, source_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$9) RETURNING id`,
      [
        productIds.get(o.productKey), sourceId, raw.get(o.sourceUrl), o.currency, o.termMin, o.termMax, o.payout, o.variant,
        o.rate, o.rateMax ?? null, o.qualifier, o.aprMin ?? null, o.aprMax ?? null, o.amountMin ?? null, o.amountMax ?? null,
        o.conditions ?? null, adapter.name, o.sourceUrl, o.observedDate ?? null, status,
      ],
    );
    inserted++;
    // Alerts fire only for validated changes; held values alert when approved.
    if (prior && status === 'auto_validated' && n4(prior.rate) !== n4(o.rate)) {
      await recordEvent(q, {
        kind: 'rate_change', bankSlug: adapter.bank!.slug, currency: o.currency,
        details: {
          bankName: adapter.bank!.name, productName: o.productName, productKey: o.productKey, termMin: o.termMin, termMax: o.termMax,
          payout: o.payout, variant: o.variant, from: Number(prior.rate), to: o.rate,
        },
        dedupeKey: `rate|${row!.id}`,
      });
    }
  }
  // Retire rates no longer advertised, only when the whole source parsed cleanly
  // and did not shrink suspiciously (which would suggest a layout change).
  if (complete && offers.length >= current.length / 2) {
    for (const gone of byKey.values()) {
      await q.query('UPDATE interest_rate_observations SET superseded_at = now() WHERE id = $1', [gone.id]);
    }
  }
  return { inserted, unchanged };
}

/** Key-order independent serialisation (JSONB does not preserve key order). */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

async function storeTerms(q: Queryable, adapter: SourceAdapter, sourceId: number, items: NonNullable<Collected['terms']>, raw: Map<string, number>) {
  for (const item of items) {
    const [product] = await q.query<{ id: number; name: string }>(
      `SELECT p.id, p.name FROM bank_products p JOIN data_sources s ON s.bank_id = p.bank_id WHERE s.id = $1 AND p.product_key = $2`,
      [sourceId, item.productKey],
    );
    if (!product) continue;
    const [current] = await q.query<{ id: string; terms: unknown }>(
      'SELECT id, terms FROM product_terms WHERE product_id = $1 AND superseded_at IS NULL',
      [product.id],
    );
    // Excerpts are evidence; only a change in the structured conditions is a change.
    const key = (t: unknown) => canonical({ ...(t as object), excerpts: undefined });
    if (current && key(current.terms) === key(item.terms)) {
      await q.query('UPDATE product_terms SET last_verified_at = now() WHERE id = $1', [current.id]);
      continue;
    }
    if (current) await q.query('UPDATE product_terms SET superseded_at = now() WHERE id = $1', [current.id]);
    const [row] = await q.query<{ id: string }>(
      'INSERT INTO product_terms (product_id, raw_record_id, terms, source_url) VALUES ($1,$2,$3::jsonb,$4) RETURNING id',
      [product.id, raw.get(item.sourceUrl), JSON.stringify(item.terms), item.sourceUrl],
    );
    if (current) {
      await recordEvent(q, {
        kind: 'conditions_change', bankSlug: adapter.bank!.slug, currency: null,
        details: { bankName: adapter.bank!.name, productName: product.name, productKey: item.productKey },
        dedupeKey: `terms|${row!.id}`,
      });
    }
  }
}

/** Latest period/value per headline series, to detect newly published observations. */
async function headline(q: Queryable) {
  return q.query<{ series: string; period: string; value: string }>(`
    (SELECT 'deposit_rate_azn' AS series, period_date::text AS period, rate AS value FROM market_statistics
      WHERE superseded_at IS NULL AND metric='deposit_rate' AND basis='new_business' AND currency_group='AZN' ORDER BY period_date DESC LIMIT 1)
    UNION ALL (SELECT 'loan_rate_azn', period_date::text, rate FROM market_statistics
      WHERE superseded_at IS NULL AND metric='loan_rate' AND basis='new_business' AND currency_group='AZN' ORDER BY period_date DESC LIMIT 1)
    UNION ALL (SELECT 'inflation_yoy', period_date::text, value FROM inflation_observations
      WHERE superseded_at IS NULL AND measure='cpi_yoy' ORDER BY period_date DESC LIMIT 1)
    UNION ALL (SELECT 'refinancing_rate', period_date::text, value FROM policy_rates
      WHERE superseded_at IS NULL AND measure='refinancing' ORDER BY period_date DESC LIMIT 1)`);
}

async function ingestSource(db: Db, a: SourceAdapter, o: RunOptions): Promise<SourceResult> {
  const result: SourceResult = { key: a.key, status: 'skipped', duplicates: 0, fetched: 0, inserted: 0, unchanged: 0, rejected: 0, message: null };
  if (a.accessStatus !== 'active' || !a.collect) return { ...result, message: a.accessNote ?? 'Source not available' };

  const [src] = await db.query<{ id: number; fresh: boolean }>(
    `SELECT id, COALESCE(last_success_at > now() - make_interval(hours => min_refresh_hours), false) AS fresh
     FROM data_sources WHERE key = $1`,
    [a.key],
  );
  if (src!.fresh && !o.force) return { ...result, message: 'Refreshed recently; minimum interval not elapsed' };

  await db.query(
    `UPDATE ingestion_logs SET status='failed', finished_at=now(), message='Abandoned run'
     WHERE source_id=$1 AND status='running' AND started_at < now() - interval '10 minutes'`,
    [src!.id],
  );
  const [run] = await db.query<{ id: string }>(
    `INSERT INTO ingestion_logs (source_id, status, trigger) VALUES ($1,'running',$2)
     ON CONFLICT (source_id) WHERE status = 'running' DO NOTHING RETURNING id`,
    [src!.id, o.trigger],
  );
  if (!run) return { ...result, message: 'Another ingestion is already running' };
  const logId = Number(run.id);

  const finish = async () => {
    await db.query(
      `UPDATE ingestion_logs SET finished_at=now(), status=$2, records_fetched=$3, records_inserted=$4,
         records_unchanged=$5, records_rejected=$6, message=$7, records_duplicate=$8 WHERE id=$1`,
      [logId, result.status, result.fetched, result.inserted, result.unchanged, result.rejected, result.message, result.duplicates],
    );
    await db.query(
      `UPDATE data_sources SET last_attempt_at=now(), last_status=$2,
         last_success_at = CASE WHEN $2 = 'failed' THEN last_success_at ELSE now() END WHERE id=$1`,
      [src!.id, result.status],
    );
    log('ingest.source', { ...result });
  };

  try {
    const fetcher = o.fetcherFor?.(a) ?? createFetcher(a.hosts);
    const data = await a.collect(fetcher);
    const warnings = [...(data.warnings ?? [])];
    const { offers, rejected, rejectedRecords, duplicates } = normalizeOffers(data.offers ?? []);
    for (const bad of rejectedRecords) {
      await db.query('INSERT INTO rejected_records (source_id, ingestion_log_id, reason, payload) VALUES ($1,$2,$3,$4::jsonb)', [
        src!.id, logId, bad.reason, JSON.stringify(bad.payload),
      ]);
    }
    result.duplicates = duplicates;
    warnings.push(...rejected.slice(0, 5));
    result.rejected = rejected.length;
    result.fetched = (data.offers?.length ?? 0) + (data.market?.length ?? 0) + (data.inflation?.length ?? 0) + (data.policy?.length ?? 0);
    if (!offers.length && !data.market?.length && !data.inflation?.length) throw new Error(warnings.join('; ') || 'Source returned no usable records');

    await db.tx(async (q) => {
      const raw = await storeRaw(q, src!.id, logId, data.documents);
      const add = (r: { inserted: number; unchanged: number }) => {
        result.inserted += r.inserted;
        result.unchanged += r.unchanged;
      };
      if (offers.length) add(await storeOffers(q, a, src!.id, offers, raw, !data.warnings?.length && !rejected.length));
      if (data.terms?.length) await storeTerms(q, a, src!.id, data.terms, raw);
      const before = new Map((data.market?.length || data.inflation?.length || data.policy?.length ? await headline(q) : []).map((h) => [h.series, h.period]));
      add(
        await upsertSeries(
          q, 'policy_rates', { measure: 'text', period_date: 'date' }, 'value', {}, src!.id,
          dedupe(data.policy ?? [], (p) => `${p.measure}|${p.periodDate}`).map((p) => ({
            measure: p.measure, period_date: p.periodDate, value: p.value, raw_record_id: raw.get(p.sourceUrl),
          })),
        ),
      );
      const market = dedupe(data.market ?? [], (m) => [m.metric, m.basis, m.currencyGroup, m.segment, m.bucket, m.periodDate].join('|'));
      add(
        await upsertSeries(
          q, 'market_statistics',
          { metric: 'text', basis: 'text', currency_group: 'text', segment: 'text', maturity_bucket: 'text', period_date: 'date' },
          'rate', { frequency: 'text' }, src!.id,
          market.map((m) => ({
            metric: m.metric, basis: m.basis, currency_group: m.currencyGroup, segment: m.segment, maturity_bucket: m.bucket,
            period_date: m.periodDate, frequency: m.frequency, rate: m.rate, raw_record_id: raw.get(m.sourceUrl),
          })),
        ),
      );
      add(
        await upsertSeries(
          q, 'inflation_observations', { measure: 'text', period_date: 'date' }, 'value', {}, src!.id,
          dedupe(data.inflation ?? [], (i) => `${i.measure}|${i.periodDate}`).map((i) => ({
            measure: i.measure, period_date: i.periodDate, value: i.value, raw_record_id: raw.get(i.sourceUrl),
          })),
        ),
      );
      if (data.market?.length || data.inflation?.length || data.policy?.length) {
        for (const h of await headline(q)) {
          const previous = before.get(h.series);
          if (previous && h.period > previous) {
            await recordEvent(q, {
              kind: 'indicator', bankSlug: null, currency: null,
              details: { series: h.series, period: h.period, value: Number(h.value) },
              dedupeKey: `indicator|${h.series}|${h.period}`,
            });
          }
        }
      }
    });
    result.status = warnings.length ? 'partial' : 'success';
    result.message = warnings.length ? warnings.join('; ').slice(0, 900) : null;
  } catch (e) {
    result.status = 'failed';
    result.message = (e instanceof Error ? e.message : String(e)).slice(0, 900);
  }
  await finish();
  return result;
}

/** Records today's distribution of comparable offers (best standard offer per bank). */
export async function takeSnapshot(db: Db) {
  const rows = (await loadRates(db)).filter((r) => r.freshness === 'fresh');
  const types: ProductType[] = ['term_deposit', 'savings_deposit', 'consumer_loan'];
  const payouts: Payout[] = ['monthly', 'quarterly', 'at_maturity', 'upfront'];
  for (const productType of types) {
    for (const currency of CURRENCIES) {
      for (const term of hasTerm(productType) ? STANDARD_TERMS : [null]) {
        for (const payout of hasTerm(productType) ? payouts : (['unspecified'] as Payout[])) {
          const sel = selectOffers(rows, {
            productType, currency, term, payout, includeCampaigns: false, includeUninsured: false, perBank: true,
          });
          if (!sel.length) continue;
          const s = describe(sel.map((r) => r.rate));
          await db.query(
            `INSERT INTO historical_snapshots (snapshot_date, product_type, currency, term_months, payout, n_offers, n_banks, mean_rate, median_rate, min_rate, max_rate)
             VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (snapshot_date, product_type, currency, term_months, payout) DO UPDATE SET
               n_offers=EXCLUDED.n_offers, n_banks=EXCLUDED.n_banks, mean_rate=EXCLUDED.mean_rate,
               median_rate=EXCLUDED.median_rate, min_rate=EXCLUDED.min_rate, max_rate=EXCLUDED.max_rate, created_at=now()`,
            [productType, currency, term ?? 0, payout, sel.length, new Set(sel.map((r) => r.bankSlug)).size, s.mean, s.median, s.min, s.max],
          );
        }
      }
    }
  }
}

export async function runIngestion(db: Db, options: RunOptions): Promise<SourceResult[]> {
  const all = options.adapters ?? defaultAdapters();
  await syncSources(db, all);
  const queue = all.filter((a) => !options.keys?.length || options.keys.includes(a.key));
  const results: SourceResult[] = [];
  // Different publishers run concurrently; sources sharing a host run in order.
  const groups = new Map<string, SourceAdapter[]>();
  for (const a of queue) {
    const host = a.hosts[0] ?? a.key;
    groups.set(host, [...(groups.get(host) ?? []), a]);
  }
  const pending = [...groups.values()];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let g = pending.shift(); g; g = pending.shift()) {
        for (const a of g) {
          try {
            results.push(await ingestSource(db, a, options));
          } catch (e) {
            results.push({ key: a.key, status: 'failed', duplicates: 0, fetched: 0, inserted: 0, unchanged: 0, rejected: 0, message: (e as Error).message });
            console.error('ingest.error', a.key, e);
          }
        }
      }
    }),
  );
  if (results.some((r) => r.status === 'success' || r.status === 'partial')) {
    await takeSnapshot(db);
    await takeIndexSnapshot(db);
    await deliverNotifications(db);
  }
  return results.sort((a, b) => a.key.localeCompare(b.key));
}
