/**
 * Pure descriptive and inferential statistics. All functions ignore
 * null/undefined/non-finite inputs and return null when a quantity is undefined
 * for the sample size supplied.
 */
export type Maybe = number | null | undefined;

export function clean(values: readonly Maybe[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

const sortedCopy = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

export function mean(values: readonly Maybe[]): number | null {
  const xs = clean(values);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/** Percentile, p in [0,100], linear interpolation (Hyndman–Fan type 7, Excel PERCENTILE.INC). */
export function percentile(values: readonly Maybe[], p: number): number | null {
  const xs = sortedCopy(clean(values));
  if (!xs.length || !(p >= 0 && p <= 100)) return null;
  const h = ((xs.length - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return xs[lo]! + (h - lo) * (xs[hi]! - xs[lo]!);
}

export const median = (values: readonly Maybe[]) => percentile(values, 50);

export function quartiles(values: readonly Maybe[]) {
  const q1 = percentile(values, 25);
  const q2 = percentile(values, 50);
  const q3 = percentile(values, 75);
  return q1 === null || q2 === null || q3 === null ? null : { q1, q2, q3, iqr: q3 - q1 };
}

/** All most frequent values (at 4 dp). Empty when no value repeats — mode is then not meaningful. */
export function modes(values: readonly Maybe[]): { values: number[]; count: number } {
  const counts = new Map<number, number>();
  for (const x of clean(values)) {
    const k = Math.round(x * 1e4) / 1e4;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  if (top < 2) return { values: [], count: 0 };
  return { values: sortedCopy([...counts].filter(([, c]) => c === top).map(([v]) => v)), count: top };
}

/** ddof = 0 → population variance; ddof = 1 → sample variance. */
export function variance(values: readonly Maybe[], ddof: 0 | 1): number | null {
  const xs = clean(values);
  if (xs.length <= ddof) return null;
  const m = mean(xs)!;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - ddof);
}

export function stdDev(values: readonly Maybe[], ddof: 0 | 1): number | null {
  const v = variance(values, ddof);
  return v === null ? null : Math.sqrt(v);
}

/** Sample coefficient of variation (s / mean), as a ratio. */
export function coefficientOfVariation(values: readonly Maybe[]): number | null {
  const s = stdDev(values, 1);
  const m = mean(values);
  return s === null || m === null || m === 0 ? null : s / Math.abs(m);
}

export function describe(values: readonly Maybe[]) {
  const xs = clean(values);
  const n = xs.length;
  const min = n ? Math.min(...xs) : null;
  const max = n ? Math.max(...xs) : null;
  const q = quartiles(xs);
  return {
    n,
    missing: values.length - n,
    mean: mean(xs),
    median: median(xs),
    mode: modes(xs),
    min,
    max,
    range: n ? max! - min! : null,
    variancePop: variance(xs, 0),
    varianceSample: variance(xs, 1),
    sdPop: stdDev(xs, 0),
    sdSample: stdDev(xs, 1),
    cv: coefficientOfVariation(xs),
    q1: q?.q1 ?? null,
    q3: q?.q3 ?? null,
    iqr: q?.iqr ?? null,
  };
}

/** Tukey fences (Q1 − k·IQR, Q3 + k·IQR). Needs at least 4 observations. */
export function outlierFences(values: readonly Maybe[], k = 1.5) {
  const xs = clean(values);
  const q = quartiles(xs);
  if (!q || xs.length < 4) return null;
  return { lower: q.q1 - k * q.iqr, upper: q.q3 + k * q.iqr };
}

export interface Bin {
  from: number;
  to: number;
  count: number;
  relative: number;
  cumulative: number;
}

/**
 * Equal-width frequency distribution. Bins are [from, to) except the last, which
 * is closed. Default width: Freedman–Diaconis, falling back to Sturges, rounded
 * up to a "nice" step.
 */
export function histogram(values: readonly Maybe[], width?: number): Bin[] {
  const xs = sortedCopy(clean(values));
  if (!xs.length) return [];
  const min = xs[0]!;
  const max = xs[xs.length - 1]!;
  let w = width;
  if (!w || w <= 0) {
    const iqr = quartiles(xs)!.iqr;
    let raw = (2 * iqr) / Math.cbrt(xs.length);
    if (!raw) raw = (max - min) / Math.ceil(Math.log2(xs.length) + 1);
    w = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20].find((s) => s >= raw) ?? Math.ceil(raw);
  }
  const start = Math.floor(min / w + 1e-9) * w;
  const count = Math.max(1, Math.ceil((max - start) / w - 1e-9));
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    from: round(start + i * w!),
    to: round(start + (i + 1) * w!),
    count: 0,
    relative: 0,
    cumulative: 0,
  }));
  for (const x of xs) bins[Math.min(count - 1, Math.max(0, Math.floor((x - start) / w + 1e-9)))]!.count++;
  let acc = 0;
  for (const b of bins) {
    acc += b.count;
    b.relative = b.count / xs.length;
    b.cumulative = acc / xs.length;
  }
  return bins;
}

export interface Probability {
  favourable: number;
  total: number;
  p: number;
}

/** Empirical probability: share of observations satisfying the predicate. */
export function probability(values: readonly Maybe[], pred: (x: number) => boolean): Probability | null {
  const xs = clean(values);
  if (!xs.length) return null;
  const favourable = xs.filter(pred).length;
  return { favourable, total: xs.length, p: favourable / xs.length };
}

export const probAbove = (v: readonly Maybe[], t: number) => probability(v, (x) => x > t);
export const probBetween = (v: readonly Maybe[], a: number, b: number) =>
  probability(v, (x) => x >= Math.min(a, b) && x <= Math.max(a, b));
export const probAboveMedian = (v: readonly Maybe[]) => {
  const m = median(v);
  return m === null ? null : probAbove(v, m);
};

/** Mid-rank percentile of x within the sample, 0–100. */
export function percentileRank(values: readonly Maybe[], x: number): number | null {
  const xs = clean(values);
  if (!xs.length) return null;
  const below = xs.filter((v) => v < x).length;
  const equal = xs.filter((v) => v === x).length;
  return (100 * (below + 0.5 * equal)) / xs.length;
}

/** Competition ranking (1,2,2,4). Highest first by default. */
export function rank(values: readonly number[], descending = true): number[] {
  return values.map((v) => 1 + values.filter((o) => (descending ? o > v : o < v)).length);
}

// ---- Student t distribution -------------------------------------------------

function logGamma(z: number): number {
  const c = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  c.forEach((v, i) => (a += v / (x + i + 1)));
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    for (const aa of [
      (m * (b - m) * x) / ((a - 1 + m2) * (a + m2)),
      (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2)),
    ]) {
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-14) break;
  }
  return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function tCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - tail : tail;
}

