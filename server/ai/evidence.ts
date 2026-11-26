/**
 * Retrieval step: turns a question into numbered evidence items computed from
 * the database. The assistant may state facts only from these items.
 */
import type { Db } from '../db/client.js';
import * as repo from '../repo.js';
import { loadIndexInput } from '../analytics.js';
import { computeIndex } from '../../shared/index-score.js';
import { describe, linearRegression, probAbove } from '../../shared/stats.js';
import { exPostRealRates, realRate, referenceMonth } from '../../shared/finance.js';
import { selectOffers } from '../../shared/selection.js';
import type { Currency, RateRow } from '../../shared/types.js';

export type Lang = 'en' | 'az';

export interface Evidence {
  id: string;
  kind: 'observation' | 'calculation';
  text: string;
  date: string | null;
  sources: { name: string; url: string }[];
}

export type Topic = 'offers' | 'official' | 'inflation' | 'loans' | 'policy' | 'index' | 'trend' | 'stats';

/** Matches word beginnings only (suffixes are allowed for Azerbaijani morphology). */
const words = (list: string) => new RegExp(`(?<![\\p{L}])(?:${list})`, 'iu');

const TOPIC_WORDS: Record<Topic, RegExp> = {
  offers: words('deposit|depozit|əmanət|bank|competitive|offer|təklif|rəqabət|usd|eur|dollar|avro'),
  official: words('average|orta|market|bazar|changed|dəyiş|official|rəsmi|rates?(?![\\p{L}])|faiz'),
  inflation: words('inflation|inflyasiya|real(?![\\p{L}])|real return|purchasing|alıcılıq'),
  loans: words('loan|kredit|lending|borrow'),
  policy: words('policy|refinanc|central bank|uçot|mərkəzi bank|monetary'),
  index: words('competitive|ranking|best|index|score|rəqabət|ən yaxşı|reytinq|indeks'),
  trend: words('trend|changed|history|over time|dəyiş|tarix|dinamika'),
  stats: words('standard deviation|variance|median|mean(?![\\p{L}])|probab|spread|kənarlaşma|dispersiya|ehtimal|statisti'),
};

export const detectTopics = (question: string): Topic[] => (Object.keys(TOPIC_WORDS) as Topic[]).filter((t) => TOPIC_WORDS[t].test(question));

export function detectTerm(question: string): number {
  const m = /(\d{1,2})[\s-]*(?:month|mo\b|ay)/iu.exec(question);
  const year = /(\d)[\s-]*(?:year|il\b|illik)/iu.exec(question);
  const v = m ? Number(m[1]) : year ? Number(year[1]) * 12 : 12;
  return v >= 1 && v <= 60 ? v : 12;
}

const fx = (v: number) => v.toFixed(2);

