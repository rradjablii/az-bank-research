import type { Currency, EarlyWithdrawal, Payout } from './types.js';

/**
 * Deposit mathematics. Rates are annual nominal percentages. Day-count
 * convention: 30/360 (each month = 1/12 year); banks using actual/365 will differ
 * by a few qəpik per month.
 */
export type InterestMethod = 'monthly_payout' | 'quarterly_payout' | 'at_maturity' | 'upfront' | 'compound';
export type CompoundingFrequency = 1 | 4 | 12;

export type TaxPreset = 'az_scheduled_2027' | 'az_2026' | 'flat10' | 'none';

export interface DepositInput {
  principal: number;
  annualRate: number;
  months: number;
  method: InterestMethod;
  /** Capitalisations per year, only for method = compound. */
  compounding?: CompoundingFrequency;
  currency: Currency;
  tax: TaxPreset;
}

export interface CashFlow {
  month: number;
  interest: number;
  tax: number;
  paid: number;
  balance: number;
}

export const AZN_MONTHLY_EXEMPTION = 200;
export const WITHHOLDING_RATE = 0.1;

/**
 * Tax on the interest accrued in one month, assuming this is the depositor's only
 * deposit at the bank.
 */
export function monthlyTax(accrued: number, currency: Currency, months: number, preset: TaxPreset): number {
  if (preset === 'none' || accrued <= 0) return 0;
  if (preset === 'flat10' || currency !== 'AZN') return accrued * WITHHOLDING_RATE;
  if (preset === 'az_2026' && months >= 18) return 0;
  return Math.max(0, accrued - AZN_MONTHLY_EXEMPTION) * WITHHOLDING_RATE;
}

export function payoutToMethod(p: Payout): InterestMethod {
  if (p === 'monthly') return 'monthly_payout';
  if (p === 'quarterly') return 'quarterly_payout';
  if (p === 'upfront') return 'upfront';
  return 'at_maturity';
}

export function simulateDeposit(input: DepositInput) {
  const { principal, annualRate, months, method, currency, tax } = input;
  if (!(principal > 0) || !(annualRate >= 0) || !Number.isInteger(months) || months < 1 || months > 600) {
    throw new RangeError('Invalid deposit input');
  }
  const r = annualRate / 100;
  const flows: CashFlow[] = [];
  const compoundEvery = method === 'compound' ? 12 / (input.compounding ?? 12) : 0;
  const payEvery = method === 'monthly_payout' ? 1 : method === 'quarterly_payout' ? 3 : 0;
  let balance = principal;
  let unpaid = 0;
  let totalInterest = 0;
  let totalTax = 0;

  for (let m = 1; m <= months; m++) {
    const interest = (balance * r) / 12;
    const t = monthlyTax(interest, currency, months, tax);
    totalInterest += interest;
    totalTax += t;
    unpaid += interest - t;
    let paid = 0;
    if (method === 'compound') {
      if (m % compoundEvery === 0 || m === months) {
        balance += unpaid;
        unpaid = 0;
      }
    } else if ((payEvery && m % payEvery === 0) || m === months) {
      paid = unpaid;
      unpaid = 0;
    }
    flows.push({ month: m, interest, tax: t, paid, balance });
  }

  if (method === 'upfront') {
    for (const f of flows) f.paid = 0;
    flows[0]!.paid = totalInterest - totalTax;
  }

  const netInterest = totalInterest - totalTax;
  const gross = totalInterest / principal;
  const net = netInterest / principal;
  const years = months / 12;
  return {
    flows,
    grossInterest: totalInterest,
    tax: totalTax,
    netInterest,
    maturityValue: principal + netInterest,
    grossReturn: gross,
    netReturn: net,
    /** Effective annualised returns (percent). */
    grossAnnualised: (Math.pow(1 + gross, 1 / years) - 1) * 100,
    netAnnualised: (Math.pow(1 + net, 1 / years) - 1) * 100,
  };
}

