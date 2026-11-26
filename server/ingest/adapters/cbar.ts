import * as cheerio from 'cheerio';
import { cellDate, readSheets, type Row } from '../xlsx.js';
import { STALE_AFTER_HOURS, type Collected, type InflationRecord, type MarketRecord, type PolicyRecord, type SourceAdapter } from '../types.js';
import type { CurrencyGroup, Segment } from '../../../shared/types.js';
import { addMonths } from '../../../shared/finance.js';

const BASE = 'https://www.cbar.az';
const INDICATORS = `${BASE}/page-42/monetary-indicators?language=en`;
const BULLETINS = `${BASE}/page-40/statistical-bulletin?language=en`;
const HOSTS = ['www.cbar.az', 'uploads.cbar.az'];

/** Finds a download link on the monetary indicators page by its published title. */
export function findDataset(html: string, title: RegExp): string {
  const $ = cheerio.load(html);
  const link = $('a[href$=".xlsx"]')
    .toArray()
    .find((a) => title.test($(a).text().replace(/\s+/g, ' ').trim()));
  if (!link) throw new Error(`CBAR dataset not found on page: ${title}`);
  return new URL($(link).attr('href')!, BASE).href;
}

/** The bulletin page lists releases oldest → newest; take the last workbook. */
export function findLatestBulletin(html: string): string {
  const $ = cheerio.load(html);
  const last = $('a[href$=".xlsx"]').toArray().pop();
  if (!last) throw new Error('No bulletin workbook found on CBAR page');
  return new URL($(last).attr('href')!, BASE).href;
}

const currencyGroup = (label: unknown): CurrencyGroup | null =>
  /^Manatla/i.test(String(label)) ? 'AZN' : /^Xarici valyuta/i.test(String(label)) ? 'FX' : null;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);

function headerContains(rows: Row[], column: string, pattern: RegExp): boolean {
  return rows.slice(0, 14).some((r) => pattern.test(String(r.cells[column] ?? '')));
}

function assertLayout(rows: Row[], expected: Record<string, RegExp>) {
  for (const [column, pattern] of Object.entries(expected)) {
    if (!headerContains(rows, column, pattern)) {
      throw new Error(`CBAR workbook layout changed: column ${column} no longer matches ${pattern}`);
    }
  }
}

interface Series {
  column: string;
  metric: MarketRecord['metric'];
  segment: Segment;
  bucket: string;
}

/**
 * Many date cells in the CBAR workbooks have day and month transposed: the label
 * 01.06.2019 (June) is stored as 6 January 2019. A real label is always the first
 * of a month, so "year-01-DD" with DD ≤ 12 unambiguously means month DD.
 */
export function repairPeriodLabel(iso: string): string {
  const [year, month, day] = iso.split('-') as [string, string, string];
  if (day === '01') return iso;
  if (month === '01' && Number(day) <= 12) return `${year}-${day}-01`;
  throw new Error(`CBAR workbook has an unrecognised period label: ${iso}`);
}

/** Refuses the file unless labels advance by exactly one month (one year before 2005). */
export function assertContinuousPeriods(dates: string[]) {
  for (let i = 1; i < dates.length; i++) {
    const previous = dates[i - 1]!;
    const step = previous < '2005-01-01' ? 12 : 1;
    if (dates[i] !== addMonths(previous, step)) {
      throw new Error(`CBAR period sequence is broken: ${previous} is followed by ${dates[i]}`);
    }
  }
}

function parseRateRows(rows: Row[], basis: MarketRecord['basis'], series: Series[]): MarketRecord[] {
  const out: MarketRecord[] = [];
  const dates: string[] = [];
  let date: string | null = null;
  for (const row of rows) {
    const d = cellDate(row.cells.B);
    if (d) {
      date = repairPeriodLabel(d);
      dates.push(date);
      continue;
    }
    const group = currencyGroup(row.cells.B);
    if (!group || !date) continue;
    for (const s of series) {
      const rate = num(row.cells[s.column]);
      // CBAR prints "-" for no data; zero also denotes no reported business.
      if (rate === null || rate <= 0) continue;
      out.push({
        metric: s.metric, basis, currencyGroup: group, segment: s.segment, bucket: s.bucket,
        periodDate: date, frequency: date < '2005-01-01' ? 'annual' : 'monthly', rate,
      });
    }
  }
  assertContinuousPeriods(dates);
  return out;
}