export async function gatherEvidence(db: Db, question: string, lang: Lang): Promise<Evidence[]> {
  const topics = detectTopics(question);
  if (!topics.length) return [];
  const L = (en: string, az: string) => (lang === 'en' ? en : az);
  const items: Omit<Evidence, 'id'>[] = [];
  const has = (t: Topic) => topics.includes(t);

  const rates = (await repo.loadRates(db)).filter((r) => r.freshness === 'fresh');
  const rateSources = (rows: RateRow[]) => [...new Map(rows.map((r) => [r.sourceUrl, { name: r.bankName, url: r.sourceUrl }])).values()];
  const lastDate = (rows: RateRow[]) => rows.map((r) => r.lastVerifiedAt).sort().at(-1)?.slice(0, 10) ?? null;
  const term = detectTerm(question);
  const offersFor = (currency: Currency) =>
    selectOffers(rates, { productType: 'term_deposit', currency, term, payout: 'at_maturity', includeCampaigns: false, includeUninsured: false, perBank: true });

  if (has('offers') || has('stats') || has('index')) {
    const q = question.toLowerCase();
    const named = (['AZN', 'USD', 'EUR'] as Currency[]).filter((c) => q.includes(c.toLowerCase()) || (c === 'USD' && /dollar/.test(q)));
    for (const currency of named.length ? named : (['AZN'] as Currency[])) {
      const rows = offersFor(currency);
      if (!rows.length) continue;
      const s = describe(rows.map((r) => r.rate));
      items.push({
        kind: 'observation', date: lastDate(rows), sources: rateSources(rows),
        text: L(
          `Best standard ${term}-month ${currency} term deposit per bank, interest at maturity: ${rows.map((r) => `${r.bankName} ${fx(r.rate)}%`).join('; ')}.`,
          `Hər bankın ən yaxşı standart ${term} aylıq ${currency} müddətli depoziti, faiz sonda: ${rows.map((r) => `${r.bankName} ${fx(r.rate)}%`).join('; ')}.`,
        ),
      });
      const above = probAbove(rows.map((r) => r.rate), s.median ?? 0)!;
      items.push({
        kind: 'calculation', date: lastDate(rows), sources: rateSources(rows),
        text: L(
          `Across these ${s.n} ${currency} offers: mean ${fx(s.mean!)}%, median ${fx(s.median!)}%, minimum ${fx(s.min!)}%, maximum ${fx(s.max!)}%, sample standard deviation ${s.sdSample === null ? 'n/a' : fx(s.sdSample)} percentage points; ${above.favourable} of ${above.total} are above the median.`,
          `Bu ${s.n} ${currency} təklifi üzrə: orta ${fx(s.mean!)}%, median ${fx(s.median!)}%, minimum ${fx(s.min!)}%, maksimum ${fx(s.max!)}%, seçmə standart kənarlaşması ${s.sdSample === null ? '—' : fx(s.sdSample)} faiz bəndi; ${above.total} təklifdən ${above.favourable}-i mediandan yüksəkdir.`,
        ),
      });
    }
  }

  const officialSource = await repo.loadSeriesInfo(db, 'cbar_rates');
  const cpiSource = await repo.loadSeriesInfo(db, 'cbar_cpi');
  const src = (s: typeof officialSource) => (s ? [{ name: s.name, url: s.url }] : []);
  const series = async (metric: 'deposit_rate' | 'loan_rate') =>
    (await repo.loadMarket(db, { metric, basis: 'new_business', segment: 'total', bucket: 'all', currencyGroup: 'AZN' })).map((p) => ({ month: referenceMonth(p.periodDate), value: p.rate }));
  const dep = await series('deposit_rate');
  const cpi = (await repo.loadInflation(db)).filter((i) => i.yoy !== null).map((i) => ({ month: i.month, value: i.yoy! }));
  const latest = dep.at(-1);

  if (latest && (has('official') || has('trend') || has('inflation'))) {
    const yearAgo = dep.at(-13);
    items.push({
      kind: 'observation', date: latest.month, sources: src(officialSource),
      text: L(
        `Official average rate on new AZN time deposits: ${fx(latest.value)}% in ${latest.month.slice(0, 7)}${yearAgo ? `, compared with ${fx(yearAgo.value)}% in ${yearAgo.month.slice(0, 7)}` : ''}.`,
        `Yeni AZN müddətli depozitlərin rəsmi orta faizi: ${latest.month.slice(0, 7)} ayında ${fx(latest.value)}%${yearAgo ? `, ${yearAgo.month.slice(0, 7)} ayında isə ${fx(yearAgo.value)}%` : ''}.`,
      ),
    });
    const recent = dep.slice(-36);
    const fit = linearRegression(recent.map((_, i) => i / 12), recent.map((x) => x.value));
    if (fit && has('trend')) {
      items.push({
        kind: 'calculation', date: latest.month, sources: src(officialSource),
        text: L(
          `Linear fit over the last ${fit.n} months: ${fx(fit.slope)} percentage points per year, R² ${fx(fit.r2)}. This describes the past and is not a forecast.`,
          `Son ${fit.n} ay üzrə xətti uyğunlaşdırma: ildə ${fx(fit.slope)} faiz bəndi, R² ${fx(fit.r2)}. Bu keçmişi təsvir edir, proqnoz deyil.`,
        ),
      });
    }
  }
  const inf = cpi.at(-1);
  if (inf && has('inflation')) {
    items.push({ kind: 'observation', date: inf.month, sources: src(cpiSource), text: L(`12-month CPI inflation: ${fx(inf.value)}% in ${inf.month.slice(0, 7)}.`, `12 aylıq İQİ inflyasiyası: ${inf.month.slice(0, 7)} ayında ${fx(inf.value)}%.`) });
    if (latest) {
      items.push({
        kind: 'calculation', date: inf.month, sources: [...src(officialSource), ...src(cpiSource)],
        text: L(
          `Current real rate = (1 + ${fx(latest.value)}%) / (1 + ${fx(inf.value)}%) − 1 = ${fx(realRate(latest.value, inf.value))}% per year, before tax.`,
          `Cari real faiz = (1 + ${fx(latest.value)}%) / (1 + ${fx(inf.value)}%) − 1 = illik ${fx(realRate(latest.value, inf.value))}%, vergidən əvvəl.`,
        ),
      });
    }
    const real = exPostRealRates(dep.map((x) => ({ month: x.month, rate: x.value })), cpi.map((x) => ({ month: x.month, yoy: x.value }))).at(-1);
    if (real) {
      items.push({
        kind: 'calculation', date: real.month, sources: [...src(officialSource), ...src(cpiSource)],
        text: L(
          `Realised: a deposit at the ${real.contractedIn.slice(0, 7)} average of ${fx(real.nominal)}% held to ${real.month.slice(0, 7)} (inflation ${fx(real.inflation)}%) returned ${fx(real.real)}% in real terms.`,
          `Reallaşmış: ${real.contractedIn.slice(0, 7)} orta faizi ${fx(real.nominal)}% ilə ${real.month.slice(0, 7)} ayınadək (inflyasiya ${fx(real.inflation)}%) saxlanılan depozit real ${fx(real.real)}% gəlir verib.`,
        ),
      });
    }
  }
  if (has('loans')) {
    const loan = (await series('loan_rate')).at(-1);
    if (loan) items.push({ kind: 'observation', date: loan.month, sources: src(officialSource), text: L(`Official average rate on new AZN loans: ${fx(loan.value)}% in ${loan.month.slice(0, 7)}.`, `Yeni AZN kreditlərinin rəsmi orta faizi: ${loan.month.slice(0, 7)} ayında ${fx(loan.value)}%.`) });
  }
  if (has('policy')) {
    const p = (await repo.loadPolicy(db)).at(-1);
    if (p && p.refinancing !== null) items.push({ kind: 'observation', date: p.month, sources: src(cpiSource), text: L(`CBAR refinancing rate ${fx(p.refinancing)}% in ${p.month.slice(0, 7)}; corridor ${fx(p.floor!)}% to ${fx(p.ceiling!)}%.`, `AMB uçot dərəcəsi ${p.month.slice(0, 7)} ayında ${fx(p.refinancing)}%; dəhliz ${fx(p.floor!)}% – ${fx(p.ceiling!)}%.`) });
  }
  if (has('index')) {
    const scores = computeIndex(await loadIndexInput(db)).filter((s) => s.score !== null).slice(0, 5);
    if (scores.length) {
      items.push({
        kind: 'calculation', date: lastDate(rates), sources: rateSources(rates.filter((r) => scores.some((s) => s.bankSlug === r.bankSlug))),
        text: L(
          `AZFI Bank Intelligence Index (deposit product competitiveness, not a safety rating), top ${scores.length}: ${scores.map((s) => `${s.bankName} ${s.score!.toFixed(1)}${s.provisional ? ' (provisional)' : ''}`).join('; ')}.`,
          `AZFI bank indeksi (depozit məhsullarının rəqabətqabiliyyəti, təhlükəsizlik reytinqi deyil), ilk ${scores.length}: ${scores.map((s) => `${s.bankName} ${s.score!.toFixed(1)}${s.provisional ? ' (ilkin)' : ''}`).join('; ')}.`,
        ),
      });
    }
  }
  // Nothing without a citable source is offered as evidence.
  return items.filter((e) => e.sources.length).map((e, i) => ({ id: `E${i + 1}`, ...e }));
}
