import { coversTerm } from './selection.js';
import { percentileRank } from './stats.js';
import { realRate } from './finance.js';
import { CURRENCIES, type ProductTermsRow, type RateRow } from './types.js';

/**
 * AZFI Bank Intelligence Index: how competitive a bank's advertised deposit
 * products are under a published method. It says nothing about solvency,
 * creditworthiness or deposit safety.
 */
export const METHODOLOGY_VERSION = '1.0';

export const COMPONENTS = ['competitiveness', 'stability', 'flexibility', 'transparency', 'realReturn'] as const;
export type Component = (typeof COMPONENTS)[number];
export type Weights = Record<Component, number>;

export const DEFAULT_WEIGHTS: Weights = { competitiveness: 35, stability: 20, flexibility: 15, transparency: 15, realReturn: 15 };

/** Below this share of total weight a bank is not scored at all. */
export const MIN_COVERAGE = 0.5;
export const STABILITY_MIN_DAYS = 30;
export const MIN_SEGMENT_BANKS = 4;
const SEGMENT_TERMS = [3, 6, 12, 24, 36];
export const REAL_FLOOR = -5;
export const REAL_CAP = 5;

export interface ComponentResult {
  score: number | null;
  /** Machine-readable evidence, rendered into an explanation by the UI. */
  inputs: Record<string, number | string | null>;
}

export interface BankScore {
  bankSlug: string;
  bankName: string;
  score: number | null;
  coverage: number;
  provisional: boolean;
  components: Record<Component, ComponentResult>;
}

export interface HistoryStats {
  /** Days between the first and latest observation of the bank. */
  days: number;
  /** Number of comparable rate series observed. */
  series: number;
  /** Number of validated rate changes across those series. */
  changes: number;
  meanAbsChange: number;
}

export interface IndexInput {
  rates: RateRow[];
  terms: ProductTermsRow[];
  history: Record<string, HistoryStats>;
  inflation: { value: number; month: string } | null;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Rates that may enter the index: standard, validated term deposits. */
export const eligibleRates = (rates: RateRow[]) =>
  rates.filter((r) => r.productType === 'term_deposit' && r.variant === 'standard' && (r.verification === 'auto_validated' || r.verification === 'approved' || r.verification === 'corrected'));

/** Percentile rank of each bank's best rate inside every comparable segment. */
export function segmentRanks(rates: RateRow[]) {
  const out = new Map<string, { segment: string; percentile: number; rate: number; banks: number }[]>();
  for (const currency of CURRENCIES) {
    for (const term of SEGMENT_TERMS) {
      for (const payout of ['at_maturity', 'monthly'] as const) {
        const best = new Map<string, number>();
        for (const r of rates) {
          if (r.currency !== currency || r.payout !== payout || !coversTerm(r, term)) continue;
          best.set(r.bankSlug, Math.max(r.rate, best.get(r.bankSlug) ?? 0));
        }
        if (best.size < MIN_SEGMENT_BANKS) continue;
        const values = [...best.values()];
        for (const [bank, rate] of best) {
          const list = out.get(bank) ?? [];
          list.push({ segment: `${currency} ${term}m ${payout}`, percentile: percentileRank(values, rate)!, rate, banks: best.size });
          out.set(bank, list);
        }
      }
    }
  }
  return out;
}

function stability(h: HistoryStats | undefined): ComponentResult {
  if (!h || h.days < STABILITY_MIN_DAYS) return { score: null, inputs: { days: h?.days ?? 0, required: STABILITY_MIN_DAYS } };
  // Changes per series per 30 days, weighted by their average size in points.
  const intensity = (h.changes / Math.max(1, h.series)) * (30 / h.days) * h.meanAbsChange;
  return { score: clamp(100 * (1 - intensity)), inputs: { days: h.days, series: h.series, changes: h.changes, meanAbsChange: h.meanAbsChange } };
}

/** Points: partial withdrawal (40) and interest kept on early closure after ~half a year (60). */
function flexibility(terms: ProductTermsRow[]): ComponentResult {
  const documented = terms.filter((t) => t.earlyWithdrawal !== null || t.partialWithdrawal !== null);
  if (!documented.length) return { score: null, inputs: { documentedProducts: 0 } };
  const points = documented.map((t) => {
    let retained = 0;
    const e = t.earlyWithdrawal;
    if (e?.type === 'retained_share') {
      const position = e.unit === 'days' ? 200 : 60;
      retained = e.tiers.find((x) => position >= x.from && (x.to === null || position <= x.to))?.retainedPct ?? 0;
    }
    return (t.partialWithdrawal ? 40 : 0) + retained * 0.6;
  });
  return {
    score: clamp(Math.max(...points)),
    inputs: { documentedProducts: documented.length, partialWithdrawal: documented.some((t) => t.partialWithdrawal) ? 'yes' : 'not stated', bestPoints: Math.max(...points) },
  };
}

/** Share of a fixed checklist found on the pages this platform collects. */
function transparency(rates: RateRow[], terms: ProductTermsRow[]): ComponentResult {
  if (!rates.length) return { score: null, inputs: {} };
  const checks = {
    termTable: rates.some((r) => r.termMin !== null),
    payoutOptions: new Set(rates.map((r) => r.payout)).size > 1,
    publicationDate: rates.some((r) => r.observedDate !== null),
    minimumAmount: terms.some((t) => t.minAmount !== null) || rates.some((r) => r.amountMin !== null),
    earlyWithdrawal: terms.some((t) => t.earlyWithdrawal !== null),
    topUpRule: terms.some((t) => t.topUp !== null),
  };
  const found = Object.values(checks).filter(Boolean).length;
  return {
    score: (100 * found) / Object.keys(checks).length,
    inputs: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v ? 'found' : 'not found'])),
  };
}

