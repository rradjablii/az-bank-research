export type Currency = 'AZN' | 'USD' | 'EUR';
export const CURRENCIES: Currency[] = ['AZN', 'USD', 'EUR'];

export type Category = 'deposit' | 'loan';
export type ProductType = 'term_deposit' | 'savings_deposit' | 'flexible_deposit' | 'consumer_loan';
export type Payout = 'monthly' | 'quarterly' | 'at_maturity' | 'upfront' | 'unspecified';
export type Variant = 'standard' | 'campaign' | 'uninsured' | 'legacy_renewal';
export type RateQualifier = 'exact' | 'from' | 'up_to' | 'range';
export type Freshness = 'fresh' | 'stale' | 'refresh_failed' | 'unavailable';

/** One current advertised bank product rate. */
export interface RateRow {
  id: number;
  bankSlug: string;
  bankName: string;
  productKey: string;
  productName: string;
  category: Category;
  productType: ProductType;
  currency: Currency;
  termMin: number | null;
  termMax: number | null;
  payout: Payout;
  variant: Variant;
  rate: number;
  rateMax: number | null;
  qualifier: RateQualifier;
  aprMin: number | null;
  aprMax: number | null;
  amountMin: number | null;
  amountMax: number | null;
  conditions: string | null;
  sourceName: string;
  sourceUrl: string;
  observedDate: string | null;
  collectedAt: string;
  lastVerifiedAt: string;
  freshness: Freshness;
  verification: VerificationStatus;
}

export type MarketMetric = 'deposit_rate' | 'loan_rate';
export type MarketBasis = 'outstanding' | 'new_business';
export type CurrencyGroup = 'AZN' | 'FX';
export type Segment = 'total' | 'legal_entities' | 'individuals';

/** Officially published market average (Central Bank of Azerbaijan). */
export interface MarketPoint {
  metric: MarketMetric;
  basis: MarketBasis;
  currencyGroup: CurrencyGroup;
  segment: Segment;
  bucket: string;
  /** Reporting date label exactly as published (ISO). */
  periodDate: string;
  frequency: 'monthly' | 'annual';
  rate: number;
}

export interface InflationPoint {
  /** First day of the reference month. */
  month: string;
  mom: number | null;
  yoy: number | null;
  avgAnnual: number | null;
}

export interface SeriesSourceInfo {
  key: string;
  name: string;
  url: string;
  lastVerifiedAt: string | null;
  freshness: Freshness;
}

export interface SourceInfo extends SeriesSourceInfo {
  publisher: string;
  kind: 'official_statistics' | 'bank_website' | 'partner_feed';
  format: string;
  updateFrequency: string;
  accessStatus: 'active' | 'unavailable' | 'disabled';
  accessNote: string | null;
  lastAttemptAt: string | null;
  lastStatus: string | null;
  recordCount: number;
}

export interface IngestionLog {
  id: number;
  sourceKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  fetched: number;
  inserted: number;
  unchanged: number;
  rejected: number;
  message: string | null;
}

export interface Snapshot {
  date: string;
  productType: ProductType;
  currency: Currency;
  term: number | null;
  payout: Payout;
  nOffers: number;
  nBanks: number;
  mean: number;
  median: number;
  min: number;
  max: number;
}

export type VerificationStatus = 'auto_validated' | 'pending_review' | 'approved' | 'corrected' | 'rejected';

export interface WithdrawalTier {
  /** Inclusive lower bound of the elapsed period, in days or % of the term. */
  from: number;
  to: number | null;
  /** Share of accrued interest the depositor keeps, 0–100. */
  retainedPct: number;
}

export type EarlyWithdrawal =
  | { type: 'forfeit' }
  | { type: 'retained_share'; unit: 'days' | 'term_percent'; tiers: WithdrawalTier[] }
  | { type: 'reduced_rate'; rates: Partial<Record<Currency, number>> };

/** Conditions found on the bank page. `null` means "not found", never "no". */
export interface ProductTerms {
  minAmount: Partial<Record<Currency, number>> | null;
  topUp: boolean | null;
  partialWithdrawal: boolean | null;
  earlyWithdrawal: EarlyWithdrawal | null;
  /** Verbatim page text the structured terms were read from. */
  excerpts: string[];
}

export interface ProductTermsRow extends ProductTerms {
  bankSlug: string;
  productKey: string;
  sourceUrl: string;
  lastVerifiedAt: string;
}

export interface PolicyPoint {
  month: string;
  refinancing: number | null;
  floor: number | null;
  ceiling: number | null;
}

export interface ChangeEvent {
  id: number;
  kind: 'rate_change' | 'new_product' | 'conditions_change' | 'indicator' | 'report';
  bankSlug: string | null;
  currency: Currency | null;
  details: Record<string, unknown>;
  createdAt: string;
}
