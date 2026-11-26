// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App, PAGES } from '../src/App';
import { I18nProvider, translate } from '../src/i18n';
import { en } from '../src/i18n/en';
import { az } from '../src/i18n/az';
import { v2 } from '../src/i18n/v2';
import { clearApiCache } from '../src/lib/api';
import { addMonths } from '../shared/finance';
import type { ReportData } from '../shared/report';
import { offerRow } from './helpers';

const T = (k: keyof typeof v2) => v2[k][0];
const rows = [
  offerRow({ id: 1, bankSlug: 'alpha', bankName: 'Alpha Bank', rate: 10 }),
  offerRow({ id: 2, bankSlug: 'beta', bankName: 'Beta Bank', rate: 8 }),
  offerRow({ id: 3, bankSlug: 'beta', bankName: 'Beta Bank', rate: 3, currency: 'USD' }),
];
const terms = [
  {
    bankSlug: 'alpha', productKey: 'term', sourceUrl: 'https://alpha.az', lastVerifiedAt: '2026-11-26T00:00:00Z', minAmount: { AZN: 50_000 }, topUp: false, partialWithdrawal: null,
    earlyWithdrawal: { type: 'retained_share', unit: 'days', tiers: [{ from: 0, to: 90, retainedPct: 0 }, { from: 91, to: null, retainedPct: 20 }] }, excerpts: [],
  },
];
const months = Array.from({ length: 30 }, (_, i) => addMonths('2024-04-01', i));
const source = { key: 'cbar_rates', name: 'Test CBAR', url: 'https://www.cbar.az/', lastVerifiedAt: '2026-11-26T00:00:00Z', freshness: 'fresh', latestPeriod: months.at(-1) };
const point = (periodDate: string, currencyGroup: string, rate: number) => ({ metric: 'deposit_rate', basis: 'new_business', currencyGroup, segment: 'total', bucket: 'all', periodDate, frequency: 'monthly', rate });
const market = months.flatMap((m, i) => [point(m, 'AZN', 7 + (i % 5) / 10), point(m, 'FX', 3)]);
const inflation = months.map((month, i) => ({ month, mom: 0.4, yoy: 4 + (i % 7) / 10, avgAnnual: 5 }));
const bank = { slug: 'alpha', name: 'Alpha Bank', website: 'https://alpha.az', accessStatus: 'active', accessNote: null, freshness: 'fresh', lastVerifiedAt: '2026-11-26T00:00:00Z' };
const report: ReportData = {
  type: 'monthly', period: '2026-09', periodStart: '2026-09-01', periodEnd: '2026-09-01', offersAsOf: '2026-11-26T00:00:00Z', generatedAt: '2026-11-26T00:00:00Z',
  offers: rows, market: market as ReportData['market'], inflation, policy: [], index: [], indexHistoryDays: 1, sources: [{ name: 'Test', url: 'https://x.az', lastVerifiedAt: null }],
};

let empty = false;
let failure = false;
let signedIn = false;
let preferences: Record<string, unknown> = {};
const posts: { path: string; body: unknown }[] = [];