function realReturn(rates: RateRow[], inflation: IndexInput['inflation']): ComponentResult {
  const best = rates.filter((r) => r.currency === 'AZN' && r.payout === 'at_maturity' && coversTerm(r, 12));
  if (!best.length || !inflation) return { score: null, inputs: {} };
  const rate = Math.max(...best.map((r) => r.rate));
  const real = realRate(rate, inflation.value);
  return { score: clamp((100 * (real - REAL_FLOOR)) / (REAL_CAP - REAL_FLOOR)), inputs: { rate, inflation: inflation.value, month: inflation.month, real } };
}

/** Weighted mean over available components, with weights renormalised. */
export function combine(components: Record<Component, ComponentResult>, weights: Weights) {
  const total = COMPONENTS.reduce((s, c) => s + weights[c], 0);
  const available = COMPONENTS.filter((c) => components[c].score !== null && weights[c] > 0);
  const covered = available.reduce((s, c) => s + weights[c], 0);
  const coverage = total ? covered / total : 0;
  const score = coverage >= MIN_COVERAGE && covered ? available.reduce((s, c) => s + components[c].score! * weights[c], 0) / covered : null;
  return { score, coverage, provisional: coverage < 0.999 };
}

export function computeIndex(input: IndexInput, weights: Weights = DEFAULT_WEIGHTS): BankScore[] {
  const rates = eligibleRates(input.rates);
  const ranks = segmentRanks(rates);
  const banks = new Map(rates.map((r) => [r.bankSlug, r.bankName]));
  return [...banks]
    .map(([bankSlug, bankName]) => {
      const own = rates.filter((r) => r.bankSlug === bankSlug);
      const keys = new Set(own.map((r) => r.productKey));
      const terms = input.terms.filter((t) => t.bankSlug === bankSlug && keys.has(t.productKey));
      const segments = ranks.get(bankSlug) ?? [];
      const components: Record<Component, ComponentResult> = {
        competitiveness: segments.length
          ? { score: avg(segments.map((s) => s.percentile)), inputs: { segments: segments.length, example: segments[0]!.segment, exampleRate: segments[0]!.rate } }
          : { score: null, inputs: { segments: 0 } },
        stability: stability(input.history[bankSlug]),
        flexibility: flexibility(terms),
        transparency: transparency(own, terms),
        realReturn: realReturn(own, input.inflation),
      };
      return { bankSlug, bankName, components, ...combine(components, weights) };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.bankName.localeCompare(b.bankName));
}

/** Re-ranks existing component scores under other weights. */
export function reweight(scores: BankScore[], weights: Weights): BankScore[] {
  return scores
    .map((s) => ({ ...s, ...combine(s.components, weights) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.bankName.localeCompare(b.bankName));
}

/** Deterministic pseudo-random generator so sensitivity results are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rank range of every bank when each weight is independently scaled by a random
 * factor in [0.5, 1.5].
 */
export function sensitivity(scores: BankScore[], trials = 500, seed = 7) {
  const random = mulberry32(seed);
  const ranks = new Map<string, number[]>(scores.filter((s) => s.score !== null).map((s) => [s.bankSlug, []]));
  for (let i = 0; i < trials; i++) {
    const weights = Object.fromEntries(COMPONENTS.map((c) => [c, DEFAULT_WEIGHTS[c] * (0.5 + random())])) as Weights;
    reweight(scores, weights)
      .filter((s) => s.score !== null)
      .forEach((s, index) => ranks.get(s.bankSlug)?.push(index + 1));
  }
  return new Map(
    [...ranks].map(([bank, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return [bank, { best: sorted[0]!, worst: sorted.at(-1)!, median: sorted[Math.floor(sorted.length / 2)]! }];
    }),
  );
}
