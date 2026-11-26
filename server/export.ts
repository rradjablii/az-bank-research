import type { Db } from './db/client.js';
import * as repo from './repo.js';

export const DATASETS = ['rates', 'market', 'inflation', 'policy'] as const;
export type Dataset = (typeof DATASETS)[number];

/** CSV cell with quoting and spreadsheet formula-injection protection. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

export async function exportCsv(db: Db, dataset: Dataset): Promise<string> {
  const info = async (key: 'cbar_rates' | 'cbar_cpi') => (await repo.loadSeriesInfo(db, key)) ?? { url: '', lastVerifiedAt: null };
  if (dataset === 'rates') {
    const rows = await repo.loadRates(db);
    return toCsv(
      ['bank', 'product', 'category', 'product_type', 'currency', 'term_min_months', 'term_max_months', 'payout', 'variant', 'rate', 'rate_max', 'apr_min', 'apr_max', 'verification', 'freshness', 'publication_date', 'collected_at', 'last_verified_at', 'source_name', 'source_url'],
      rows.filter((r) => r.verification !== 'rejected').map((r) => [r.bankName, r.productName, r.category, r.productType, r.currency, r.termMin, r.termMax, r.payout, r.variant, r.rate, r.rateMax, r.aprMin, r.aprMax, r.verification, r.freshness, r.observedDate, r.collectedAt, r.lastVerifiedAt, r.sourceName, r.sourceUrl]),
    );
  }
  if (dataset === 'market') {
    const source = await info('cbar_rates');
    const all = [];
    for (const metric of ['deposit_rate', 'loan_rate']) {
      for (const basis of ['new_business', 'outstanding']) all.push(...(await repo.loadMarket(db, { metric, basis })));
    }
    return toCsv(
      ['reporting_date', 'frequency', 'metric', 'basis', 'currency_group', 'segment', 'maturity', 'rate', 'source_url', 'last_verified_at'],
      all.map((p) => [p.periodDate, p.frequency, p.metric, p.basis, p.currencyGroup, p.segment, p.bucket, p.rate, source.url, source.lastVerifiedAt]),
    );
  }
  const source = await info('cbar_cpi');
  if (dataset === 'inflation') {
    return toCsv(['month', 'cpi_mom', 'cpi_yoy', 'cpi_avg_annual', 'source_url', 'last_verified_at'], (await repo.loadInflation(db)).map((p) => [p.month, p.mom, p.yoy, p.avgAnnual, source.url, source.lastVerifiedAt]));
  }
  return toCsv(['month', 'refinancing', 'corridor_floor', 'corridor_ceiling', 'source_url', 'last_verified_at'], (await repo.loadPolicy(db)).map((p) => [p.month, p.refinancing, p.floor, p.ceiling, source.url, source.lastVerifiedAt]));
}