/** Inverse CDF of Student t (bisection). */
export function tQuantile(p: number, df: number): number {
  let lo = -1000;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Two-sided t interval for the mean. Assumes i.i.d. observations. */
export function confidenceInterval(values: readonly Maybe[], level = 0.95) {
  const xs = clean(values);
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const se = stdDev(xs, 1)! / Math.sqrt(xs.length);
  const t = tQuantile(1 - (1 - level) / 2, xs.length - 1);
  return { mean: m, se, t, df: xs.length - 1, lower: m - t * se, upper: m + t * se, level };
}

// ---- Bivariate --------------------------------------------------------------

export const MIN_PAIRS = 8;

export function pairs(x: readonly Maybe[], y: readonly Maybe[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i];
    const b = y[i];
    if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
  }
  return out;
}

function sums(p: [number, number][]) {
  const mx = mean(p.map((d) => d[0]))!;
  const my = mean(p.map((d) => d[1]))!;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [a, b] of p) {
    sxx += (a - mx) ** 2;
    syy += (b - my) ** 2;
    sxy += (a - mx) * (b - my);
  }
  return { mx, my, sxx, syy, sxy };
}

/** Pearson r. Null with fewer than MIN_PAIRS pairs or a constant series. */
export function correlation(x: readonly Maybe[], y: readonly Maybe[]) {
  const p = pairs(x, y);
  if (p.length < MIN_PAIRS) return null;
  const { sxx, syy, sxy } = sums(p);
  if (sxx <= 1e-12 || syy <= 1e-12) return null;
  return { r: sxy / Math.sqrt(sxx * syy), n: p.length };
}

/** Ordinary least squares y = intercept + slope·x. */
export function linearRegression(x: readonly Maybe[], y: readonly Maybe[]) {
  const p = pairs(x, y);
  if (p.length < MIN_PAIRS) return null;
  const { mx, my, sxx, syy, sxy } = sums(p);
  if (sxx <= 1e-12) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = p.reduce((s, [a, b]) => s + (b - intercept - slope * a) ** 2, 0);
  const r2 = syy <= 1e-12 ? 0 : 1 - sse / syy;
  const slopeSe = Math.sqrt(sse / (p.length - 2) / sxx);
  return { slope, intercept, r2, slopeSe, n: p.length };
}