function respond(path: string): unknown {
  const name = path.split('?')[0]!;
  if (name === 'rates') return { rows: empty ? [] : rows };
  if (name === 'market') return { points: empty ? [] : market, source };
  if (name === 'inflation') return { points: empty ? [] : inflation, source };
  if (name === 'policy') return { points: empty ? [] : months.map((month) => ({ month, refinancing: 6.5, floor: 5, ceiling: 7.5 })), source };
  if (name === 'meta') return { generatedAt: '', sources: [], rates: source, inflation: source };
  if (name === 'snapshots') return { snapshots: [] };
  if (name === 'logs') return { logs: [] };
  if (name === 'terms') return { terms };
  if (name === 'banks') return { banks: [bank] };
  if (name === 'banks/alpha') return { bank, history: [], events: [] };
  if (name === 'index') return { rates: empty ? [] : rows, terms, history: {}, inflation: { value: 5, month: '2026-09-01' }, scoreHistory: [] };
  if (name === 'confidence') return { sources: [{ key: 'a', publisher: 'Alpha Bank', score: 70, parts: {} }] };
  if (name === 'reports') return { reports: [{ slug: 'm1', type: 'monthly', period: '2026-09', publishedAt: '2026-11-26T00:00:00Z' }] };
  if (name === 'reports/m1') return { slug: 'm1', publishedAt: '2026-11-26T00:00:00Z', data: report };
  if (name === 'ai/status') return { enabled: false, model: null };
  if (name === 'ai/ask') return { mode: 'evidence_only', statements: [{ text: 'Observed figure 8%.', kind: 'fact', citations: ['E1'] }], insufficient: false, withheld: 0, model: null, notice: 'no_provider', evidence: [{ id: 'E1', kind: 'observation', text: 'Observed figure 8%.', date: '2026-09-01', sources: [{ name: 'Test', url: 'https://x.az' }] }] };
  if (name === 'auth/me') return { user: signedIn ? { email: 'a@b.az', role: 'user', preferences } : null };
  if (name === 'auth/login') { signedIn = true; return { user: {} }; }
  if (name === 'account') return { items: [{ id: 1, kind: 'favorite', label: 'Alpha Bank', payload: { bank: 'alpha' }, createdAt: '' }], subscriptions: [], notifications: [{ id: 1, read: false, kind: 'rate_change', createdAt: '2026-11-26T00:00:00Z', details: { bankName: 'Alpha Bank', productName: 'Term deposit', from: 9, to: 10 } }] };
  return { ok: true };
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/', '');
    if (init?.method === 'POST') posts.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    return failure ? new Response('{"error":"internal_error"}', { status: 500 }) : new Response(JSON.stringify(respond(path)));
  }));
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  clearApiCache();
  localStorage.clear();
  empty = failure = signedIn = false;
  preferences = {};
  posts.length = 0;
});

const open = (path: string) => render(<I18nProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></I18nProvider>);

describe('routes', () => {
  it.each([
    ['/', en.ov_title, T('dash_distribution')],
    ['/explorer', en.ex_title, en.advertised],
    ['/statistics', en.st_title, en.st_descriptive],
    ['/simulator', translate('en', 'sim_title'), en.sim_schedule],
    ['/inflation', en.inf_title, en.inf_calc],
    ['/trends', en.tr_title, T('tr_policy')],
    ['/methodology', en.me_title, T('me_confidence')],
    ['/banks', T('banks_title'), 'Alpha Bank'],
    ['/banks/alpha', 'Alpha Bank', T('bank_conditions')],
    ['/compare', T('cmp_title'), T('cmp_save')],
    ['/index', T('ix_title'), T('ix_weights')],
    ['/research', T('res_title'), T('res_exports')],
    ['/research/m1', 'Monthly Azerbaijan Banking Market Report', 'Limitations'],
    ['/assistant', T('ai_title'), T('ai_off')],
    ['/learn', T('learn_title'), T('learn_med_t')],
    ['/account', T('acc_title'), T('acc_privacy')],
    ['/admin', T('adm_title'), T('adm_need')],
  ])('renders %s', async (path, title, content) => {
    open(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect((await screen.findAllByText(content)).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/NaN|undefined|\{[a-zA-Z]+\}/);
  });

  it('links every page in the navigation', async () => {
    open('/learn');
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getAllByRole('link')).toHaveLength(PAGES.length);
  });
});

