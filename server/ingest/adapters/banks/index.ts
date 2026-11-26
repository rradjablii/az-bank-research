import { z } from 'zod';
import { STALE_AFTER_HOURS, type Collected, type OfferRecord, type SourceAdapter } from '../../types.js';
import type { ProductBase } from './common.js';
import * as d from './deposits.js';
import { parseLoan, type LoanSpec } from './loans.js';
import { TERMS, type TermsParser } from './terms.js';
import { pageText, tables } from '../../html.js';

interface Page {
  base: ProductBase;
  parse: (html: string, base: ProductBase) => OfferRecord[];
  terms?: TermsParser;
}

const dep = (productKey: string, productName: string, productUrl: string, parse: d.DepositParser, extra: Partial<ProductBase> = {}): Page => ({
  base: { productKey, productName, productUrl, productType: 'term_deposit', ...extra },
  parse,
});

const withTerms = (page: Page, terms: TermsParser): Page => ({ ...page, terms });

const loan = (productUrl: string, spec: LoanSpec): Page => ({
  base: { productKey: 'cash-loan', productName: 'Cash consumer loan', productUrl, productType: 'consumer_loan' },
  parse: (html, base) => parseLoan(html, base, spec),
});

/** Verbatim extracted content kept as the raw record for a page. */
function rawPayload(html: string, offers: OfferRecord[]) {
  const grids = tables(html).filter((g) => JSON.stringify(g).includes('%'));
  return {
    tables: grids.slice(0, 12),
    text: grids.length ? undefined : pageText(html).slice(0, 6000),
    extracted: offers,
  };
}

function bank(slug: string, name: string, website: string, pages: Page[], note?: string): SourceAdapter {
  const host = new URL(website).hostname;
  return {
    key: `bank_${slug}`,
    name: `${name} — public product pages`,
    publisher: name,
    kind: 'bank_website',
    url: pages[0]!.base.productUrl,
    format: 'HTML',
    updateFrequency: 'Irregular (checked twice a month)',
    accessStatus: 'active',
    accessNote: note,
    bank: { slug, name, website },
    hosts: [...new Set([host, ...pages.map((p) => new URL(p.base.productUrl).hostname)])],
    minRefreshHours: 12,
    staleAfterHours: STALE_AFTER_HOURS,
    async collect(fetcher): Promise<Collected> {
      const result: Collected = { documents: [], offers: [], terms: [], warnings: [] };
      for (const page of pages) {
        try {
          const html = await fetcher.text(page.base.productUrl);
          const offers = page.parse(html, page.base);
          const terms = page.terms?.(html);
          result.documents.push({ url: page.base.productUrl, payload: { ...rawPayload(html, offers), terms } });
          result.offers!.push(...offers.map((o) => ({ ...o, sourceUrl: page.base.productUrl })));
          if (terms) {
            // A page may yield several products (e.g. savings with and without top-ups).
            for (const productKey of new Set(offers.map((o) => o.productKey))) {
              result.terms!.push({ productKey, terms, sourceUrl: page.base.productUrl });
            }
          }
        } catch (e) {
          // One broken product page must not discard the bank's other pages.
          result.warnings!.push(`${page.base.productKey}: ${(e as Error).message}`);
        }
      }
      if (!result.offers!.length) throw new Error(result.warnings!.join('; ') || 'No rates extracted');
      return result;
    },
  };
}

