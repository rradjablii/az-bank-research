import type { Db, Queryable } from './db/client.js';
import * as repo from './repo.js';
import { loadConfidence } from './analytics.js';
import { deliverNotifications, recordEvent } from './events.js';

export class NotFound extends Error {}
export class Conflict extends Error {}

export async function overview(db: Db) {
  const sources = await repo.loadSources(db);
  const counts = await db.query<Record<string, any>>(`
    SELECT s.key,
      (SELECT count(*)::int FROM raw_source_records r WHERE r.source_id=s.id) AS raw,
      (SELECT count(*)::int FROM rejected_records j WHERE j.source_id=s.id) AS invalid,
      (SELECT COALESCE(sum(records_duplicate),0)::int FROM ingestion_logs l WHERE l.source_id=s.id) AS duplicates,
      (SELECT count(*)::int FROM interest_rate_observations o WHERE o.source_id=s.id AND o.superseded_at IS NULL AND o.verification_status='pending_review') AS pending,
      (SELECT count(*)::int FROM ingestion_logs l WHERE l.source_id=s.id AND l.status='failed') AS failures,
      (SELECT count(*)::int FROM ingestion_logs l WHERE l.source_id=s.id AND l.status='failed'
         AND l.started_at > COALESCE((SELECT max(started_at) FROM ingestion_logs x WHERE x.source_id=s.id AND x.status IN ('success','partial')), 'epoch')) AS consecutive_failures,
      (SELECT message FROM ingestion_logs l WHERE l.source_id=s.id AND l.message IS NOT NULL ORDER BY started_at DESC LIMIT 1) AS last_error,
      LEAST((SELECT min(collected_at)::date FROM interest_rate_observations o WHERE o.source_id=s.id),
            (SELECT min(period_date) FROM market_statistics m WHERE m.source_id=s.id),
            (SELECT min(period_date) FROM inflation_observations i WHERE i.source_id=s.id),
            (SELECT min(period_date) FROM policy_rates p WHERE p.source_id=s.id))::text AS coverage_from
    FROM data_sources s`);
  const confidence = await loadConfidence(db);
  return sources.map((s) => {
    const c = counts.find((x) => x.key === s.key)!;
    return {
      ...s, raw: c.raw as number, invalid: c.invalid as number, duplicates: c.duplicates as number, pending: c.pending as number,
      failures: c.failures as number, consecutiveFailures: c.consecutive_failures as number, lastError: c.last_error as string | null,
      coverageFrom: c.coverage_from as string | null, confidence: confidence.find((x) => x.key === s.key)?.score ?? null,
    };
  });
}

const PAGE = 20;

export async function rawRecords(db: Db, sourceKey: string, page: number) {
  const rows = await db.query<Record<string, any>>(
    `SELECT r.id, r.source_url, r.collected_at, left(r.payload::text, 4000) AS payload, length(r.payload::text) AS size
     FROM raw_source_records r JOIN data_sources s ON s.id=r.source_id WHERE s.key=$1 ORDER BY r.id DESC LIMIT ${PAGE} OFFSET $2`,
    [sourceKey, (page - 1) * PAGE],
  );
  return rows.map((r) => ({ id: Number(r.id), sourceUrl: r.source_url as string, collectedAt: new Date(r.collected_at).toISOString(), payload: r.payload as string, truncated: r.size > 4000 }));
}

export async function rejectedRecords(db: Db, page: number) {
  const rows = await db.query<Record<string, any>>(
    `SELECT j.id, s.key, j.reason, j.payload, j.created_at FROM rejected_records j JOIN data_sources s ON s.id=j.source_id
     ORDER BY j.id DESC LIMIT ${PAGE} OFFSET $1`,
    [(page - 1) * PAGE],
  );
  return rows.map((r) => ({ id: Number(r.id), sourceKey: r.key as string, reason: r.reason as string, payload: r.payload, createdAt: new Date(r.created_at).toISOString() }));
}

const OBSERVATION = `
  SELECT o.id, b.slug, b.name AS bank, p.name AS product, p.category, o.currency, o.term_min_months, o.payout_frequency, o.variant,
         o.rate, o.source_rate, o.verification_status, o.collected_at, o.superseded_at, o.source_url,
         (SELECT x.rate FROM interest_rate_observations x WHERE x.product_id=o.product_id AND x.currency=o.currency
            AND x.term_min_months IS NOT DISTINCT FROM o.term_min_months AND x.term_max_months IS NOT DISTINCT FROM o.term_max_months
            AND x.payout_frequency=o.payout_frequency AND x.variant=o.variant AND x.amount_min IS NOT DISTINCT FROM o.amount_min
            AND x.id < o.id ORDER BY x.id DESC LIMIT 1) AS previous
  FROM interest_rate_observations o JOIN bank_products p ON p.id=o.product_id JOIN banks b ON b.id=p.bank_id`;

