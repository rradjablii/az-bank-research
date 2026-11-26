import { describe, expect, it } from 'vitest';
import { assertContinuousPeriods, findDataset, findLatestBulletin, parseCpi, parseNewRates, parseOutstandingRates, repairPeriodLabel } from '../server/ingest/adapters/cbar';
import * as D from '../server/ingest/adapters/banks/deposits';
import { parseLoan } from '../server/ingest/adapters/banks/loans';
import { bankAdapters, unavailableBank } from '../server/ingest/adapters/banks/index';
import type { ProductBase } from '../server/ingest/adapters/banks/common';
import { createFetcher, parseRobots, robotsAllows } from '../server/ingest/fetcher';
import { parseRate, parseTerms, tables } from '../server/ingest/html';
import { normalizeOffers } from '../server/ingest/normalize';
import { cellDate } from '../server/ingest/xlsx';
import type { OfferRecord } from '../server/ingest/types';
import { fixture, html } from './helpers';

const base: ProductBase = { productKey: 'p', productName: 'P', productUrl: 'https://bank.az/p', productType: 'term_deposit' };
const rate = (o: OfferRecord[], currency: string, term: number | null, payout: string, variant = 'standard') =>
  o.filter((x) => x.currency === currency && x.termMin === term && x.payout === payout && x.variant === variant).map((x) => x.rate);

describe('CBAR workbooks (real files)', () => {
  const recent = parseNewRates(fixture('cbar_new.xlsx'));
  const stock = parseOutstandingRates(fixture('cbar_outstanding.xlsx'));
  const pick = (rows: typeof recent, metric: string, date: string, segment = 'total', bucket = 'all') =>
    rows.find((r) => r.metric === metric && r.currencyGroup === 'AZN' && r.periodDate === date && r.segment === segment && r.bucket === bucket)?.rate;

  it('reads published values', () => {
    expect(pick(recent, 'deposit_rate', '2026-10-01')).toBe(8.28);
    expect(pick(recent, 'loan_rate', '2026-10-01')).toBe(18.14);
    expect(pick(stock, 'deposit_rate', '2026-10-01')).toBe(9.1278);
  });
  it('repairs transposed day/month labels instead of misdating (regression)', () => {
    // The workbook stores June 2019 as 6 January 2019.
    const months = [...new Set(recent.filter((r) => r.periodDate.startsWith('2019')).map((r) => r.periodDate.slice(5, 7)))];
    expect(months).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
    for (const rows of [recent, stock]) {
      const dates = [...new Set(rows.map((r) => r.periodDate))].sort();
      expect(dates.every((d) => d.endsWith('-01'))).toBe(true);
      expect(() => assertContinuousPeriods(dates)).not.toThrow();
    }
  });
  it('refuses unknown label forms and gaps', () => {
    expect(repairPeriodLabel('2019-01-06')).toBe('2019-06-01');
    expect(() => repairPeriodLabel('2019-03-15')).toThrow(/unrecognised/);
    expect(() => assertContinuousPeriods(['2020-01-01', '2020-03-01'])).toThrow(/broken/);
  });
  it('reads monthly CPI from the bulletin', () => {
    const cpi = parseCpi(fixture('cbar_bulletin_cpi.xlsx'));
    const at = (m: string, d: string) => cpi.find((c) => c.measure === m && c.periodDate === d)?.value;
    expect(at('cpi_yoy', '2026-09-01')).toBe(5.4755);
    expect(at('cpi_avg_annual', '2023-12-01')).toBeCloseTo(8.7854, 3);
    expect(new Set(cpi.map((c) => c.periodDate)).size).toBeGreaterThan(250);
  });
  it('discovers downloads by published title', () => {
    const page = '<a href="https://uploads.cbar.az/a.xlsx">Average interest rates on time deposits and loans (27.10.2026) 1 kB</a><a href="/b.xlsx">Other</a>';
    expect(findDataset(page, /^Average interest rates on time/)).toBe('https://uploads.cbar.az/a.xlsx');
    expect(findLatestBulletin(page)).toBe('https://www.cbar.az/b.xlsx');
    expect(() => findDataset(page, /nope/)).toThrow();
  });
});

