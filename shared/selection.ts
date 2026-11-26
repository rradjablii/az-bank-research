import type { Currency, Payout, ProductType, RateRow } from './types.js';

/** A comparable slice of the bank-offer data. */
export interface Selection {
  productType: ProductType;
  currency: Currency;
  /** Term in months; null only for products without a fixed term (flexible deposits, loans). */
  term: number | null;
  payout: Payout;
  includeCampaigns: boolean;
  includeUninsured: boolean;
  /** One representative offer per bank (best for the customer) or every offer. */
  perBank: boolean;
}

export const STANDARD_TERMS = [3, 6, 9, 12, 18, 24, 36];

export const coversTerm = (r: Pick<RateRow, 'termMin' | 'termMax'>, term: number) =>
  r.termMin !== null && term >= r.termMin && term <= (r.termMax ?? r.termMin);

export const hasTerm = (t: ProductType) => t === 'term_deposit' || t === 'savings_deposit';

export function selectOffers(rows: readonly RateRow[], s: Selection): RateRow[] {
  const loan = s.productType === 'consumer_loan';
  let out = rows.filter(
    (r) =>
      r.productType === s.productType &&
      r.currency === s.currency &&
      (!hasTerm(s.productType) || (s.term !== null && coversTerm(r, s.term))) &&
      (loan || r.payout === s.payout) &&
      r.variant !== 'legacy_renewal' &&
      // Values awaiting or failing review never enter statistics.
      r.verification !== 'pending_review' &&
      r.verification !== 'rejected' &&
      (s.includeCampaigns || r.variant !== 'campaign') &&
      (s.includeUninsured || r.variant !== 'uninsured'),
  );
  if (s.perBank) {
    const best = new Map<string, RateRow>();
    for (const r of out) {
      const cur = best.get(r.bankSlug);
      if (!cur || (loan ? r.rate < cur.rate : r.rate > cur.rate)) best.set(r.bankSlug, r);
    }
    out = [...best.values()];
  }
  return out.sort((a, b) => (loan ? a.rate - b.rate : b.rate - a.rate) || a.bankName.localeCompare(b.bankName));
}
