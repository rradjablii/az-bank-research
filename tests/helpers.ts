import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RateRow } from '../shared/types';

export const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures', name));
export const html = (name: string) => fixture(name).toString('utf8');

export const offerRow = (o: Partial<RateRow>): RateRow => ({
  id: Math.floor(Math.random() * 1e9), bankSlug: 'a', bankName: `Bank ${o.bankSlug ?? 'a'}`, productKey: 'term', productName: 'Term deposit',
  category: 'deposit', productType: 'term_deposit', currency: 'AZN', termMin: 12, termMax: 12, payout: 'at_maturity', variant: 'standard',
  rate: 9, rateMax: null, qualifier: 'exact', aprMin: null, aprMax: null, amountMin: null, amountMax: null, conditions: null,
  sourceName: 'Test source', sourceUrl: 'https://example.az/rates', observedDate: null, collectedAt: '2026-11-26T10:00:00.000Z',
  lastVerifiedAt: '2026-11-26T10:00:00.000Z', freshness: 'fresh', verification: 'auto_validated', ...o,
});
