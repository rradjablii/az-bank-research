import * as cheerio from 'cheerio';
import { parseRate, parseTerms, squash, tables } from '../../html.js';
import type { OfferRecord } from '../../types.js';
import {
  LayoutChanged, assertAznAboveUsd, columns, currencyOf, key, offer, payoutOf, rateTables, readTermTable, requireOffers,
  type ProductBase,
} from './common.js';
import type { Currency, Payout, Variant } from '../../../../shared/types.js';

/** Each parser receives the page HTML and the product descriptor. */
export type DepositParser = (html: string, base: ProductBase) => OfferRecord[];

// ---- Access Bank ------------------------------------------------------------

export const accessTimed: DepositParser = (html, base) => {
  const grids = rateTables(html).filter((g) => g.some((r) => r.some((c) => /Standard faiz/i.test(c))));
  if (grids.length !== 2) throw new LayoutChanged('expected AZN and USD tables');
  const [azn, usd] = grids.map((grid, i) =>
    readTermTable(base, grid, (label) => {
      const k = key(label);
      const variant: Variant | null = /aksiya/.test(k) ? 'campaign' : /prolonqasiya/.test(k) ? 'legacy_renewal' : /standard/.test(k) ? 'standard' : null;
      // Second header row carries the payout; the first may also mention "automatic renewal".
      const payout: Payout | null = /aylıqödənişi/.test(k) ? 'monthly' : /sonundaödənişi/.test(k) ? 'at_maturity' : null;
      if (!variant || !payout) throw new LayoutChanged(`unrecognised column "${label.slice(0, 60)}"`);
      return { currency: i === 0 ? 'AZN' : 'USD', payout, variant };
    }),
  );
  assertAznAboveUsd(azn!, usd!);
  return requireOffers([...azn!, ...usd!], 10);
};

/** Two tables [term | monthly | maturity], AZN tab first then USD. */
function twoCurrencyTabs(base: ProductBase, grids: string[][][]): OfferRecord[] {
  if (grids.length !== 2) throw new LayoutChanged(`expected 2 tables, found ${grids.length}`);
  const [azn, usd] = grids.map((grid, i) =>
    readTermTable(base, grid, (label) => {
      const payout = payoutOf(label);
      return payout ? { currency: i === 0 ? 'AZN' : 'USD', payout, variant: 'standard' } : null;
    }),
  );
  assertAznAboveUsd(azn!, usd!);
  return requireOffers([...azn!, ...usd!], 8);
}

export const accessOnline: DepositParser = (html, base) => twoCurrencyTabs(base, rateTables(html));

// ---- Bank Respublika ---------------------------------------------------------

export const respublika: DepositParser = (html, base) => twoCurrencyTabs(base, rateTables(html));

// ---- AFB Bank ----------------------------------------------------------------

/** One table holding two blocks (at maturity, then monthly) with columns AZN | USD. */
export const afbTerm: DepositParser = (html, base) => {
  const grid = rateTables(html)[0];
  if (!grid) throw new LayoutChanged('rate table missing');
  const { labels, rows } = columns(grid);
  const blocks: string[][][] = [[]];
  let last = 0;
  for (const row of rows) {
    const term = parseTerms(row[0] ?? '')[0];
    if (!term) continue;
    if (term.min <= last) blocks.push([]);
    blocks.at(-1)!.push(row);
    last = term.min;
  }
  if (blocks.length !== 2) throw new LayoutChanged('expected two payout blocks');
  const header = grid.slice(0, grid.length - rows.length);
  const [maturity, monthly] = blocks.map((block, i) =>
    readTermTable(base, [...header, ...block], (label) => {
      const currency = currencyOf(label);
      return currency ? { currency, payout: i === 0 ? 'at_maturity' : 'monthly', variant: 'standard' } : null;
    }),
  );
  const avg = (o: OfferRecord[]) => o.reduce((s, x) => s + x.rate, 0) / o.length;
  if (!labels.some((l) => currencyOf(l) === 'AZN') || avg(maturity!) < avg(monthly!)) {
    throw new LayoutChanged('payout block order cannot be verified');
  }
  return requireOffers([...maturity!, ...monthly!], 10);
};

export const afbCampaign: DepositParser = (html, base) => {
  const grid = rateTables(html)[0];
  if (!grid) throw new LayoutChanged('rate table missing');
  return requireOffers(
    readTermTable(base, grid, (label) => {
      const currency = currencyOf(label);
      const payout = payoutOf(label);
      return currency && payout ? { currency, payout, variant: 'campaign' } : null;
    }),
    8,
  );
};