export function differences(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

// ---- Association --------------------------------------------------------------

/** Sample covariance (ddof = 1) of paired observations. */
export function covariance(x: readonly Maybe[], y: readonly Maybe[]): number | null {
  const p = pairs(x, y);
  if (p.length < 2) return null;
  return sums(p).sxy / (p.length - 1);
}

// ---- Shape and normality ------------------------------------------------------

function centralMoment(xs: number[], k: number) {
  const m = mean(xs)!;
  return xs.reduce((s, x) => s + (x - m) ** k, 0) / xs.length;
}

/** Moment skewness and excess kurtosis (population form). */
export function shape(values: readonly Maybe[]) {
  const xs = clean(values);
  if (xs.length < 3) return null;
  const m2 = centralMoment(xs, 2);
  if (m2 <= 1e-12) return null;
  return { skewness: centralMoment(xs, 3) / m2 ** 1.5, excessKurtosis: centralMoment(xs, 4) / m2 ** 2 - 3, n: xs.length };
}

/**
 * Jarque–Bera normality statistic; p from χ²(2) = exp(−JB/2). The approximation
 * is asymptotic, so small samples are flagged as unreliable.
 */
export function jarqueBera(values: readonly Maybe[]) {
  const s = shape(values);
  if (!s) return null;
  const statistic = (s.n / 6) * (s.skewness ** 2 + s.excessKurtosis ** 2 / 4);
  return { statistic, p: Math.exp(-statistic / 2), n: s.n, reliable: s.n >= 30 };
}

// ---- Hypothesis tests ---------------------------------------------------------

export const MIN_TEST_N = 8;
const twoSidedT = (t: number, df: number) => 2 * (1 - tCdf(Math.abs(t), df));

/** H0: population mean = mu0. */
export function oneSampleT(values: readonly Maybe[], mu0: number) {
  const xs = clean(values);
  const s = stdDev(xs, 1);
  if (xs.length < MIN_TEST_N || !s) return null;
  const t = (mean(xs)! - mu0) / (s / Math.sqrt(xs.length));
  return { t, df: xs.length - 1, p: twoSidedT(t, xs.length - 1), n: xs.length, mean: mean(xs)! };
}

/** Welch's unequal-variance t-test. H0: equal means. */
export function welchT(a: readonly Maybe[], b: readonly Maybe[]) {
  const x = clean(a);
  const y = clean(b);
  if (x.length < MIN_TEST_N || y.length < MIN_TEST_N) return null;
  const vx = variance(x, 1)! / x.length;
  const vy = variance(y, 1)! / y.length;
  if (vx + vy <= 1e-15) return null;
  const t = (mean(x)! - mean(y)!) / Math.sqrt(vx + vy);
  const df = (vx + vy) ** 2 / (vx ** 2 / (x.length - 1) + vy ** 2 / (y.length - 1));
  return { t, df, p: twoSidedT(t, df), meanA: mean(x)!, meanB: mean(y)!, nA: x.length, nB: y.length };
}

export function normalCdf(z: number): number {
  // Complementary error function, Numerical Recipes rational approximation (|error| < 1.2e-7).
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/** Mann–Whitney U with tie-corrected normal approximation; no normality assumption. */
export function mannWhitney(a: readonly Maybe[], b: readonly Maybe[]) {
  const x = clean(a);
  const y = clean(b);
  if (x.length < MIN_TEST_N || y.length < MIN_TEST_N) return null;
  const all = [...x.map((v) => [v, 0] as const), ...y.map((v) => [v, 1] as const)].sort((p, q) => p[0] - q[0]);
  let rankSumA = 0;
  let ties = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]![0] === all[i]![0]) j++;
    const midRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (all[k]![1] === 0) rankSumA += midRank;
    ties += (j - i) ** 3 - (j - i);
    i = j;
  }
  const n = x.length + y.length;
  const u = rankSumA - (x.length * (x.length + 1)) / 2;
  const mu = (x.length * y.length) / 2;
  const sigma = Math.sqrt(((x.length * y.length) / 12) * (n + 1 - ties / (n * (n - 1))));
  if (!sigma) return null;
  const z = (u - mu - Math.sign(u - mu) * 0.5) / sigma;
  return { u, z, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))), nA: x.length, nB: y.length };
}

/** P(A | B) = #(A and B) / #B over a finite dataset; null when B never occurs. */
export function conditionalProbability<T>(rows: readonly T[], event: (r: T) => boolean, given: (r: T) => boolean) {
  const conditioned = rows.filter(given);
  if (!conditioned.length) return null;
  const favourable = conditioned.filter(event).length;
  return {
    favourable, total: conditioned.length, p: favourable / conditioned.length,
    unconditional: rows.length ? rows.filter(event).length / rows.length : 0,
  };
}
