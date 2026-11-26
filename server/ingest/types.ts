import type {
  CurrencyGroup, ProductTerms, Currency, MarketBasis, MarketMetric, Payout, ProductType, RateQualifier, Segment, Variant,
} from '../../shared/types.js';
import type { Fetcher } from './fetcher.js';

export interface OfferRecord {
  productKey: string;
  productName: string;
  productType: ProductType;
  productUrl: string;
  currency: Currency;
  termMin: number | null;
  termMax: number | null;
  payout: Payout;
  variant: Variant;
  rate: number;
  rateMax?: number | null;
  qualifier?: RateQualifier;
  aprMin?: number | null;
  aprMax?: number | null;
  amountMin?: number | null;
  amountMax?: number | null;
  conditions?: string | null;
  /** Publication date stated by the source, if any. */
  observedDate?: string | null;
}

export interface MarketRecord {
  metric: MarketMetric;
  basis: MarketBasis;
  currencyGroup: CurrencyGroup;
  segment: Segment;
  bucket: string;
  periodDate: string;
  frequency: 'monthly' | 'annual';
  rate: number;
}

export interface InflationRecord {
  periodDate: string;
  measure: 'cpi_mom' | 'cpi_yoy' | 'cpi_avg_annual';
  value: number;
}

export interface PolicyRecord {
  periodDate: string;
  measure: 'refinancing' | 'corridor_floor' | 'corridor_ceiling';
  value: number;
}

export interface RawDocument {
  url: string;
  /** Extracted source content, stored verbatim (table cells / matched text). */
  payload: unknown;
}

export interface Collected {
  documents: RawDocument[];
  /** Each record points at the document (by URL) it was extracted from. */
  offers?: (OfferRecord & { sourceUrl: string })[];
  market?: (MarketRecord & { sourceUrl: string })[];
  inflation?: (InflationRecord & { sourceUrl: string })[];
  policy?: (PolicyRecord & { sourceUrl: string })[];
  terms?: { productKey: string; terms: ProductTerms; sourceUrl: string }[];
  /** Non-fatal problems; a source with warnings is logged as "partial". */
  warnings?: string[];
}

export interface BankRef {
  slug: string;
  name: string;
  website: string;
}

export interface SourceAdapter {
  key: string;
  name: string;
  publisher: string;
  kind: 'official_statistics' | 'bank_website' | 'partner_feed';
  url: string;
  format: string;
  updateFrequency: string;
  accessStatus: 'active' | 'unavailable' | 'disabled';
  accessNote?: string;
  bank?: BankRef;
  hosts: string[];
  minRefreshHours: number;
  staleAfterHours: number;
  collect?: (fetcher: Fetcher) => Promise<Collected>;
}
