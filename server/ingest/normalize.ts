import { z } from 'zod';
import type { OfferRecord } from './types.js';

const nullableNum = (max: number) => z.number().finite().nonnegative().max(max).nullish();

const offerSchema = z
  .object({
    productKey: z.string().min(1).max(80),
    productName: z.string().min(1).max(160),
    productType: z.enum(['term_deposit', 'savings_deposit', 'flexible_deposit', 'consumer_loan']),
    productUrl: z.string().startsWith('https://').max(500),
    currency: z.enum(['AZN', 'USD', 'EUR']),
    termMin: z.number().int().min(1).max(360).nullable(),
    termMax: z.number().int().min(1).max(360).nullable(),
    payout: z.enum(['monthly', 'quarterly', 'at_maturity', 'upfront', 'unspecified']),
    variant: z.enum(['standard', 'campaign', 'uninsured', 'legacy_renewal']),
    rate: z.number().finite().positive(),
    rateMax: nullableNum(150),
    qualifier: z.enum(['exact', 'from', 'up_to', 'range']).default('exact'),
    aprMin: nullableNum(500),
    aprMax: nullableNum(500),
    amountMin: nullableNum(1e12),
    amountMax: nullableNum(1e12),
    conditions: z.string().max(1000).nullish(),
    observedDate: z.iso.date().nullish(),
  })
  .superRefine((o, ctx) => {
    const loan = o.productType === 'consumer_loan';
    // Plausibility bounds: anything outside is a parsing error, not a bank offer.
    if (o.rate > (loan ? 100 : 25)) ctx.addIssue({ code: 'custom', message: `implausible rate ${o.rate}` });
    if (o.rateMax != null && o.rateMax < o.rate) ctx.addIssue({ code: 'custom', message: 'rateMax below rate' });
    if (!loan && o.productType !== 'flexible_deposit' && o.termMin === null) {
      ctx.addIssue({ code: 'custom', message: 'term deposit without a term' });
    }
    if (o.termMin !== null && o.termMax !== null && o.termMax < o.termMin) {
      ctx.addIssue({ code: 'custom', message: 'term range inverted' });
    }
  });

export type NormalizedOffer = z.output<typeof offerSchema> & { sourceUrl: string };

export const offerKey = (o: Pick<OfferRecord, 'productKey' | 'currency' | 'termMin' | 'termMax' | 'payout' | 'variant' | 'amountMin'>) =>
  [o.productKey, o.currency, o.termMin ?? 0, o.termMax ?? 0, o.payout, o.variant, Number(o.amountMin ?? 0)].join('|');

/** Validates, de-duplicates and reports rejects; conflicting duplicates are both dropped. */
export function normalizeOffers(records: (OfferRecord & { sourceUrl: string })[]) {
  const accepted = new Map<string, NormalizedOffer>();
  const conflicted = new Set<string>();
  const rejected: string[] = [];
  const rejectedRecords: { reason: string; payload: unknown }[] = [];
  let duplicates = 0;
  const reject = (reason: string, payload: unknown, summary: string) => {
    rejected.push(summary);
    rejectedRecords.push({ reason, payload });
  };
  for (const r of records) {
    const parsed = offerSchema.safeParse(r);
    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? 'invalid record';
      reject(reason, r, `${r.productKey} ${r.currency} ${r.termMin ?? '-'}m: ${reason}`);
      continue;
    }
    const offer = { ...parsed.data, sourceUrl: r.sourceUrl };
    const k = offerKey(offer);
    const prior = accepted.get(k);
    if (prior && prior.rate !== offer.rate) conflicted.add(k);
    else if (prior) duplicates++;
    accepted.set(k, offer);
  }
  for (const k of conflicted) {
    reject('conflicting duplicate rates', accepted.get(k), `conflicting duplicate rates for ${k}`);
    accepted.delete(k);
  }
  return { offers: [...accepted.values()], rejected, rejectedRecords, duplicates };
}
