import { referenceMonth } from '../../shared/finance';
import type { InflationPoint, MarketPoint } from '../../shared/types';

export interface Monthly {
  month: string;
  value: number;
}

/** Official rate points as monthly values keyed by reference month (annual rows dropped). */
export function monthlyRates(points: MarketPoint[], currencyGroup: 'AZN' | 'FX'): Monthly[] {
  return points
    .filter((p) => p.currencyGroup === currencyGroup && p.frequency === 'monthly')
    .map((p) => ({ month: referenceMonth(p.periodDate), value: p.rate }));
}

export const monthlyInflation = (points: InflationPoint[]): Monthly[] =>
  points.flatMap((p) => (p.yoy === null ? [] : [{ month: p.month, value: p.yoy }]));

export function align(a: Monthly[], b: Monthly[]) {
  const byMonth = new Map(b.map((x) => [x.month, x.value]));
  return a.flatMap((x) => (byMonth.has(x.month) ? [{ month: x.month, a: x.value, b: byMonth.get(x.month)! }] : []));
}

/** Union of several monthly series, for charting. Gaps stay null. */
export function merge(series: Record<string, Monthly[]>) {
  const rows = new Map<string, Record<string, number | string | null>>();
  for (const [key, values] of Object.entries(series)) {
    for (const v of values) {
      const row = rows.get(v.month) ?? { date: v.month, ...Object.fromEntries(Object.keys(series).map((k) => [k, null])) };
      row[key] = v.value;
      rows.set(v.month, row);
    }
  }
  return [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