describe('bank page parsers (excerpts of real pages)', () => {
  it('AccessBank separates standard, campaign and legacy columns', () => {
    const o = D.accessTimed(html('access_timed.html'), base);
    expect(rate(o, 'AZN', 12, 'at_maturity')).toEqual([9]);
    expect(rate(o, 'AZN', 12, 'at_maturity', 'legacy_renewal')).toEqual([6.5]);
    expect(rate(o, 'USD', 12, 'monthly', 'campaign')).toEqual([3.5]);
    expect(rate(D.accessOnline(html('access_my.html'), base), 'USD', 12, 'at_maturity')).toEqual([2.3]);
  });
  it('AFB reads both payout blocks and the campaign table', () => {
    const o = D.afbTerm(html('afb_term.html'), base);
    expect(rate(o, 'AZN', 12, 'at_maturity')).toEqual([10]);
    expect(rate(o, 'AZN', 12, 'monthly')).toEqual([9.5]);
    expect(rate(D.afbCampaign(html('afb_campaign.html'), base), 'AZN', 12, 'at_maturity', 'campaign')).toEqual([10.5]);
  });
  it('Bank of Baku reads insured and uninsured USD rates', () => {
    const o = D.bankOfBaku(html('bob_digital.html'), base);
    expect(rate(o, 'AZN', 12, 'at_maturity')).toEqual([10.25]);
    expect(rate(o, 'USD', 12, 'at_maturity')).toEqual([2.5]);
    expect(rate(o, 'USD', 12, 'at_maturity', 'uninsured')).toEqual([3.75]);
  });
  it('Express handles term ranges and uninsured columns', () => {
    const o = D.express(html('express.html'), base);
    expect(o.find((x) => x.currency === 'AZN' && x.termMin === 12 && x.payout === 'monthly')).toMatchObject({ rate: 9.5, termMax: 17 });
    expect(rate(o, 'USD', 12, 'at_maturity', 'uninsured')).toEqual([3.5]);
  });
  it('Premium reads rowspans and amount bands', () => {
    const o = D.premium(html('premium.html'), base);
    expect(rate(o, 'AZN', 18, 'at_maturity')).toEqual([9.5]);
    expect(o.filter((x) => x.currency === 'USD' && x.termMin === 12 && x.payout === 'monthly').map((x) => [x.amountMin, x.rate])).toEqual([[500, 2.5], [100001, 3], [1000000, 3.5]]);
  });
  it('Respublika, Yelo, VTB', () => {
    expect(rate(D.respublika(html('resp_term.html'), base), 'AZN', 12, 'at_maturity')).toEqual([8.5]);
    expect(rate(D.yeloTerm(html('yelo_sabit.html'), base), 'AZN', 12, 'monthly')).toEqual([9]);
    expect(D.yeloFlexible(html('yelo_serbest.html'), { ...base, productType: 'flexible_deposit' }).map((x) => x.rate)).toEqual([7, 8, 2, 2.2]);
    expect(rate(D.vtbSavings(html('vtb_aff.html'), base), 'AZN', 18, 'at_maturity')).toEqual([10.5]);
    expect(rate(D.vtbAdvance(html('vtb_adv.html'), base), 'AZN', 12, 'upfront')).toEqual([8]);
  });
  it('Unibank maps tabs to payout and splits insured / uninsured', () => {
    const o = D.unibankTerm(html('uni_term.html'), base);
    expect(rate(o, 'AZN', 12, 'at_maturity')).toEqual([9]);
    expect(rate(o, 'AZN', 12, 'monthly')).toEqual([8.5]);
    expect(rate(o, 'USD', 12, 'at_maturity', 'uninsured')).toEqual([4.5]);
    expect(D.unibankSavings(html('uni_save.html'), base).map((x) => [x.productKey, x.rate])).toEqual([['p-topup', 9], ['p-fixed', 8]]);
  });
  it('Ziraat captures the stated publication date', () => {
    const o = D.ziraat(html('ziraat.html'), base);
    expect(rate(o, 'AZN', 12, 'quarterly')).toEqual([9.75]);
    expect(rate(o, 'EUR', 12, 'at_maturity')).toEqual([1.5]);
    expect(o[0]!.observedDate).toBe('2026-11-23');
  });
  it('Rabitabank and ABB', () => {
    expect(rate(D.rabitaUniversal(html('rab_univ.html'), base), 'AZN', 12, 'monthly')).toEqual([9.25]);
    expect(D.rabitaDollar(html('rab_dol.html'), base).every((x) => x.variant === 'campaign' && x.currency === 'USD')).toBe(true);
    const abb = D.abb(html('abb_classic.html'), base);
    expect(rate(abb, 'AZN', 12, 'at_maturity')).toEqual([9]);
    expect(rate(abb, 'USD', 12, 'at_maturity')).toEqual([3.5]);
  });
  it('fails loudly when the layout changes', () => {
    const empty = '<html><body><p>redesigned</p></body></html>';
    for (const parse of [D.accessTimed, D.express, D.premium, D.ziraat, D.abb, D.bankOfBaku, D.unibankTerm]) {
      expect(() => parse(empty, base)).toThrow(/layout changed/i);
    }
  });
});