const ACTIVE: SourceAdapter[] = [
  bank('abb', 'ABB', 'https://abb-bank.az', [
    withTerms(dep('classic', 'Classic term deposit', 'https://abb-bank.az/ferdi/emanetler/klassik-emaneti', d.abb), TERMS.abbClassic),
    withTerms(dep('digital', 'DigiDeposit', 'https://abb-bank.az/ferdi/emanetler/digideposit', d.abb), TERMS.abbDigital),
    loan('https://abb-bank.az/ferdi/kreditler/nagd-kredit', { rate: '{n}%-dən İllik faiz dərəcəsi', maxTermMonths: 60, amountMax: 70000 }),
  ]),
  bank('access', 'AccessBank', 'https://www.accessbank.az', [
    withTerms(dep('term', 'Term deposit', 'https://www.accessbank.az/az/private/deposits/timed/', d.accessTimed), TERMS.access),
    withTerms(dep('online', 'MyAccess online term deposit', 'https://www.accessbank.az/az/private/deposits/myaccess-muddetli/', d.accessOnline), TERMS.access),
  ]),
  bank('afb', 'AFB Bank', 'https://www.afb.az', [
    withTerms(dep('term', 'Term deposit', 'https://www.afb.az/muddetli-emanet', d.afbTerm), TERMS.afb),
    dep('high-yield', 'High-yield deposit campaign', 'https://afb.az/yuksek-qazancli-emanet', d.afbCampaign),
    loan('https://www.afb.az/nagd-pul-krediti', { rate: 'Faiz dərəcəsi {n}%-d[ae]n başlayaraq', apr: '\\(FİFD\\) {n}%\\s*-\\s*{n}%', maxTermMonths: 59, amountMax: 80000 }),
  ], 'The server sends an incomplete TLS certificate chain, which Node.js rejects. Certificate verification is never disabled, so rates stay unavailable until the bank fixes its configuration.'),
  bank('bankofbaku', 'Bank of Baku', 'https://www.bankofbaku.com', [
    withTerms(dep('dynamic', 'Dynamic deposit', 'https://www.bankofbaku.com/az/emanetler/dinamik-emanet', d.bankOfBaku, { productType: 'term_deposit', conditions: 'Partial withdrawals permitted' }), TERMS.bankOfBakuDynamic),
    withTerms(dep('digital', 'Digital deposit', 'https://www.bankofbaku.com/az/emanetler/digital-depozit', d.bankOfBaku), TERMS.bankOfBaku),
    loan('https://www.bankofbaku.com/az/kreditler/nagd-pul-krediti', { rate: '{n}% - {n}% İllik faiz dərəcəsi', maxTermMonths: 59, amountMax: 80000 }),
  ]),
  bank('express', 'Express Bank', 'https://expressbank.az', [
    withTerms(dep('classic', 'Classic deposit', 'https://expressbank.az/az/deposit/klassik-emanet', d.express), TERMS.express),
    loan('https://expressbank.az/az/credit/nagd-istehlak-krediti', { rate: 'İllik faiz dərəcəsi - min: {n}% - maks: {n}%', apr: '{n}% - {n}% Min\\. və maks\\. FİFD', maxTermMonths: 59 }),
  ]),
  bank('premium', 'Premium Bank', 'https://www.premiumbank.az', [
    withTerms(dep('premium', 'Premium deposit', 'https://www.premiumbank.az/emanet', d.premium), TERMS.premium),
    loan('https://www.premiumbank.az/kreditler/nagd-pul-krediti', { rate: 'İllik faiz dərəcəsi {n}% Komissiya', apr: '\\(FİFD\\): min\\. {n}%, maks\\. {n}%', maxTermMonths: 59, amountMax: 80000 }),
  ]),
  bank('rabita', 'Rabitabank', 'https://www.rabitabank.com', [
    withTerms(dep('universal', 'Universal deposit', 'https://www.rabitabank.com/ferdi/emanetler-az/universal-emanet-az', d.rabitaUniversal), TERMS.rabitaUniversal),
    dep('dollar-campaign', 'Dollar deposit campaign', 'https://www.rabitabank.com/ferdi/emanetler-az/dollar-emaneti', d.rabitaDollar),
    loan('https://www.rabitabank.com/ferdi/kredit-sifarisi-kreditler/nagd-pul-krediti-rabitabank', { rate: 'Faiz {n}%-dən', apr: 'FİFD min\\.\\s*{n}% - maks\\.\\s*{n}%', maxTermMonths: 59, amountMax: 70000 }),
  ]),
  bank('respublika', 'Bank Respublika', 'https://www.bankrespublika.az', [
    withTerms(dep('term', 'Term deposit', 'https://www.bankrespublika.az/az/pages/muddetli-depozit', d.respublika), TERMS.respublika),
    loan('https://www.bankrespublika.az/az/loans-for-individuals/nagd-pul-krediti', { rate: 'Faiz dərəcəsi: {n}%\\s*-dən', apr: 'FIFD min\\. {n}% maks\\. {n}%', maxTermMonths: 59, amountMax: 50000 }),
  ]),
  bank('unibank', 'Unibank', 'https://unibank.az', [
    withTerms(dep('term', 'Term deposit', 'https://unibank.az/az/deposits/view/10/muddetli', d.unibankTerm), TERMS.unibankTerm),
    withTerms(dep('savings', 'Savings deposit', 'https://unibank.az/az/deposits/view/11/yigim', d.unibankSavings, { productType: 'savings_deposit', conditions: 'Interest capitalised monthly, paid at maturity' }), TERMS.unibankSavings),
    loan('https://unibank.az/az/loans/view/22/nagd_kreditler', { rate: 'İllik faiz dərəcəsi {n}\\s*-\\s*{n}%', maxTermMonths: 60, amountMax: 70000 }),
  ]),
  bank('vtb', 'Bank VTB (Azerbaijan)', 'https://vtb.az', [
    withTerms(dep('affordable', 'Affordable savings deposit', 'https://vtb.az/personal/deposits/affordable-savings/', d.vtbSavings), TERMS.vtb),
    withTerms(dep('advance', 'Advance-interest deposit', 'https://vtb.az/personal/deposits/advance-savings/', d.vtbAdvance, { conditions: 'Interest paid upfront when the deposit is opened' }), TERMS.vtb),
    loan('https://vtb.az/personal/loans/', { rate: 'Faiz dərəcəsi {n}\\s*%-dən FİFD', apr: 'FİFD {n}% - {n}%', maxTermMonths: 59, amountMax: 100000 }),
  ]),
  bank('yelo', 'Yelo Bank', 'https://www.yelo.az', [
    withTerms(dep('fixed', 'Yelo Sabit term deposit', 'https://www.yelo.az/az/individuals/deposits/yelo-sabit/', d.yeloTerm), TERMS.yelo),
    dep('flexible', 'Yelo Sərbəst flexible deposit', 'https://www.yelo.az/az/individuals/deposits/yelo-serbest/', d.yeloFlexible, { productType: 'flexible_deposit' }),
    loan('https://www.yelo.az/az/individuals/loans/consumer-loan/', { rate: 'İllik faiz dərəcəsi min\\. {n}%', apr: '\\(FİFD\\): min\\. {n}%, maks\\. {n}%', maxTermMonths: 59, amountMax: 80000 }),
  ]),
  bank('ziraat', 'Ziraat Bank Azerbaijan', 'https://ziraatbank.az', [
    withTerms(dep('standard', 'Standard term deposit', 'https://ziraatbank.az/term-deposits', d.ziraat), TERMS.ziraat),
    loan('https://ziraatbank.az/istehlak-krediti', { rate: 'İllik faiz dərəcəsi: min\\.{n}%', apr: 'FİFD: min\\.{n}%, max\\. {n}%', maxTermMonths: 59, amountMax: 50000 }),
  ]),
];

