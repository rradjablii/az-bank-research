import { describe, expect, it } from 'vitest';
import * as S from '../shared/stats';
import { earlyExit, reinvestedValue, simulateDeposit } from '../shared/finance';
import { combine, computeIndex, DEFAULT_WEIGHTS, reweight, sensitivity, type IndexInput } from '../shared/index-score';
import { dataConfidence } from '../shared/confidence';
import { selectOffers } from '../shared/selection';
import { offerRow } from './helpers';

const A = [10.1, 9.8, 10.4, 9.9, 10.2, 10.0, 10.3, 9.7, 10.5, 9.6];
const B = [9.1, 9.4, 8.8, 9.0, 9.3, 8.9, 9.2, 9.5, 8.7, 9.6];

describe('association, shape and tests', () => {
  it('computes sample covariance', () => {
    expect(S.covariance([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(10 / 3, 12);
    expect(S.covariance([1], [2])).toBeNull();
  });
  it('measures skewness, kurtosis and Jarque–Bera', () => {
    expect(S.shape([1, 2, 3, 4, 5])!.skewness).toBeCloseTo(0, 12);
    expect(S.shape([1, 2, 3, 4, 5])!.excessKurtosis).toBeCloseTo(-1.3, 12);
    expect(S.shape([1, 1, 1, 10])!.skewness).toBeGreaterThan(1);
    expect(S.shape([4, 4, 4])).toBeNull();
    const jb = S.jarqueBera([1, 2, 3, 4, 5])!;
    expect(jb.statistic).toBeCloseTo((5 / 6) * (1.69 / 4), 10);
    expect(jb.p).toBeCloseTo(Math.exp(-jb.statistic / 2), 12);
    expect(jb.reliable).toBe(false);
  });
  it('runs a one-sample t test', () => {
    // mean 10.05, s = 0.3028, n = 10 → t = (10.05 − 10) / (s/√10)
    const r = S.oneSampleT(A, 10)!;
    expect(r.t).toBeCloseTo(0.05 / (S.stdDev(A, 1)! / Math.sqrt(10)), 10);
    expect(r.p).toBeGreaterThan(0.5);
    expect(S.oneSampleT(A, 9)!.p).toBeLessThan(0.001);
    expect(S.oneSampleT(A.slice(0, 5), 9)).toBeNull();
  });
  it('runs Welch and Mann–Whitney, refusing small groups', () => {
    const w = S.welchT(A, B)!;
    expect(w.meanA - w.meanB).toBeCloseTo(0.9, 10);
    expect(w.p).toBeLessThan(0.001);
    expect(S.welchT(A, A)!.p).toBeCloseTo(1, 8);
    const u = S.mannWhitney(A, B)!;
    expect(u.u).toBe(99.5); // all A above all B except one tie at 9.6
    expect(u.p).toBeLessThan(0.001);
    expect(S.mannWhitney(A, A)!.p).toBeGreaterThan(0.9);
    expect(S.welchT(A, B.slice(0, 3))).toBeNull();
    expect(S.mannWhitney([1], [2])).toBeNull();
  });
  it('matches normal CDF reference values', () => {
    expect(S.normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(S.normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(S.normalCdf(-1.959964)).toBeCloseTo(0.025, 5);
  });
  it('computes conditional probability', () => {
    const rows = [{ t: 12, r: 9 }, { t: 24, r: 11 }, { t: 24, r: 12 }, { t: 24, r: 8 }];
    expect(S.conditionalProbability(rows, (x) => x.r > 10, (x) => x.t === 24)).toEqual({ favourable: 2, total: 3, p: 2 / 3, unconditional: 0.5 });
    expect(S.conditionalProbability(rows, () => true, (x) => x.t === 36)).toBeNull();
  });
});

describe('decision support', () => {
  const base = { principal: 10_000, annualRate: 12, months: 12, currency: 'AZN' as const, tax: 'none' as const };
  it('compounds reinvested payouts at the assumed rate', () => {
    const flows = simulateDeposit({ ...base, method: 'monthly_payout' }).flows;
    expect(reinvestedValue(10_000, flows, 0).value).toBeCloseTo(11_200, 8);
    // Reinvesting at the same 12% reproduces monthly compounding.
    expect(reinvestedValue(10_000, flows, 12).value).toBeCloseTo(10_000 * 1.01 ** 12, 6);
    expect(reinvestedValue(10_000, flows, 12).extra).toBeCloseTo(10_000 * 1.01 ** 12 - 11_200, 6);
  });
  it('applies stated early-withdrawal conditions', () => {
    const tiers = { type: 'retained_share' as const, unit: 'days' as const, tiers: [{ from: 0, to: 90, retainedPct: 0 }, { from: 91, to: null, retainedPct: 20 }] };
    expect(earlyExit(10_000, 12, 12, 2, 'at_maturity', 'AZN', tiers)!.proceeds).toBe(10_000);
    expect(earlyExit(10_000, 12, 12, 6, 'at_maturity', 'AZN', tiers)!.proceeds).toBeCloseTo(10_120, 8);
    // Interest already paid monthly is taken back from principal.
    expect(earlyExit(10_000, 12, 12, 6, 'monthly_payout', 'AZN', tiers)!.clawback).toBeCloseTo(480, 8);
    expect(earlyExit(10_000, 12, 12, 6, 'at_maturity', 'AZN', { type: 'forfeit' })!.interest).toBe(0);
    expect(earlyExit(10_000, 12, 12, 6, 'at_maturity', 'AZN', { type: 'reduced_rate', rates: { AZN: 0.5 } })!.interest).toBeCloseTo(25, 8);
    expect(earlyExit(10_000, 12, 12, 6, 'at_maturity', 'USD', { type: 'reduced_rate', rates: { AZN: 0.5 } })).toBeNull();
    expect(earlyExit(10_000, 12, 24, 6, 'at_maturity', 'AZN', { type: 'retained_share', unit: 'term_percent', tiers: [{ from: 0, to: 49.999, retainedPct: 0 }, { from: 50, to: null, retainedPct: 20 }] })!.interest).toBe(0);
    expect(earlyExit(10_000, 12, 12, 6, 'at_maturity', 'AZN', null)).toBeNull();
    expect(earlyExit(10_000, 12, 12, 12, 'at_maturity', 'AZN', tiers)).toBeNull();
  });
});

describe('bank intelligence index', () => {
  const banks = ['a', 'b', 'c', 'd'];
  const input: IndexInput = {
    rates: banks.map((slug, i) => offerRow({ bankSlug: slug, rate: 8 + i })),
    terms: [{ bankSlug: 'd', productKey: 'term', minAmount: { AZN: 100 }, topUp: true, partialWithdrawal: true, earlyWithdrawal: { type: 'forfeit' }, excerpts: [], sourceUrl: 'https://x.az', lastVerifiedAt: '' }],
    history: {},
    inflation: { value: 5, month: '2026-09-01' },
  };

  it('scores components and marks missing history as provisional', () => {
    const scores = computeIndex(input);
    expect(scores.map((s) => s.bankSlug)[0]).toBe('d');
    const d = scores[0]!;
    expect(d.components.competitiveness.score).toBeCloseTo(87.5, 8);
    expect(d.components.stability.score).toBeNull();
    expect(d.components.flexibility.score).toBe(40);
    expect(d.provisional).toBe(true);
    expect(d.coverage).toBeCloseTo(0.8, 8);
    // Banks with no documented conditions have no flexibility score, not zero.
    expect(scores.find((s) => s.bankSlug === 'a')!.components.flexibility.score).toBeNull();
    expect(d.score!).toBeGreaterThanOrEqual(0);
    expect(d.score!).toBeLessThanOrEqual(100);
  });
  it('uses the observed history for stability once long enough', () => {
    const history = { a: { days: 60, series: 2, changes: 0, meanAbsChange: 0 }, b: { days: 60, series: 1, changes: 2, meanAbsChange: 1 } };
    const scores = computeIndex({ ...input, history });
    const get = (s: string) => scores.find((x) => x.bankSlug === s)!.components.stability.score;
    expect(get('a')).toBe(100);
    expect(get('b')).toBeCloseTo(0, 8);
    expect(computeIndex({ ...input, history: { a: { days: 10, series: 1, changes: 0, meanAbsChange: 0 } } }).every((s) => s.components.stability.score === null)).toBe(true);
  });
  it('excludes campaigns and unreviewed values', () => {
    const polluted = computeIndex({ ...input, rates: [...input.rates, offerRow({ bankSlug: 'a', rate: 20, variant: 'campaign' }), offerRow({ bankSlug: 'a', rate: 22, verification: 'pending_review' })] });
    expect(polluted.find((s) => s.bankSlug === 'a')!.components.competitiveness.score).toBeCloseTo(12.5, 8);
    expect(selectOffers([offerRow({ verification: 'pending_review' })], { productType: 'term_deposit', currency: 'AZN', term: 12, payout: 'at_maturity', includeCampaigns: false, includeUninsured: false, perBank: true })).toEqual([]);
  });
  it('refuses to score below minimum coverage and renormalises weights', () => {
    const none = { score: null, inputs: {} };
    const full = { score: 80, inputs: {} };
    expect(combine({ competitiveness: full, stability: none, flexibility: none, transparency: none, realReturn: none }, DEFAULT_WEIGHTS).score).toBeNull();
    expect(combine({ competitiveness: full, stability: none, flexibility: full, transparency: full, realReturn: full }, DEFAULT_WEIGHTS).score).toBeCloseTo(80, 8);
  });
  it('re-weights and reports reproducible rank sensitivity', () => {
    const scores = computeIndex(input);
    const onlyFlex = reweight(scores, { competitiveness: 0, stability: 0, flexibility: 100, transparency: 0, realReturn: 0 });
    expect(onlyFlex[0]!.score).toBe(40);
    const a = sensitivity(scores);
    expect(a).toEqual(sensitivity(scores));
    expect(a.get('d')!.best).toBe(1);
    expect(a.get('a')!.worst).toBeLessThanOrEqual(4);
  });
  it('keeps data confidence separate and bounded', () => {
    const c = dataConfidence({ kind: 'official_statistics', records: 10, validatedShare: 1, hoursSinceSuccess: 1, staleAfterHours: 48, completeness: 1, historyDays: 900 })!;
    expect(c.score).toBe(100);
    const old = dataConfidence({ kind: 'bank_website', records: 10, validatedShare: 0.5, hoursSinceSuccess: 48 * 4, staleAfterHours: 48, completeness: 0, historyDays: 0 })!;
    expect(old.parts.recency).toBe(0);
    expect(old.score).toBeCloseTo(0.25 * 80 + 0.25 * 50, 8);
    expect(dataConfidence({ kind: 'bank_website', records: 0, validatedShare: 0, hoursSinceSuccess: null, staleAfterHours: 48, completeness: 0, historyDays: 0 })).toBeNull();
  });
});