describe('application flows', () => {
  it('switches language', async () => {
    open('/');
    await screen.findByRole('heading', { level: 1, name: en.ov_title });
    fireEvent.click(screen.getByRole('button', { name: 'AZ' }));
    expect(await screen.findByRole('heading', { level: 1, name: az.ov_title })).toBeTruthy();
    expect(document.documentElement.lang).toBe('az');
  });

  it('filters the explorer by currency and search', async () => {
    open('/explorer');
    const table = () => screen.getAllByRole('table')[0]!;
    await screen.findByText(en.advertised);
    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'beta' } });
    expect(within(table()).queryByText('Alpha Bank')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'USD' }));
    expect(within(table()).getAllByText('3.00%').length).toBe(1);
  });

  it('recalculates the probability lab from threshold, bank group and condition', async () => {
    open('/statistics');
    await screen.findByText(en.st_prob);
    fireEvent.click(screen.getByRole('button', { name: T('lab_probability') }));
    await screen.findByText(T('lab_conditional'));
    const result = () => screen.getByText(T('lab_probability_v')).parentElement!.textContent;
    fireEvent.change(screen.getByLabelText(en.st_threshold), { target: { value: '9' } });
    expect(result()).toContain('50.0%');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Beta Bank' }));
    expect(result()).toContain('100.0%');
  });

  it('refuses hypothesis tests on tiny groups', async () => {
    open('/statistics');
    await screen.findByText(en.st_prob);
    fireEvent.click(screen.getByRole('button', { name: T('lab_tests') }));
    expect((await screen.findAllByText(T('lab_need').replace('{n}', '8'))).length).toBeGreaterThan(0);
  });

  it('simulates gross returns by default and applies stated early-closure terms', async () => {
    open('/simulator?offer=1');
    await screen.findByText(en.sim_schedule);
    const stat = (label: string) => screen.getByText(label, { selector: 'div' }).parentElement!.textContent;
    expect(stat(en.sim_gross)).toContain('1,000.00 AZN');
    expect(stat(en.sim_taxamt)).toContain('0.00 AZN');
    fireEvent.change(screen.getByLabelText(`${en.sim_principal} (AZN)`), { target: { value: '20000' } });
    expect(stat(en.sim_gross)).toContain('2,000.00 AZN');
    // Six months: 20% of 1,000 accrued interest is kept.
    await waitFor(() => expect(stat(T('dec_early_interest'))).toContain('200.00 AZN'));
    fireEvent.change(screen.getByLabelText(`${en.sim_principal} (AZN)`), { target: { value: '-5' } });
    expect(screen.getByText(en.sim_invalid)).toBeTruthy();
  });

  it('excludes products below the minimum amount from comparison', async () => {
    open('/compare');
    expect(await screen.findByText(T('cmp_eligible').replace('{n}', '1'))).toBeTruthy();
    expect(screen.getByText(/Excluded: 1 below minimum/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(`${T('cmp_amount')} (AZN)`), { target: { value: '60000' } });
    expect(screen.getByText(T('cmp_eligible').replace('{n}', '2'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(T('cmp_withdrawal')), { target: { value: 'interest' } });
    expect(screen.getByText(T('cmp_eligible').replace('{n}', '1'))).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha Bank Term deposit' }));
    expect(screen.getByText(T('cmp_side'), { selector: 'h2' })).toBeTruthy();
  });

  it('explains index components and warns it is not a safety rating', async () => {
    open('/index');
    expect(await screen.findByText(T('ix_warning'))).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Alpha Bank' })[0]!);
    expect(screen.getByText(/0 day\(s\) of history; 30 required/)).toBeTruthy();
  });

  it('shows evidence from the assistant', async () => {
    open('/assistant');
    fireEvent.change(await screen.findByLabelText(T('ai_question')), { target: { value: 'average rate?' } });
    fireEvent.click(screen.getByRole('button', { name: T('ai_ask') }));
    expect(await screen.findByText(T('ai_evidence_only'))).toBeTruthy();
    expect(posts[0]).toMatchObject({ path: 'ai/ask', body: { question: 'average rate?', lang: 'en', student: false } });
  });

  it('signs in and shows saved items and notifications', async () => {
    open('/account');
    fireEvent.change(await screen.findByLabelText(T('acc_email')), { target: { value: 'a@b.az' } });
    fireEvent.change(screen.getByLabelText(T('acc_password')), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: T('acc_login') }));
    expect(await screen.findByText(/changed from 9.00% to 10.00%/)).toBeTruthy();
    expect(screen.getByText('Alpha Bank', { selector: 'span' })).toBeTruthy();
  });

  it('applies and saves account preferences', async () => {
    signedIn = true;
    preferences = { lang: 'az', theme: 'dark' };
    open('/account');
    expect(await screen.findByRole('heading', { level: 1, name: v2.acc_title[1] })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: v2.acc_prefs_save[1] }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ path: 'account/preferences', body: { lang: 'az', theme: 'dark' } }));
  });

  it('saves a favourite product from a bank profile', async () => {
    open('/banks/alpha');
    fireEvent.click(await screen.findByRole('button', { name: `☆ ${T('acc_fav_product')}` }));
    await waitFor(() => expect(posts.at(-1)).toMatchObject({ path: 'account/items', body: { kind: 'favorite', payload: { bank: 'alpha', product: 'term' } } }));
  });

  it('shows an explicit empty state instead of substitute data', async () => {
    empty = true;
    open('/explorer');
    expect(await screen.findByText(en.no_data_yet)).toBeTruthy();
  });

  it('reports load errors and unknown routes', async () => {
    failure = true;
    open('/explorer');
    expect((await screen.findByRole('alert')).textContent).toContain('internal_error');
    cleanup();
    open('/missing');
    expect(await screen.findByText(en.not_found)).toBeTruthy();
  });
});