// ---- Sources that could not be collected: documented, never bypassed ------------

const feedSchema = z.object({
  offers: z.array(
    z.object({
      productKey: z.string().min(1).max(80),
      productName: z.string().min(1).max(160),
      productType: z.enum(['term_deposit', 'savings_deposit', 'flexible_deposit', 'consumer_loan']),
      productUrl: z.url().startsWith('https://'),
      currency: z.enum(['AZN', 'USD', 'EUR']),
      termMin: z.number().int().positive().nullable(),
      termMax: z.number().int().positive().nullable(),
      payout: z.enum(['monthly', 'quarterly', 'at_maturity', 'upfront', 'unspecified']),
      variant: z.enum(['standard', 'campaign', 'uninsured', 'legacy_renewal']),
      rate: z.number().positive(),
      observedDate: z.iso.date().nullish(),
      conditions: z.string().max(1000).nullish(),
    }),
  ).min(1).max(1000),
});

/**
 * Configurable adapter for a bank that cannot be scraped: when the operator has a
 * licensed/authorised JSON feed, set SOURCE_FEED_<NAME>_URL to enable it.
 */
export function unavailableBank(slug: string, name: string, website: string, reason: string, env: Record<string, string | undefined> = process.env): SourceAdapter {
  const feed = env[`SOURCE_FEED_${slug.toUpperCase()}_URL`];
  const common = {
    key: `bank_${slug}`,
    publisher: name,
    bank: { slug, name, website },
    minRefreshHours: 12,
    staleAfterHours: STALE_AFTER_HOURS,
  };
  if (!feed) {
    return {
      ...common, name: `${name} — not collected`, kind: 'bank_website', url: website, format: '—', updateFrequency: '—',
      accessStatus: 'unavailable', accessNote: reason, hosts: [],
    };
  }
  return {
    ...common,
    name: `${name} — partner JSON feed`,
    kind: 'partner_feed',
    url: feed,
    format: 'JSON',
    updateFrequency: 'Operator-defined',
    accessStatus: 'active',
    accessNote: 'Operator-configured authorised feed',
    hosts: [new URL(feed).hostname],
    async collect(fetcher) {
      const parsed = feedSchema.parse(JSON.parse(await fetcher.text(feed)));
      return {
        documents: [{ url: feed, payload: parsed }],
        offers: parsed.offers.map((o) => ({ ...o, sourceUrl: feed })),
      };
    },
  };
}

export function bankAdapters(): SourceAdapter[] {
  return [
    ...ACTIVE,
    unavailableBank('kapital', 'Kapital Bank', 'https://www.kapitalbank.az', 'Website returns HTTP 403 to automated clients. Protection is respected, not bypassed.'),
    unavailableBank('pasha', 'PASHA Bank', 'https://www.pashabank.az', 'Public page states only a headline "up to" rate without a term table, so it is not comparable.'),
    unavailableBank('xalq', 'Xalq Bank', 'https://www.xalqbank.az', 'Term-level rate table is not present in the public page source (headline rate only).'),
    unavailableBank('atb', 'Azer-Turk Bank', 'https://atb.az', 'Website returns HTTP 403 to automated clients. Protection is respected, not bypassed.'),
    unavailableBank('turan', 'TuranBank', 'https://www.turanbank.az', 'No public deposit rate page with a term table was identified.'),
  ];
}
