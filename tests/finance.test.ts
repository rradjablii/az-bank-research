import { describe, expect, it } from 'vitest';
import {
  addMonths, exPostRealRates, monthlyTax, purchasingPower, realRate, referenceMonth, simulateDeposit, type DepositInput,
} from '../shared/finance';

const base: DepositInput = { principal: 10_000, annualRate: 12, months: 12, method: 'at_maturity', currency: 'AZN', tax: 'none' };

describe('deposit calculator', () => {
  it('pays simple interest at maturity', () => {
    const r = simulateDeposit(base);
    expect(r.grossInterest).toBeCloseTo(1200, 8);
    expect(r.maturityValue).toBeCloseTo(11_200, 8);
    expect(r.grossAnnualised).toBeCloseTo(12, 8);
    expect(r.flows.filter((f) => f.paid > 0)).toHaveLength(1);
  });
  it('pays periodically without compounding', () => {
    const monthly = simulateDeposit({ ...base, method: 'monthly_payout' });
    expect(monthly.flows.every((f) => Math.abs(f.paid - 100) < 1e-9 && f.balance === 10_000)).toBe(true);
    const quarterly = simulateDeposit({ ...base, method: 'quarterly_payout', months: 8 });
    expect(quarterly.flows.filter((f) => f.paid > 0).map((f) => [f.month, Math.round(f.paid)])).toEqual([[3, 300], [6, 300], [8, 200]]);
  });
  it('compounds at the chosen frequency', () => {
    expect(simulateDeposit({ ...base, method: 'compound', compounding: 12 }).maturityValue).toBeCloseTo(10_000 * 1.01 ** 12, 8);
    expect(simulateDeposit({ ...base, method: 'compound', compounding: 4 }).maturityValue).toBeCloseTo(10_000 * 1.03 ** 4, 8);
    expect(simulateDeposit({ ...base, method: 'compound', compounding: 1, months: 24 }).maturityValue).toBeCloseTo(10_000 * 1.12 ** 2, 8);
  });
  it('supports interest paid upfront', () => {
    const r = simulateDeposit({ ...base, method: 'upfront' });
    expect(r.flows[0]!.paid).toBeCloseTo(1200, 8);
    expect(r.flows.slice(1).every((f) => f.paid === 0)).toBe(true);
  });
  it('rejects invalid input', () => {
    for (const bad of [{ principal: 0 }, { annualRate: -1 }, { annualRate: NaN }, { months: 0 }, { months: 1.5 }]) {
      expect(() => simulateDeposit({ ...base, ...bad })).toThrow(RangeError);
    }
  });
});

describe('tax assumptions', () => {
  it('exempts AZN interest up to 200 a month and taxes the excess at 10%', () => {
    expect(simulateDeposit({ ...base, tax: 'az_scheduled_2027' }).tax).toBe(0);
    // 100 000 at 12% = 1000/month → (1000 − 200) × 10% × 12
    expect(simulateDeposit({ ...base, principal: 100_000, tax: 'az_scheduled_2027' }).tax).toBeCloseTo(960, 8);
  });
  it('applies the 18-month AZN exemption only under 2026 rules', () => {
    expect(monthlyTax(1000, 'AZN', 18, 'az_2026')).toBe(0);
    expect(monthlyTax(1000, 'AZN', 17, 'az_2026')).toBe(80);
    expect(monthlyTax(1000, 'AZN', 24, 'az_scheduled_2027')).toBe(80);
  });
  it('taxes foreign-currency interest from the first unit', () => {
    expect(monthlyTax(100, 'USD', 24, 'az_2026')).toBe(10);
    expect(monthlyTax(100, 'AZN', 12, 'flat10')).toBe(10);
    expect(monthlyTax(100, 'EUR', 12, 'none')).toBe(0);
  });
});

describe('inflation-adjusted returns', () => {
  it('uses the Fisher relation, not subtraction', () => {
    expect(realRate(10, 5)).toBeCloseTo(4.7619047, 6);
    expect(realRate(5, 10)).toBeLessThan(0);
    expect(() => realRate(5, -100)).toThrow();
  });
  it('deflates purchasing power over the term', () => {
    expect(purchasingPower(1100, 10, 12)).toBeCloseTo(1000, 8);
    expect(purchasingPower(1210, 10, 24)).toBeCloseTo(1000, 8);
  });
  it('maps CBAR reporting dates to the preceding month', () => {
    expect(referenceMonth('2026-10-01')).toBe('2026-09-01');
    expect(referenceMonth('2026-01-01')).toBe('2025-12-01');
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01');
  });
  it('aligns the ex-post real rate with the holding year', () => {
    const out = exPostRealRates(
      [{ month: '2025-09-01', rate: 8 }],
      [{ month: '2026-08-01', yoy: 4 }, { month: '2026-09-01', yoy: 5 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ month: '2026-09-01', contractedIn: '2025-09-01', nominal: 8, inflation: 5 });
    expect(out[0]!.real).toBeCloseTo(realRate(8, 5), 12);
  });
});
