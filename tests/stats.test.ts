import { describe as suite, expect, it } from 'vitest';
import * as S from '../shared/stats';
import { selectOffers } from '../shared/selection';
import type { RateRow } from '../shared/types';
import { offerRow } from './helpers';

const X = [2, 4, 4, 4, 5, 5, 7, 9];

suite('descriptive statistics', () => {
  it('matches hand-computed values', () => {
    const d = S.describe(X);
    expect(d).toMatchObject({ n: 8, missing: 0, mean: 5, median: 4.5, min: 2, max: 9, range: 7, variancePop: 4, sdPop: 2, q1: 4 });
    expect(d.varianceSample).toBeCloseTo(32 / 7, 12);
    expect(d.sdSample).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(d.q3).toBe(5.5);
    expect(d.iqr).toBe(1.5);
    expect(d.cv).toBeCloseTo(Math.sqrt(32 / 7) / 5, 12);
    expect(d.mode).toEqual({ values: [4], count: 3 });
  });
  it('handles empty, single and missing values', () => {
    expect(S.describe([])).toMatchObject({ n: 0, mean: null, median: null, min: null, range: null, varianceSample: null, cv: null });
    expect(S.describe([7])).toMatchObject({ n: 1, variancePop: 0, varianceSample: null, sdSample: null });
    expect(S.describe([1, null, undefined, NaN, 3])).toMatchObject({ n: 2, missing: 3, mean: 2 });
  });
  it('reports no mode when nothing repeats and several when tied', () => {
    expect(S.modes([1, 2, 3]).values).toEqual([]);
    expect(S.modes([1, 1, 2, 2, 3]).values).toEqual([1, 2]);
  });
  it('interpolates percentiles like Excel PERCENTILE.INC', () => {
    expect(S.percentile([1, 2, 3, 4], 25)).toBe(1.75);
    expect(S.percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(S.percentile([1, 2, 3, 4], 100)).toBe(4);
    expect(S.percentile([1], 101)).toBeNull();
  });
  it('flags Tukey outliers only with enough data', () => {
    const f = S.outlierFences([9, 9.5, 10, 10, 10.5, 25])!;
    expect(25).toBeGreaterThan(f.upper);
    expect(9).toBeGreaterThanOrEqual(f.lower);
    expect(S.outlierFences([1, 2, 3])).toBeNull();
  });
});

suite('frequency and probability', () => {
  it('bins every observation exactly once', () => {
    const bins = S.histogram([8.5, 9, 9, 9.5, 10, 10.25], 0.5);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(6);
    expect(bins.at(-1)!.cumulative).toBe(1);
    expect(bins[0]).toMatchObject({ from: 8.5, count: 1 });
    expect(S.histogram([5, 5, 5]).map((b) => b.count)).toEqual([3]);
    expect(S.histogram([])).toEqual([]);
  });
  it('computes empirical probabilities with strict / inclusive bounds', () => {
    const v = [8, 9, 10, 10.5, 11];
    expect(S.probAbove(v, 10)).toEqual({ favourable: 2, total: 5, p: 0.4 });
    expect(S.probBetween(v, 10, 9)!.favourable).toBe(2);
    expect(S.probAboveMedian(v)!.p).toBe(0.4);
    expect(S.probAbove([], 1)).toBeNull();
  });
  it('ranks and computes percentile ranks', () => {
    expect(S.rank([10, 9, 10, 8])).toEqual([1, 3, 1, 4]);
    expect(S.percentileRank([1, 2, 3, 4], 3)).toBe(62.5);
  });
});

suite('inference', () => {
  it('reproduces Student t critical values', () => {
    expect(S.tQuantile(0.975, 1)).toBeCloseTo(12.7062, 3);
    expect(S.tQuantile(0.975, 10)).toBeCloseTo(2.228139, 5);
    expect(S.tQuantile(0.975, 100)).toBeCloseTo(1.983972, 5);
    expect(S.tCdf(0, 7)).toBeCloseTo(0.5, 12);
  });
  it('builds a t confidence interval', () => {
    const ci = S.confidenceInterval(X)!;
    const half = 2.364624 * Math.sqrt(32 / 7 / 8);
    expect(ci.lower).toBeCloseTo(5 - half, 4);
    expect(ci.upper).toBeCloseTo(5 + half, 4);
    expect(S.confidenceInterval([1])).toBeNull();
  });
  it('fits a line and requires enough paired observations', () => {
    const x = Array.from({ length: 10 }, (_, i) => i);
    const y = x.map((v) => 3 + 2 * v);
    expect(S.correlation(x, y)!.r).toBeCloseTo(1, 12);
    expect(S.linearRegression(x, y)).toMatchObject({ slope: 2, intercept: 3, r2: 1, n: 10 });
    expect(S.correlation(x.slice(0, 7), y.slice(0, 7))).toBeNull();
    expect(S.correlation(x, x.map(() => 4))).toBeNull();
    expect(S.pairs([1, null, 3], [4, 5, undefined])).toEqual([[1, 4]]);
  });
});

suite('comparability of offers', () => {
  const rows: RateRow[] = [
    offerRow({ bankSlug: 'a', rate: 9 }),
    offerRow({ bankSlug: 'a', rate: 10, productKey: 'other' }),
    offerRow({ bankSlug: 'a', rate: 12, variant: 'campaign' }),
    offerRow({ bankSlug: 'b', rate: 8, termMin: 12, termMax: 17 }),
    offerRow({ bankSlug: 'c', rate: 3, currency: 'USD' }),
    offerRow({ bankSlug: 'd', rate: 11, termMin: 24, termMax: 24 }),
    offerRow({ bankSlug: 'e', rate: 7, payout: 'monthly' }),
  ];
  const base = { productType: 'term_deposit', currency: 'AZN', term: 12, payout: 'at_maturity', includeCampaigns: false, includeUninsured: false, perBank: true } as const;

  it('never mixes currency, term, payout or campaigns', () => {
    expect(selectOffers(rows, base).map((r) => [r.bankSlug, r.rate])).toEqual([['a', 10], ['b', 8]]);
  });
  it('can include campaigns and every offer', () => {
    expect(selectOffers(rows, { ...base, includeCampaigns: true, perBank: false }).map((r) => r.rate)).toEqual([12, 10, 9, 8]);
  });
  it('keeps the cheapest loan per bank', () => {
    const loans = [5, 9].map((rate) => offerRow({ category: 'loan', productType: 'consumer_loan', termMin: null, termMax: 60, payout: 'unspecified', rate }));
    expect(selectOffers(loans, { ...base, productType: 'consumer_loan', term: null }).map((r) => r.rate)).toEqual([5]);
  });
});