describe('loan terms (excerpts of real page text)', () => {
  const texts = JSON.parse(html('loans.json')) as Record<string, string>;
  const expected: Record<string, [string, number, number | null]> = {
    abb: ['abb', 10.9, null], unibank: ['unibank', 9, 31.45], respublika: ['respublika', 10, null], bankofbaku: ['bob', 9.9, 37.9],
    express: ['express', 8.5, 28.9], yelo: ['yelo', 8.9, null], ziraat: ['ziraat', 10.9, null], premium: ['premium', 9.8, null],
    rabita: ['rabita', 9.5, null], afb: ['afb', 10.5, null], vtb: ['vtb', 9.9, null],
  };
  it.each(Object.entries(expected))('%s advertises the expected minimum', async (slug, [text, min, max]) => {
    // Run the production adapter against the captured text.
    const adapter = bankAdapters().find((a) => a.key === `bank_${slug}`)!;
    const page = `<body><p>${texts[text]}</p></body>`;
    const result = await adapter.collect!({ text: async () => page, bytes: async () => new Uint8Array() });
    const loan = result.offers!.find((o) => o.productType === 'consumer_loan')!;
    expect([loan.rate, loan.rateMax]).toEqual([min, max]);
  });
  it('rejects a page without the advertised wording', () => {
    expect(() => parseLoan('<body>nothing</body>', base, { rate: 'İllik {n}%' })).toThrow();
  });
});

describe('normalisation and validation', () => {
  const offer: OfferRecord & { sourceUrl: string } = {
    productKey: 'p', productName: 'P', productType: 'term_deposit', productUrl: 'https://bank.az/p', sourceUrl: 'https://bank.az/p',
    currency: 'AZN', termMin: 12, termMax: 12, payout: 'at_maturity', variant: 'standard', rate: 9,
  };
  it('parses rate and term cells', () => {
    expect(['6,5%', '5.%', '9.75% (illik)', '3.25', '-', ''].map(parseRate)).toEqual([6.5, 5, 9.75, 3.25, null, null]);
    expect(parseTerms('6 ay - 11 ay')).toEqual([{ min: 6, max: 11 }]);
    expect(parseTerms('12/18 ay')).toEqual([{ min: 12, max: 12 }, { min: 18, max: 18 }]);
    expect(parseTerms('1.5 il')).toEqual([{ min: 18, max: 18 }]);
    expect(parseTerms('>=36 ay')).toEqual([{ min: 36, max: 36 }]);
    expect(parseTerms('Tələb olunanadək')).toEqual([]);
  });
  it('expands row and column spans', () => {
    expect(tables('<table><tr><td rowspan="2">a</td><td colspan="2">b</td></tr><tr><td>c</td><td>d</td></tr></table>')[0]).toEqual([['a', 'b', 'b'], ['a', 'c', 'd']]);
  });
  it('accepts valid offers and rejects implausible ones', () => {
    const r = normalizeOffers([
      offer,
      { ...offer, termMin: 6, termMax: 6, rate: 90 },
      { ...offer, termMin: null, termMax: null },
      { ...offer, currency: 'GBP' as 'AZN' },
      { ...offer, productUrl: 'javascript:alert(1)' },
    ]);
    expect(r.offers).toHaveLength(1);
    expect(r.rejected).toHaveLength(4);
  });
  it('drops conflicting duplicates entirely rather than picking one', () => {
    const r = normalizeOffers([offer, { ...offer, rate: 10 }]);
    expect(r.offers).toEqual([]);
    expect(r.rejected[0]).toMatch(/conflicting/);
    expect(normalizeOffers([offer, { ...offer }]).offers).toHaveLength(1);
  });
  it('converts Excel serial and dotted dates', () => {
    expect(cellDate(46296)).toBe('2026-10-01');
    expect(cellDate('01.02.2005')).toBe('2005-02-01');
    expect(cellDate(10)).toBeNull();
  });
});