/** Table 3.2.1 — new time deposits and new loans. */
export function parseNewRates(data: Uint8Array): MarketRecord[] {
  const rows = readSheets(data, ['3.2.1'])['3.2.1']!;
  assertLayout(rows, { C: /deposit/i, D: /loan/i });
  return parseRateRows(rows, 'new_business', [
    { column: 'C', metric: 'deposit_rate', segment: 'total', bucket: 'all' },
    { column: 'D', metric: 'loan_rate', segment: 'total', bucket: 'all' },
  ]);
}

const DEPOSIT_BUCKETS: [string, string][] = [
  ['F', 'lt_1m'], ['G', '1_3m'], ['H', '3_6m'], ['I', '6_9m'], ['J', '9_12m'], ['K', '1_5y'], ['L', 'gt_5y'],
];
const LOAN_BUCKETS: [string, string][] = [
  ['P', 'lt_1m'], ['Q', '1_3m'], ['R', '3_6m'], ['S', '6_9m'], ['T', '9_12m'], ['U', '1_3y'], ['V', '3_5y'], ['W', '5_10y'], ['X', 'gt_10y'],
];

/** Table 3.2 — average rates on outstanding time deposits and loans. */
export function parseOutstandingRates(data: Uint8Array): MarketRecord[] {
  const rows = readSheets(data, ['3.2'])['3.2']!;
  assertLayout(rows, {
    C: /time deposits/i, D: /Legal/i, E: /Individuals/i, F: /1 month|up to/i, L: /5 years/i,
    M: /loans/i, N: /Legal/i, O: /Individuals/i, X: /10 years/i,
  });
  const series: Series[] = [
    { column: 'C', metric: 'deposit_rate', segment: 'total', bucket: 'all' },
    { column: 'D', metric: 'deposit_rate', segment: 'legal_entities', bucket: 'all' },
    { column: 'E', metric: 'deposit_rate', segment: 'individuals', bucket: 'all' },
    ...DEPOSIT_BUCKETS.map(([column, bucket]) => ({ column, metric: 'deposit_rate' as const, segment: 'total' as const, bucket })),
    { column: 'M', metric: 'loan_rate', segment: 'total', bucket: 'all' },
    { column: 'N', metric: 'loan_rate', segment: 'legal_entities', bucket: 'all' },
    { column: 'O', metric: 'loan_rate', segment: 'individuals', bucket: 'all' },
    ...LOAN_BUCKETS.map(([column, bucket]) => ({ column, metric: 'loan_rate' as const, segment: 'total' as const, bucket })),
  ];
  return parseRateRows(rows, 'outstanding', series);
}

/** Bulletin table 1.1 — monthly CPI inflation (source: State Statistics Committee). */
export function parseCpi(data: Uint8Array): InflationRecord[] {
  const rows = readSheets(data, ['1.1'])['1.1']!;
  assertLayout(rows, { M: /istehlak qiym|Consumer Price|monthly/i, N: /12 month/i, O: /Annual average/i });
  const out: InflationRecord[] = [];
  for (const { periodDate, row } of monthRows(rows)) {
    for (const [column, measure] of [['M', 'cpi_mom'], ['N', 'cpi_yoy'], ['O', 'cpi_avg_annual']] as const) {
      const value = num(row.cells[column]);
      if (value !== null && value > -50 && value < 200) out.push({ periodDate, measure, value });
    }
  }
  if (!out.length) throw new Error('No monthly CPI rows found in CBAR bulletin');
  return out;
}

/** Walks a bulletin table whose rows are month numbers under year rows. */
function monthRows(rows: Row[]): { periodDate: string; row: Row }[] {
  const out: { periodDate: string; row: Row }[] = [];
  let year: number | null = null;
  let lastMonth = 0;
  for (const row of rows) {
    const label = String(row.cells.A ?? '').trim();
    if (/^(19|20)\d{2}$/.test(label)) {
      year = Number(label);
      lastMonth = 0;
      continue;
    }
    if (!/^(0?[1-9]|1[0-2])$/.test(label) || year === null) continue;
    const month = Number(label);
    // Months must run consecutively; otherwise we cannot attribute them to a year.
    if (month !== lastMonth + 1) {
      year = null;
      continue;
    }
    lastMonth = month;
    out.push({ periodDate: `${year}-${String(month).padStart(2, '0')}-01`, row });
  }
  return out;
}