// ---- Bank of Baku (rates shipped as JSON in the server-rendered page) ---------

interface BobPercent {
  currencyType: string;
  monthFrom: number;
  monthTo: number;
  percent: number;
  endOfPeriod: number;
  insuredInterest: number;
  insuredInterestEndOfPeriod: number;
}

function findKey(node: unknown, name: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  const o = node as Record<string, unknown>;
  if (name in o) return o[name];
  for (const v of Object.values(o)) {
    const hit = findKey(v, name);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export const bankOfBaku: DepositParser = (html, base) => {
  const json = cheerio.load(html)('script#ng-state').text();
  if (!json) throw new LayoutChanged('ng-state data missing');
  const details = findKey(JSON.parse(json), 'percentDetails') as BobPercent[] | undefined;
  if (!Array.isArray(details)) throw new LayoutChanged('percentDetails missing');
  const out: OfferRecord[] = [];
  for (const d of details) {
    const currency = currencyOf(d.currencyType);
    if (!currency || !(d.monthFrom >= 1)) continue;
    const term = { min: d.monthFrom, max: d.monthTo };
    for (const [payout, listed, insured] of [
      ['monthly', d.percent, d.insuredInterest],
      ['at_maturity', d.endOfPeriod, d.insuredInterestEndOfPeriod],
    ] as const) {
      // When a separate insured rate exists, the headline figure is the uninsured one.
      const split = insured > 0 && insured !== listed;
      if (listed > 0) out.push(offer(base, currency, term, payout, listed, split ? 'uninsured' : 'standard'));
      if (split) out.push(offer(base, currency, term, payout, insured, 'standard'));
    }
  }
  return requireOffers(out, 10);
};

// ---- Express Bank ------------------------------------------------------------

export const express: DepositParser = (html, base) => {
  const grids = rateTables(html).filter((g) => g.some((r) => parseTerms(r[0] ?? '').length));
  const out = grids.flatMap((grid) => {
    const payout = payoutOf(grid[0]?.[0] ?? '');
    if (!payout) throw new LayoutChanged('payout heading missing');
    return readTermTable(base, grid, (label) => {
      const currency = currencyOf(label);
      return currency ? { currency, payout, variant: /siğortasız/.test(key(label)) ? 'uninsured' : 'standard' } : null;
    });
  });
  return requireOffers(out, 10);
};

// ---- Premium Bank ------------------------------------------------------------

/** "500 ≤ x ≤ 100 000" style amount bands. */
export function parseAmountBand(s: string): { min: number | null; max: number | null } {
  const n = (x: string) => Number(x.replace(/[\s,]/g, ''));
  const t = squash(s);
  const both = /^([\d\s.]+?)\s*[≤<]\s*x\s*[≤<]\s*([\d\s.]+)$/.exec(t);
  if (both) return { min: n(both[1]!), max: n(both[2]!) };
  const lower = /^([\d\s.]+?)\s*[≤<]\s*x$/.exec(t);
  if (lower) return { min: n(lower[1]!), max: null };
  const range = /^([\d\s]+(?:\.\d+)?)\s*-\s*([\d\s]+(?:\.\d+)?)$/.exec(t);
  if (range) return { min: n(range[1]!), max: n(range[2]!) };
  const above = /^([\d\s]+(?:\.\d+)?)\s*və daha/.exec(t);
  return above ? { min: n(above[1]!), max: null } : { min: null, max: null };
}

export const premium: DepositParser = (html, base) => {
  const grid = rateTables(html)[0];
  if (!grid || !/Valyuta/i.test(grid[0]?.[0] ?? '')) throw new LayoutChanged('currency column missing');
  const out: OfferRecord[] = [];
  for (const row of grid) {
    const currency = currencyOf(row[0] ?? '') ?? (/euro/i.test(row[0] ?? '') ? 'EUR' : null);
    if (!currency) continue;
    const band = parseAmountBand(row[2] ?? '');
    const bounded = { ...base, amountMin: band.min, amountMax: band.max };
    for (const term of parseTerms(row[1] ?? '')) {
      for (const [col, payout] of [[3, 'monthly'], [4, 'at_maturity']] as const) {
        const rate = parseRate(row[col] ?? '');
        if (rate) out.push(offer(bounded, currency, term, payout, rate));
      }
    }
  }
  return requireOffers(out, 8);
};

// ---- Unibank -----------------------------------------------------------------

/** Tables sit in tab panes identified by data-id; the toggle link gives the label. */
function uniPanes(html: string) {
  const $ = cheerio.load(html);
  return $('div.siblings__content[data-id]')
    .toArray()
    .map((pane) => {
      const id = $(pane).attr('data-id')!;
      const label = squash($(`a[data-id="${id.replace(/[^\w-]/g, '')}"]`).first().text());
      return { label, grid: tables($.html(pane))[0] };
    })
    .filter((p) => p.grid);
}

export const unibankTerm: DepositParser = (html, base) => {
  const out: OfferRecord[] = [];
  for (const pane of uniPanes(html)) {
    const payout = payoutOf(pane.label);
    if (!payout) throw new LayoutChanged(`unknown tab "${pane.label}"`);
    const grid = pane.grid!;
    const currencies = grid[0]!.map(currencyOf);
    for (const row of grid.slice(1)) {
      for (const term of parseTerms(row[0] ?? '')) {
        currencies.forEach((currency, i) => {
          if (!currency) return;
          // "2.5/3 %" = insured rate / higher uninsured rate.
          (row[i] ?? '').split('/').forEach((part, n) => {
            const rate = parseRate(part);
            if (rate) out.push(offer(base, currency, term, payout, rate, n === 0 ? 'standard' : 'uninsured'));
          });
        });
      }
    }
  }
  return requireOffers(out, 8);
};

export const unibankSavings: DepositParser = (html, base) => {
  const out = uniPanes(html).flatMap((pane) => {
    const topUp = !/artımsız/.test(key(pane.label));
    const product = {
      ...base,
      productKey: `${base.productKey}-${topUp ? 'topup' : 'fixed'}`,
      productName: `${base.productName} (${topUp ? 'with monthly top-ups' : 'without monthly top-ups'})`,
    };
    return readTermTable(product, pane.grid!, (label) => {
      const currency = currencyOf(label);
      return currency ? { currency, payout: 'at_maturity', variant: 'standard' } : null;
    });
  });
  return requireOffers(out, 2);
};

// ---- Bank VTB (Azerbaijan) ----------------------------------------------------

export const vtbSavings: DepositParser = (html, base) => {
  const grid = rateTables(html).find((g) => g.some((r) => r.some((c) => c === 'AZN')));
  if (!grid) throw new LayoutChanged('rate table missing');
  return requireOffers(
    readTermTable(base, grid, (label) => {
      const currency = currencyOf(label);
      const payout = payoutOf(label);
      return currency && payout ? { currency, payout, variant: 'standard' } : null;
    }),
    10,
  );
};

export const vtbAdvance: DepositParser = (html, base) => {
  if (!/dərhal sonra/.test(cheerio.load(html).text())) throw new LayoutChanged('upfront-interest description missing');
  const grid = rateTables(html).find((g) => /müddəti/i.test(g[0]?.[0] ?? '') && /Faiz/i.test(g[0]?.[1] ?? ''));
  if (!grid) throw new LayoutChanged('rate table missing');
  return requireOffers(readTermTable(base, grid, () => ({ currency: 'AZN', payout: 'upfront', variant: 'standard' })), 3);
};

// ---- Yelo Bank ----------------------------------------------------------------

export const yeloTerm: DepositParser = (html, base) => {
  const grid = rateTables(html).find((g) => /Müddət/.test(g[0]?.[0] ?? '') && g[0]!.some((c) => /^AZN/.test(c)));
  if (!grid) throw new LayoutChanged('rate table missing');
  const out: OfferRecord[] = [];
  for (const row of grid.slice(1)) {
    for (const term of parseTerms(row[0] ?? '')) {
      grid[0]!.forEach((label, i) => {
        const currency = i > 0 ? currencyOf(label) : null;
        if (!currency) return;
        // Each cell holds two figures: monthly payout, then at maturity.
        const parts = (row[i] ?? '').match(/\d+(?:[.,]\d+)?\s*%|-/g) ?? [];
        if (parts.length !== 2) throw new LayoutChanged(`expected two rates in "${row[i]}"`);
        (['monthly', 'at_maturity'] as const).forEach((payout, n) => {
          const rate = parseRate(parts[n]!);
          if (rate) out.push(offer(base, currency, term, payout, rate));
        });
      });
    }
  }
  return requireOffers(out, 8);
};

export const yeloFlexible: DepositParser = (html, base) => {
  const out = rateTables(html).flatMap((grid) => {
    const currency = currencyOf(grid[0]?.[1] ?? '');
    if (!currency || !/Məbləğ/.test(grid[0]?.[0] ?? '')) return [];
    return grid.slice(1).flatMap((row) => {
      const rate = parseRate(row[1] ?? '');
      const band = parseAmountBand(row[0] ?? '');
      return rate ? [offer({ ...base, amountMin: band.min, amountMax: band.max }, currency, null, 'monthly', rate)] : [];
    });
  });
  return requireOffers(out, 2);
};

// ---- Ziraat Bank Azerbaijan ----------------------------------------------------

export const ziraat: DepositParser = (html, base) => {
  const date = /(\d{2})\.(\d{2})\.(\d{4})\s*Əmanət üzrə faiz dərəcələri/.exec(squash(cheerio.load(html)('body').text()));
  const product = { ...base, observedDate: date ? `${date[3]}-${date[2]}-${date[1]}` : null };
  const out = rateTables(html)
    .filter((g) => /Standard Əmanət/i.test(g[0]?.[0] ?? ''))
    .flatMap((grid) => {
      const payout = payoutOf(grid[0]![0]!);
      if (!payout) throw new LayoutChanged('payout heading missing');
      return readTermTable(product, grid, (label) => {
        const currency = /\b(AZN|USD|EUR)\b/.exec(label)?.[1] as Currency | undefined;
        return currency ? { currency, payout, variant: 'standard' } : null;
      });
    });
  return requireOffers(out, 20);
};

// ---- Rabitabank ----------------------------------------------------------------

export const rabitaUniversal: DepositParser = (html, base) => {
  const heads: Record<string, Payout> = { Müddət: 'at_maturity', Rüblük: 'quarterly', Valyuta: 'monthly' };
  const out: OfferRecord[] = [];
  for (const grid of rateTables(html)) {
    const payout = heads[grid[0]?.[0] ?? ''];
    if (!payout) continue;
    out.push(
      ...readTermTable(base, grid, (label) => {
        const currency = currencyOf(label);
        return currency ? { currency, payout, variant: 'standard' } : null;
      }),
    );
  }
  const at = (p: Payout) => out.find((o) => o.currency === 'AZN' && o.termMin === 12 && o.payout === p)?.rate ?? 0;
  if (!(at('at_maturity') >= at('quarterly') && at('quarterly') >= at('monthly') && at('monthly') > 0)) {
    throw new LayoutChanged('payout tables cannot be verified');
  }
  return requireOffers(out, 20);
};

export const rabitaDollar: DepositParser = (html, base) => {
  const grids = rateTables(html).filter((g) => /müddəti/i.test(g[0]?.[0] ?? '') && g[0]!.length === 3);
  const out = grids.flatMap((grid, i) => {
    const product = { ...base, productKey: `${base.productKey}-${i + 1}`, productName: `${base.productName} (package ${i + 1})` };
    return readTermTable(product, grid, (label) => {
      const payout = payoutOf(label);
      return payout ? { currency: 'USD', payout, variant: 'campaign' } : null;
    });
  });
  return requireOffers(out, 4);
};

// ---- ABB (tables are embedded in the Next.js page payload) ----------------------

/** Reassembles the React Server Components stream and returns tables per currency tab. */
export function abbCurrencyTables(html: string): { currency: Currency; html: string }[] {
  const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)<\/script>/g)]
    .map((m) => JSON.parse(m[1]!) as string)
    .join('');
  const bytes = Buffer.from(flight, 'utf8');
  const chunk = (id: string): string | null => {
    const m = new RegExp(`(?:^|\\n|[^0-9a-f])${id}:T([0-9a-f]+),`).exec(flight);
    if (!m) return null;
    const start = Buffer.byteLength(flight.slice(0, m.index + m[0].length), 'utf8');
    return bytes.subarray(start, start + parseInt(m[1]!, 16)).toString('utf8');
  };
  const out: { currency: Currency; html: string }[] = [];
  const trigger = /"title":"(AZN|USD|EUR)","__component":"tabs\.segment-control-trigger"\}\],"content":\[\{.{0,200}?"body":"\$([0-9a-f]+)"/g;
  for (const m of flight.matchAll(trigger)) {
    const body = chunk(m[2]!);
    if (body && body.includes('<table')) out.push({ currency: m[1] as Currency, html: body });
  }
  return out;
}

export const abb: DepositParser = (html, base) => {
  const seen = new Set<Currency>();
  const out = abbCurrencyTables(html).flatMap((tab) => {
    if (seen.has(tab.currency)) return [];
    const grid = rateTables(tab.html)[0];
    if (!grid || !/müddəti|^Müddət$/i.test(grid[0]?.[0] ?? '')) return [];
    seen.add(tab.currency);
    return readTermTable(base, grid, (label) => {
      const payout = payoutOf(label);
      return payout ? { currency: tab.currency, payout, variant: 'standard' } : null;
    });
  });
  if (!seen.has('AZN')) throw new LayoutChanged('AZN rate tab missing');
  return requireOffers(out, 8);
};
