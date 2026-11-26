import { parseRate, parseTerms, tables, type Grid } from '../../html.js';
import type { OfferRecord } from '../../types.js';
import type { Currency, Payout, Variant } from '../../../../shared/types.js';

export interface ProductBase {
  productKey: string;
  productName: string;
  productUrl: string;
  productType: OfferRecord['productType'];
  conditions?: string | null;
  observedDate?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
}

/** Lower-case that treats Azerbaijani İ correctly and ignores stray spacing. */
export const key = (s: string) => s.replace(/İ/g, 'i').toLowerCase().replace(/\s+/g, '');

export function currencyOf(label: string): Currency | null {
  const k = key(label);
  if (/azn|manat/.test(k)) return 'AZN';
  if (/usd|dollar/.test(k)) return 'USD';
  if (/eur|avro/.test(k)) return 'EUR';
  return null;
}

export function payoutOf(label: string): Payout | null {
  const k = key(label);
  if (/rüblük/.test(k)) return 'quarterly';
  if (/aylıq|həray|hərayda|aydabir/.test(k)) return 'monthly';
  if (/sonu/.test(k)) return 'at_maturity';
  return null;
}

export class LayoutChanged extends Error {
  constructor(detail: string) {
    super(`Page layout changed: ${detail}`);
    this.name = 'LayoutChanged';
  }
}

/** Distinct tables that contain percentages (mobile duplicates removed). */
export function rateTables(html: string): Grid[] {
  const seen = new Set<string>();
  return tables(html)
    .map((g) => g.filter((r) => r.length))
    .filter((g) => {
      const k = JSON.stringify(g);
      if (seen.has(k) || !k.includes('%')) return false;
      seen.add(k);
      return true;
    });
}

/** Splits a grid into per-column header labels and data rows keyed by term. */
export function columns(grid: Grid) {
  const first = grid.findIndex((r) => parseTerms(r[0] ?? '').length > 0);
  if (first < 1) throw new LayoutChanged('no term rows in table');
  const header = grid.slice(0, first);
  const width = Math.max(...grid.map((r) => r.length));
  const labels = Array.from({ length: width }, (_, x) => [...new Set(header.map((r) => r[x] ?? ''))].join(' '));
  return { labels, rows: grid.slice(first) };
}

export function offer(
  base: ProductBase,
  currency: Currency,
  term: { min: number; max: number } | null,
  payout: Payout,
  rate: number,
  variant: Variant = 'standard',
): OfferRecord {
  return {
    ...base,
    currency,
    termMin: term?.min ?? null,
    termMax: term?.max ?? null,
    payout,
    variant,
    rate,
    qualifier: 'exact',
  };
}

type ColumnSpec = { currency: Currency; payout: Payout; variant: Variant } | null;

/** Reads a "term × columns" table; `spec` decides what each column means. */
export function readTermTable(base: ProductBase, grid: Grid, spec: (label: string, index: number) => ColumnSpec): OfferRecord[] {
  const { labels, rows } = columns(grid);
  const specs = labels.map((l, i) => (i === 0 ? null : spec(l, i)));
  const out: OfferRecord[] = [];
  for (const row of rows) {
    for (const term of parseTerms(row[0] ?? '')) {
      specs.forEach((s, i) => {
        const rate = s && parseRate(row[i] ?? '');
        if (s && rate) out.push(offer(base, s.currency, term, s.payout, rate, s.variant));
      });
    }
  }
  return out;
}

const maxRate = (o: OfferRecord[]) => Math.max(0, ...o.map((x) => x.rate));

/**
 * For pages where currency is only conveyed by tab order (AZN first, then USD).
 * Guard: manat rates must exceed dollar rates, otherwise refuse to guess.
 */
export function assertAznAboveUsd(azn: OfferRecord[], usd: OfferRecord[]) {
  if (!azn.length || !usd.length || maxRate(azn) <= maxRate(usd)) {
    throw new LayoutChanged('cannot verify which table is AZN and which is USD');
  }
}

export function requireOffers(offers: OfferRecord[], min = 1): OfferRecord[] {
  if (offers.length < min) throw new LayoutChanged(`expected at least ${min} rates, found ${offers.length}`);
  return offers;
}
