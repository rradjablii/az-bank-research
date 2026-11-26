import { coversTerm } from './selection.js';
import { payoutToMethod, simulateDeposit } from './finance.js';
import type { Currency, Payout, ProductTermsRow, RateRow } from './types.js';

export type WithdrawalNeed = 'any' | 'interest' | 'partial';

export interface Assumptions {
  currency: Currency;
  term: number;
  amount: number;
  payout: Payout;
  need: WithdrawalNeed;
  includeCampaigns: boolean;
}

function meetsNeed(t: ProductTermsRow | undefined, need: WithdrawalNeed) {
  if (need === 'any') return true;
  if (need === 'partial') return t?.partialWithdrawal === true;
  const e = t?.earlyWithdrawal;
  return e?.type === 'reduced_rate' || (e?.type === 'retained_share' && e.tiers.some((x) => x.retainedPct > 0));
}

/**
 * Offers satisfying identical assumptions. A condition that was not found never
 * counts as satisfied; an unknown minimum amount is kept but flagged.
 */
export function eligibleOffers(rows: RateRow[], terms: ProductTermsRow[], a: Assumptions) {
  const excluded = { amount: 0, withdrawal: 0 };
  const candidates = rows.filter(
    (r) =>
      r.category === 'deposit' && r.productType !== 'flexible_deposit' && r.currency === a.currency && r.payout === a.payout &&
      coversTerm(r, a.term) && r.variant !== 'legacy_renewal' && r.variant !== 'uninsured' && (a.includeCampaigns || r.variant !== 'campaign') &&
      r.verification !== 'pending_review' && r.verification !== 'rejected',
  );
  const offers = candidates.flatMap((offer) => {
    const t = terms.find((x) => x.bankSlug === offer.bankSlug && x.productKey === offer.productKey);
    const minimum = offer.amountMin ?? t?.minAmount?.[a.currency] ?? null;
    if ((minimum !== null && a.amount < minimum) || (offer.amountMax !== null && a.amount > offer.amountMax)) {
      excluded.amount++;
      return [];
    }
    if (!meetsNeed(t, a.need)) {
      excluded.withdrawal++;
      return [];
    }
    if (!(a.amount > 0)) return [];
    const result = simulateDeposit({ principal: a.amount, annualRate: offer.rate, months: a.term, method: payoutToMethod(a.payout), currency: a.currency, tax: 'none' });
    return [{ offer, interest: result.grossInterest, eay: result.grossAnnualised, minimumKnown: minimum !== null, terms: t }];
  });
  return { offers: offers.sort((x, y) => y.interest - x.interest || x.offer.bankName.localeCompare(y.offer.bankName)), excluded };
}
