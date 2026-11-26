import type { Db, Queryable } from './db/client.js';
import * as repo from './repo.js';
import { computeIndex, METHODOLOGY_VERSION, type HistoryStats, type IndexInput } from '../shared/index-score.js';
import { dataConfidence } from '../shared/confidence.js';

export async function loadHistoryStats(db: Queryable): Promise<Record<string, HistoryStats>> {
  const rows = await db.query<Record<string, any>>(`
    WITH obs AS (
      SELECT b.slug, o.product_id, o.currency, o.term_min_months, o.term_max_months, o.payout_frequency, o.variant, o.amount_min,
             o.rate, o.collected_at, o.last_verified_at,
             lag(o.rate) OVER (PARTITION BY o.product_id, o.currency, o.term_min_months, o.term_max_months, o.payout_frequency, o.variant, o.amount_min
                               ORDER BY o.collected_at, o.id) AS previous
      FROM interest_rate_observations o JOIN bank_products p ON p.id = o.product_id JOIN banks b ON b.id = p.bank_id
      WHERE o.variant = 'standard' AND o.verification_status NOT IN ('pending_review','rejected','corrected') AND p.product_type = 'term_deposit'
    )
    SELECT slug,
      floor(extract(epoch FROM max(last_verified_at) - min(collected_at)) / 86400)::int AS days,
      count(DISTINCT (product_id, currency, term_min_months, term_max_months, payout_frequency, amount_min))::int AS series,
      count(*) FILTER (WHERE previous IS NOT NULL AND previous <> rate)::int AS changes,
      COALESCE(avg(abs(rate - previous)) FILTER (WHERE previous IS NOT NULL AND previous <> rate), 0) AS size
    FROM obs GROUP BY slug`);
  return Object.fromEntries(rows.map((r) => [r.slug, { days: r.days, series: r.series, changes: r.changes, meanAbsChange: Number(r.size) }]));
}

export async function loadIndexInput(db: Queryable): Promise<IndexInput> {
  const [rates, terms, history, inflation] = [
    await repo.loadRates(db), await repo.loadTerms(db), await loadHistoryStats(db), await repo.loadInflation(db),
  ];
  const latest = inflation.filter((i) => i.yoy !== null).at(-1);
  // Stale or unrefreshed offers are not scored.
  return { rates: rates.filter((r) => r.freshness === 'fresh'), terms, history, inflation: latest ? { value: latest.yoy!, month: latest.month } : null };
}

export async function takeIndexSnapshot(db: Db) {
  for (const s of computeIndex(await loadIndexInput(db))) {
    await db.query(
      `INSERT INTO index_snapshots (snapshot_date, methodology, bank_slug, score, coverage, provisional, components)
       VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (snapshot_date, methodology, bank_slug) DO UPDATE SET
         score=EXCLUDED.score, coverage=EXCLUDED.coverage, provisional=EXCLUDED.provisional, components=EXCLUDED.components, created_at=now()`,
      [METHODOLOGY_VERSION, s.bankSlug, s.score, s.coverage, s.provisional, JSON.stringify(s.components)],
    );
  }
}

export async function loadIndexHistory(db: Queryable) {
  const rows = await db.query<Record<string, any>>(
    `SELECT snapshot_date::text AS date, methodology, bank_slug, score, coverage, provisional FROM index_snapshots
     ORDER BY snapshot_date DESC, bank_slug LIMIT 5000`,
  );
  return rows.reverse().map((r) => ({
    date: r.date as string, methodology: r.methodology as string, bankSlug: r.bank_slug as string,
    score: r.score === null ? null : Number(r.score), coverage: Number(r.coverage), provisional: r.provisional as boolean,
  }));
}

/** Per-source data confidence, from verification state, recency, completeness and history. */
export async function loadConfidence(db: Queryable) {
  const sources = await repo.loadSources(db);
  const stats = await db.query<Record<string, any>>(`
    SELECT s.key, s.stale_after_hours,
      (SELECT count(*) FROM interest_rate_observations o WHERE o.source_id=s.id AND o.superseded_at IS NULL) AS offers,
      (SELECT count(*) FROM interest_rate_observations o WHERE o.source_id=s.id AND o.superseded_at IS NULL
         AND o.verification_status IN ('auto_validated','approved','corrected')) AS valid,
      (SELECT count(*) FROM interest_rate_observations o WHERE o.source_id=s.id AND o.superseded_at IS NULL AND o.observed_date IS NOT NULL) AS dated,
      (SELECT count(DISTINCT o.product_id) FROM interest_rate_observations o JOIN bank_products p ON p.id=o.product_id
         WHERE o.source_id=s.id AND o.superseded_at IS NULL AND p.category='deposit') AS products,
      (SELECT count(*) FROM product_terms t JOIN bank_products p ON p.id=t.product_id
         WHERE p.source_id=s.id AND t.superseded_at IS NULL AND (t.terms->>'earlyWithdrawal') IS NOT NULL) AS with_terms,
      (SELECT floor(extract(epoch FROM now() - min(collected_at))/86400) FROM interest_rate_observations o WHERE o.source_id=s.id) AS offer_days,
      LEAST(
        (SELECT min(period_date) FROM market_statistics m WHERE m.source_id=s.id),
        (SELECT min(period_date) FROM inflation_observations i WHERE i.source_id=s.id)) AS series_start
    FROM data_sources s`);
  const byKey = new Map(stats.map((s) => [s.key, s]));
  return sources.map((source) => {
    const s = byKey.get(source.key)!;
    const official = source.kind === 'official_statistics';
    const offers = Number(s.offers);
    const completeness = official
      ? 1
      : offers
        ? (Number(s.dated) / offers + (Number(s.products) ? Math.min(1, Number(s.with_terms) / Number(s.products)) : 0)) / 2
        : 0;
    const confidence = dataConfidence({
      kind: source.kind, records: source.recordCount, validatedShare: official ? 1 : offers ? Number(s.valid) / offers : 0,
      hoursSinceSuccess: source.lastVerifiedAt ? (Date.now() - Date.parse(source.lastVerifiedAt)) / 3_600_000 : null,
      staleAfterHours: s.stale_after_hours, completeness,
      historyDays: official && s.series_start ? (Date.now() - Date.parse(s.series_start)) / 86_400_000 : Number(s.offer_days ?? 0),
    });
    return { key: source.key, publisher: source.publisher, ...(confidence ?? { score: null, parts: null }) };
  });
}