/** Fisher relation: (1 + nominal) / (1 + inflation) − 1. Inputs and output in percent. */
export function realRate(nominalPct: number, inflationPct: number): number {
  if (inflationPct <= -100) throw new RangeError('Inflation must be above -100%');
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

/** Real value of a nominal maturity amount after `months` of constant annual inflation. */
export function purchasingPower(amount: number, annualInflationPct: number, months: number): number {
  return amount / Math.pow(1 + annualInflationPct / 100, months / 12);
}

export function addMonths(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta, 1);
  return d.toISOString().slice(0, 10);
}

/**
 * CBAR labels a rate row with a reporting date (01.MM.YYYY); the data refer to
 * the period ending before that date, i.e. the previous calendar month.
 */
export const referenceMonth = (reportingDate: string) => addMonths(reportingDate, -1);

/**
 * Ex-post real rate: a deposit rate contracted in month t−12 deflated by the
 * 12-month inflation actually realised up to month t.
 */
export function exPostRealRates(
  rates: { month: string; rate: number }[],
  inflation: { month: string; yoy: number | null }[],
  horizonMonths = 12,
) {
  const byMonth = new Map(rates.map((r) => [r.month, r.rate]));
  return inflation.flatMap((i) => {
    const start = addMonths(i.month, -horizonMonths);
    const nominal = byMonth.get(start);
    return nominal === undefined || i.yoy === null
      ? []
      : [{ month: i.month, contractedIn: start, nominal, inflation: i.yoy, real: realRate(nominal, i.yoy) }];
  });
}

// ---- Decision support ---------------------------------------------------------

/**
 * Value at maturity when each periodic payout is reinvested at a separate annual
 * rate (monthly accrual) chosen by the user — an assumption, not a product term.
 */
export function reinvestedValue(principal: number, flows: CashFlow[], annualRate: number) {
  const r = annualRate / 100 / 12;
  const months = flows.length;
  const payouts = flows.reduce((s, f) => s + f.paid * (1 + r) ** (months - f.month), 0);
  const value = principal + payouts;
  return { value, extra: value - principal - flows.reduce((s, f) => s + f.paid, 0), effectiveAnnual: ((value / principal) ** (12 / months) - 1) * 100 };
}

export interface EarlyExit {
  /** Interest the depositor keeps (before tax). */
  interest: number;
  /** Interest already paid out that the bank takes back from principal. */
  clawback: number;
  proceeds: number;
}

/**
 * Cash received on closing after `elapsed` months, from the conditions stated on
 * the bank page. Returns null when those conditions do not cover the case.
 */
export function earlyExit(
  principal: number,
  annualRate: number,
  term: number,
  elapsed: number,
  method: InterestMethod,
  currency: Currency,
  rule: EarlyWithdrawal | null,
): EarlyExit | null {
  if (!rule || !(elapsed >= 1 && elapsed < term)) return null;
  const accrued = (principal * (annualRate / 100) * elapsed) / 12;
  const paidSoFar =
    method === 'monthly_payout' ? accrued
    : method === 'quarterly_payout' ? (principal * (annualRate / 100) * Math.floor(elapsed / 3) * 3) / 12
    : method === 'upfront' ? (principal * (annualRate / 100) * term) / 12
    : 0;
  let interest: number;
  if (rule.type === 'forfeit') interest = 0;
  else if (rule.type === 'reduced_rate') {
    const reduced = rule.rates[currency];
    if (reduced === undefined) return null;
    interest = (principal * (reduced / 100) * elapsed) / 12;
  } else {
    const position = rule.unit === 'days' ? Math.round(elapsed * 30) : (elapsed / term) * 100;
    const t = rule.tiers.find((x) => position >= x.from && (x.to === null || position <= x.to));
    if (!t) return null;
    interest = accrued * (t.retainedPct / 100);
  }
  const clawback = Math.max(0, paidSoFar - interest);
  // Total received over the life of the deposit: principal plus the interest kept.
  return { interest, clawback, proceeds: principal + interest };
}