/** Bulletin table 3.1 — refinancing rate and the interest-rate corridor. */
export function parsePolicyRates(data: Uint8Array): PolicyRecord[] {
  const rows = readSheets(data, ['3.1'])['3.1']!;
  assertLayout(rows, { M: /Repo/i, O: /Deposit|Depozit/i, Q: /Refinancing|Yenidənmaliyyə/i });
  const out: PolicyRecord[] = [];
  for (const { periodDate, row } of monthRows(rows)) {
    for (const [column, measure] of [['Q', 'refinancing'], ['O', 'corridor_floor'], ['M', 'corridor_ceiling']] as const) {
      const value = num(row.cells[column]);
      if (value !== null && value >= 0 && value <= 100) out.push({ periodDate, measure, value });
    }
  }
  if (!out.length) throw new Error('No policy rate rows found in CBAR bulletin');
  return out;
}

/** Compact verbatim copy of parsed sheets for the raw record store. */
const rawRows = (data: Uint8Array, sheet: string) =>
  readSheets(data, [sheet])[sheet]!.map((r) => ({ r: r.index, ...r.cells }));

async function collectRates(fetcher: Parameters<NonNullable<SourceAdapter['collect']>>[0]): Promise<Collected> {
  const page = await fetcher.text(INDICATORS);
  const outstandingUrl = findDataset(page, /^Average interest rates on time deposits and loans/i);
  const newUrl = findDataset(page, /^Average interest rates on new time deposits and new loans/i);
  const outstanding = await fetcher.bytes(outstandingUrl);
  const fresh = await fetcher.bytes(newUrl);
  return {
    documents: [
      { url: outstandingUrl, payload: { sheet: '3.2', rows: rawRows(outstanding, '3.2') } },
      { url: newUrl, payload: { sheet: '3.2.1', rows: rawRows(fresh, '3.2.1') } },
    ],
    market: [
      ...parseOutstandingRates(outstanding).map((r) => ({ ...r, sourceUrl: outstandingUrl })),
      ...parseNewRates(fresh).map((r) => ({ ...r, sourceUrl: newUrl })),
    ],
  };
}

export const cbarRates: SourceAdapter = {
  key: 'cbar_rates',
  name: 'CBAR — average interest rates on deposits and loans (tables 3.2, 3.2.1)',
  publisher: 'Central Bank of the Republic of Azerbaijan',
  kind: 'official_statistics',
  url: INDICATORS,
  format: 'XLSX',
  updateFrequency: 'Monthly',
  accessStatus: 'active',
  hosts: HOSTS,
  minRefreshHours: 12,
  staleAfterHours: STALE_AFTER_HOURS,
  collect: collectRates,
};

export const cbarCpi: SourceAdapter = {
  key: 'cbar_cpi',
  name: 'CBAR statistical bulletin — inflation and policy rates (tables 1.1, 3.1)',
  publisher: 'Central Bank of Azerbaijan, citing the State Statistics Committee',
  kind: 'official_statistics',
  url: BULLETINS,
  format: 'XLSX',
  updateFrequency: 'Monthly',
  accessStatus: 'active',
  hosts: HOSTS,
  minRefreshHours: 12,
  staleAfterHours: STALE_AFTER_HOURS,
  async collect(fetcher) {
    const url = findLatestBulletin(await fetcher.text(BULLETINS));
    const data = await fetcher.bytes(url);
    return {
      documents: [{ url, payload: { sheets: { '1.1': rawRows(data, '1.1'), '3.1': rawRows(data, '3.1') } } }],
      inflation: parseCpi(data).map((r) => ({ ...r, sourceUrl: url })),
      policy: parsePolicyRates(data).map((r) => ({ ...r, sourceUrl: url })),
    };
  },
};