describe('polite fetcher', () => {
  it('honours robots.txt groups, wildcards and anchors', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\nCrawl-delay: 10\n\nUser-agent: other\nDisallow: /');
    expect(rules.crawlDelay).toBe(10);
    expect(robotsAllows(rules, '/rates')).toBe(true);
    expect(robotsAllows(rules, '/private/x')).toBe(false);
    expect(robotsAllows(rules, '/private/ok')).toBe(true);
    expect(robotsAllows(rules, '/a/file.pdf')).toBe(false);
  });

  const server = (routes: Record<string, () => Response>) => {
    const calls: string[] = [];
    const impl = (async (u: URL) => {
      calls.push(u.pathname);
      return routes[u.pathname]?.() ?? new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, impl };
  };

  it('refuses unlisted hosts, plain HTTP and off-list redirects', async () => {
    const { impl } = server({ '/r': () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }) });
    const f = createFetcher(['bank.az'], impl);
    await expect(f.text('https://evil.example/')).rejects.toThrow(/allow-list/);
    await expect(f.text('http://bank.az/')).rejects.toThrow(/non-HTTPS/);
    await expect(f.text('https://bank.az/r')).rejects.toThrow(/allow-list/);
  });
  it('does not request disallowed paths', async () => {
    const { calls, impl } = server({ '/robots.txt': () => new Response('User-agent: *\nDisallow: /secret') });
    await expect(createFetcher(['bank.az'], impl).text('https://bank.az/secret')).rejects.toThrow(/robots/);
    expect(calls).toEqual(['/robots.txt']);
  });
  it('never retries a 403 but retries a transient 500', async () => {
    let n = 0;
    const { calls, impl } = server({ '/blocked': () => new Response('', { status: 403 }), '/flaky': () => new Response('ok', { status: n++ ? 200 : 500 }) });
    const f = createFetcher(['bank.az'], impl);
    await expect(f.text('https://bank.az/blocked')).rejects.toThrow(/403/);
    expect(calls.filter((c) => c === '/blocked')).toHaveLength(1);
    await expect(f.text('https://bank.az/flaky')).resolves.toBe('ok');
    expect(calls.filter((c) => c === '/flaky')).toHaveLength(2);
  });
  it('marks blocked banks unavailable and enables a feed only when configured', () => {
    expect(unavailableBank('kapital', 'Kapital Bank', 'https://www.kapitalbank.az', 'HTTP 403', {})).toMatchObject({ accessStatus: 'unavailable', hosts: [] });
    const fed = unavailableBank('kapital', 'Kapital Bank', 'https://www.kapitalbank.az', 'HTTP 403', { SOURCE_FEED_KAPITAL_URL: 'https://feed.example.az/rates.json' });
    expect(fed).toMatchObject({ accessStatus: 'active', kind: 'partner_feed', hosts: ['feed.example.az'] });
  });
});
