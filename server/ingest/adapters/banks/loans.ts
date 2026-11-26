import { pageText } from '../../html.js';
import type { OfferRecord } from '../../types.js';
import { LayoutChanged, type ProductBase } from './common.js';

const N = String.raw`(\d{1,3}(?:[.,]\d{1,2})?)`;
const num = (s: string) => Number(s.replace(',', '.'));

export interface LoanSpec {
  /** Captures the nominal minimum rate and optionally the maximum. */
  rate: string;
  /** Captures APR (FİFD) minimum and maximum. */
  apr?: string;
  maxTermMonths?: number;
  amountMax?: number;
}

/**
 * Consumer cash-loan terms are published as marketing text ("from 10.9%").
 * Patterns use {n} for a number and are anchored on the surrounding wording.
 */
export function parseLoan(html: string, base: ProductBase, spec: LoanSpec): OfferRecord[] {
  const text = pageText(html);
  const find = (p: string) => new RegExp(p.replaceAll('{n}', N), 'u').exec(text);
  const rate = find(spec.rate);
  if (!rate) throw new LayoutChanged('advertised loan rate not found');
  const apr = spec.apr ? find(spec.apr) : null;
  const min = num(rate[1]!);
  const max = rate[2] ? num(rate[2]) : null;
  return [
    {
      ...base,
      currency: 'AZN',
      termMin: null,
      termMax: spec.maxTermMonths ?? null,
      payout: 'unspecified',
      variant: 'standard',
      rate: min,
      rateMax: max,
      qualifier: max === null ? 'from' : 'range',
      aprMin: apr ? num(apr[1]!) : null,
      aprMax: apr?.[2] ? num(apr[2]) : null,
      amountMax: spec.amountMax ?? null,
      conditions: `Advertised: "${rate[0].trim()}"${apr ? `; "${apr[0].trim()}"` : ''}`,
    },
  ];
}