const toObservation = (r: Record<string, any>) => ({
  id: Number(r.id), bankSlug: r.slug as string, bankName: r.bank as string, productName: r.product as string, category: r.category as string,
  currency: r.currency as string, termMin: r.term_min_months as number | null, payout: r.payout_frequency as string, variant: r.variant as string,
  rate: Number(r.rate), sourceRate: r.source_rate === null ? null : Number(r.source_rate), previous: r.previous === null ? null : Number(r.previous),
  verification: r.verification_status as string, collectedAt: new Date(r.collected_at).toISOString(), current: r.superseded_at === null,
  sourceUrl: r.source_url as string,
});

/** Current observations, optionally by status or bank. */
export async function observations(db: Db, filter: { status?: string; bank?: string; page: number }) {
  const where = ['o.superseded_at IS NULL'];
  const params: unknown[] = [];
  if (filter.status) where.push(`o.verification_status = $${params.push(filter.status)}`);
  if (filter.bank) where.push(`b.slug = $${params.push(filter.bank)}`);
  const rows = await db.query<Record<string, any>>(
    `${OBSERVATION} WHERE ${where.join(' AND ')} ORDER BY o.collected_at DESC, o.id DESC LIMIT ${PAGE} OFFSET $${params.push((filter.page - 1) * PAGE)}`,
    params,
  );
  return rows.map(toObservation);
}

async function lockCurrent(q: Queryable, id: number) {
  const [row] = await q.query<Record<string, any>>(`${OBSERVATION} WHERE o.id=$1 FOR UPDATE OF o`, [id]);
  if (!row) throw new NotFound();
  if (row.superseded_at !== null) throw new Conflict('This observation has already been superseded');
  return toObservation(row);
}

async function audit(q: Queryable, actor: string, action: string, id: number, before: unknown, after: unknown, note: string) {
  await q.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, before, after, note) VALUES ($1,$2,'interest_rate_observation',$3,$4::jsonb,$5::jsonb,$6)`,
    [actor, action, String(id), JSON.stringify(before), JSON.stringify(after), note],
  );
}

/**
 * approve / reject change the status; correct creates a new observation (history
 * is never overwritten). Every action is written to the audit log.
 */
export async function review(db: Db, actor: string, id: number, input: { action: 'approve' | 'reject' | 'correct'; rate?: number; note: string }) {
  const result = await db.tx(async (q) => {
    const before = await lockCurrent(q, id);
    if (input.action !== 'correct') {
      const status = input.action === 'approve' ? 'approved' : 'rejected';
      await q.query('UPDATE interest_rate_observations SET verification_status=$2 WHERE id=$1', [id, status]);
      await audit(q, actor, input.action, id, before, { ...before, verification: status }, input.note);
      if (input.action === 'approve' && before.verification === 'pending_review' && before.previous !== null) {
        await recordEvent(q, {
          kind: 'rate_change', bankSlug: before.bankSlug, currency: before.currency as 'AZN',
          details: { bankName: before.bankName, productName: before.productName, termMin: before.termMin, payout: before.payout, variant: before.variant, from: before.previous, to: before.rate },
          dedupeKey: `rate|${id}`,
        });
      }
      return { id };
    }
    if (input.rate === undefined || !(input.rate > 0) || input.rate > (before.category === 'loan' ? 100 : 25)) {
      throw new Conflict('A plausible corrected rate is required');
    }
    await q.query('UPDATE interest_rate_observations SET superseded_at=now() WHERE id=$1', [id]);
    const [created] = await q.query<{ id: string }>(
      `INSERT INTO interest_rate_observations (product_id, source_id, raw_record_id, currency, term_min_months, term_max_months, payout_frequency,
         variant, rate, rate_max, rate_qualifier, apr_min, apr_max, amount_min, amount_max, conditions, source_name, source_url, observed_date,
         collected_at, last_verified_at, verification_status, source_rate)
       SELECT product_id, source_id, raw_record_id, currency, term_min_months, term_max_months, payout_frequency, variant, $2,
         CASE WHEN rate_max >= $2 THEN rate_max END, CASE WHEN rate_max >= $2 THEN rate_qualifier WHEN rate_qualifier='range' THEN 'from' ELSE rate_qualifier END,
         apr_min, apr_max, amount_min, amount_max, conditions, source_name, source_url, observed_date, collected_at, last_verified_at, 'corrected', source_rate
       FROM interest_rate_observations WHERE id=$1 RETURNING id`,
      [id, input.rate],
    );
    await audit(q, actor, 'correct', Number(created!.id), before, { ...before, id: Number(created!.id), rate: input.rate, verification: 'corrected' }, input.note);
    return { id: Number(created!.id) };
  });
  await deliverNotifications(db);
  return result;
}

export async function auditLog(db: Db, page: number) {
  const rows = await db.query<Record<string, any>>(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ${PAGE} OFFSET $1`, [(page - 1) * PAGE]);
  return rows.map((r) => ({
    id: Number(r.id), actor: r.actor as string, action: r.action as string, entityId: r.entity_id as string,
    before: r.before, after: r.after, note: r.note as string | null, createdAt: new Date(r.created_at).toISOString(),
  }));
}
