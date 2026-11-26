/**
 * Research reports. A report is an immutable data snapshot (`ReportData`) plus
 * this pure renderer, so the web page and the PDF show identical numbers and a
 * published report never changes when newer data arrives.
 */
import { describe, histogram, linearRegression, probAbove, correlation, median } from './stats.js';
import { exPostRealRates, realRate, referenceMonth } from './finance.js';
import { selectOffers } from './selection.js';
import type { BankScore } from './index-score.js';
import type { Currency, InflationPoint, MarketPoint, PolicyPoint, RateRow } from './types.js';

export const REPORT_TYPES = ['monthly', 'quarterly', 'deposit_rates', 'inflation_real', 'currency', 'competitiveness'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportLang = 'en' | 'az';

export interface ReportData {
  type: ReportType;
  /** "2026-09" or "2026-Q3": the official-data period covered. */
  period: string;
  periodStart: string;
  periodEnd: string;
  /** Date the advertised offers in the snapshot were last verified. */
  offersAsOf: string | null;
  generatedAt: string;
  offers: RateRow[];
  market: MarketPoint[];
  inflation: InflationPoint[];
  policy: PolicyPoint[];
  index: BankScore[];
  indexHistoryDays: number;
  sources: { name: string; url: string; lastVerifiedAt: string | null }[];
}

export interface ReportTable { caption: string; head: string[]; rows: string[][] }
export interface ReportChart { caption: string; kind: 'line' | 'bar'; labels: string[]; series: { name: string; values: (number | null)[] }[] }
export interface ReportSection { heading: string; paragraphs: string[]; tables?: ReportTable[]; charts?: ReportChart[] }
export interface ReportDoc { title: string; subtitle: string; sections: ReportSection[] }

/** Last month, or last complete quarter, for which official data exist. */
export function reportPeriod(type: ReportType, latestMonth: string) {
  const [y, m] = latestMonth.split('-').map(Number) as [number, number];
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  if (type !== 'quarterly') return { period: latestMonth.slice(0, 7), start: iso(y, m), end: iso(y, m) };
  let q = Math.floor(m / 3);
  let year = y;
  if (q === 0) { q = 4; year--; }
  return { period: `${year}-Q${q}`, start: iso(year, q * 3 - 2), end: iso(year, q * 3) };
}

const TITLES: Record<ReportType, [string, string]> = {
  monthly: ['Monthly Azerbaijan Banking Market Report', 'Azərbaycan bank bazarının aylıq hesabatı'],
  quarterly: ['Quarterly Financial Market Review', 'Maliyyə bazarının rüblük icmalı'],
  deposit_rates: ['Deposit Interest Rate Analysis', 'Depozit faiz dərəcələrinin təhlili'],
  inflation_real: ['Inflation and Real Return Analysis', 'İnflyasiya və real gəlir təhlili'],
  currency: ['Currency Deposit Comparison', 'Valyutalar üzrə depozit müqayisəsi'],
  competitiveness: ['Historical Bank Competitiveness Report', 'Bankların rəqabətqabiliyyətliliyi üzrə hesabat'],
};
export const reportTitle = (type: ReportType, lang: ReportLang) => TITLES[type][lang === 'en' ? 0 : 1];

const QUESTIONS: Record<ReportType, [string, string]> = {
  monthly: ['Where did deposit and lending rates stand in the period, and how do advertised offers compare?', 'Dövrdə depozit və kredit faizləri hansı səviyyədə olub və elan edilən təkliflər necə müqayisə olunur?'],
  quarterly: ['How did official rates, inflation and the policy rate move over the quarter?', 'Rüb ərzində rəsmi faizlər, inflyasiya və uçot dərəcəsi necə dəyişib?'],
  deposit_rates: ['How are advertised 12-month manat deposit rates distributed across banks?', 'Elan edilən 12 aylıq manat depozit faizləri banklar üzrə necə paylanıb?'],
  inflation_real: ['Did average manat deposits preserve purchasing power?', 'Orta manat depozitləri alıcılıq qabiliyyətini qoruyubmu?'],
  currency: ['How do advertised deposit returns differ between AZN, USD and EUR?', 'Elan edilən depozit gəlirliliyi AZN, USD və EUR üzrə nə ilə fərqlənir?'],
  competitiveness: ['How competitive are banks’ deposit products under the AZFI index method?', 'AZFI indeks metodikasına görə bankların depozit məhsulları nə dərəcədə rəqabətqabiliyyətlidir?'],
};

export function renderReport(d: ReportData, lang: ReportLang): ReportDoc {
  const L = (en: string, az: string) => (lang === 'en' ? en : az);
  const nf = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : nf.format(v));
  const p = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${nf.format(v)}%`);
  const missing = L('Not enough observations in the snapshot.', 'Məlumat görüntüsündə kifayət qədər müşahidə yoxdur.');

  const series = (metric: 'deposit_rate' | 'loan_rate', group: 'AZN' | 'FX') =>
    d.market
      .filter((x) => x.metric === metric && x.currencyGroup === group && x.basis === 'new_business')
      .map((x) => ({ month: referenceMonth(x.periodDate), value: x.rate }))
      .filter((x) => x.month <= d.periodEnd);
  const dep = series('deposit_rate', 'AZN');
  const depFx = series('deposit_rate', 'FX');
  const loan = series('loan_rate', 'AZN');
  const cpi = d.inflation.filter((x) => x.yoy !== null && x.month <= d.periodEnd).map((x) => ({ month: x.month, value: x.yoy! }));
  const policy = d.policy.filter((x) => x.month <= d.periodEnd);
  const inPeriod = <T extends { month: string }>(xs: T[]) => xs.filter((x) => x.month >= d.periodStart);
  const at = (xs: { month: string; value: number }[]) => xs.find((x) => x.month === d.periodEnd)?.value ?? null;

  const offers = (currency: Currency, term = 12) =>
    selectOffers(d.offers, { productType: 'term_deposit', currency, term, payout: 'at_maturity', includeCampaigns: false, includeUninsured: false, perBank: true });
  const azn = offers('AZN');
  const stats = describe(azn.map((r) => r.rate));
  const monthsBack = (k: number) => dep.slice(-k);

  const officialTable: ReportTable = {
    caption: L('Official indicators (Central Bank of Azerbaijan)', 'Rəsmi göstəricilər (Azərbaycan Mərkəzi Bankı)'),
    head: [L('Month', 'Ay'), L('New AZN deposits', 'Yeni AZN depozitlər'), L('New FX deposits', 'Yeni valyuta depozitləri'), L('New AZN loans', 'Yeni AZN kreditlər'), L('Inflation, 12m', 'İnflyasiya, 12 ay'), L('Refinancing rate', 'Uçot dərəcəsi')],
    rows: monthsBack(d.type === 'quarterly' ? 6 : 4).map((m) => [
      m.month.slice(0, 7), p(m.value), p(depFx.find((x) => x.month === m.month)?.value), p(loan.find((x) => x.month === m.month)?.value),
      p(cpi.find((x) => x.month === m.month)?.value), p(policy.find((x) => x.month === m.month)?.refinancing),
    ]),
  };
  const trendChart: ReportChart = {
    caption: L('New AZN deposit rate and 12-month inflation, %', 'Yeni AZN depozit faizi və 12 aylıq inflyasiya, %'),
    kind: 'line',
    labels: monthsBack(36).map((x) => x.month.slice(0, 7)),
    series: [
      { name: L('Deposit rate', 'Depozit faizi'), values: monthsBack(36).map((x) => x.value) },
      { name: L('Inflation', 'İnflyasiya'), values: monthsBack(36).map((x) => cpi.find((c) => c.month === x.month)?.value ?? null) },
    ],
  };
  const offerTable: ReportTable = {
    caption: L('Best standard 12-month AZN term deposit per bank, interest at maturity', 'Hər bank üzrə ən yaxşı standart 12 aylıq AZN müddətli depozit, faiz sonda'),
    head: [L('Bank', 'Bank'), L('Product', 'Məhsul'), L('Rate', 'Faiz'), L('Verified', 'Yoxlanıb')],
    rows: azn.map((r) => [r.bankName, r.productName, p(r.rate), r.lastVerifiedAt.slice(0, 10)]),
  };
  const bins = histogram(azn.map((r) => r.rate), 0.5);
  const histChart: ReportChart = {
    caption: L('Distribution of those rates (number of banks per 0.5-point interval)', 'Həmin faizlərin paylanması (0,5 bəndlik intervalda bankların sayı)'),
    kind: 'bar',
    labels: bins.map((b) => `${n(b.from)}`),
    series: [{ name: L('Banks', 'Banklar'), values: bins.map((b) => b.count) }],
  };
  const dispersion = stats.n
    ? L(
        `${stats.n} banks: mean ${p(stats.mean)}, median ${p(stats.median)}, range ${p(stats.min)} to ${p(stats.max)}, sample standard deviation ${n(stats.sdSample)} points.`,
        `${stats.n} bank: orta ${p(stats.mean)}, median ${p(stats.median)}, interval ${p(stats.min)} – ${p(stats.max)}, seçmə standart kənarlaşması ${n(stats.sdSample)} bənd.`,
      )
    : missing;

  const findings: string[] = [];
  const sections: ReportSection[] = [];
  const depNow = at(dep);
  const cpiNow = at(cpi);
  const headline =
    depNow !== null && cpiNow !== null
      ? L(
          `In ${d.periodEnd.slice(0, 7)} new AZN time deposits averaged ${p(depNow)} against 12-month inflation of ${p(cpiNow)}, a current real rate of ${p(realRate(depNow, cpiNow))}.`,
          `${d.periodEnd.slice(0, 7)} ayında yeni AZN müddətli depozitlərin orta faizi ${p(depNow)}, 12 aylıq inflyasiya ${p(cpiNow)} olub; cari real faiz ${p(realRate(depNow, cpiNow))}.`,
        )
      : missing;

  if (d.type === 'monthly' || d.type === 'quarterly') {
    findings.push(headline);
    const first = inPeriod(dep)[0];
    if (d.type === 'quarterly' && first && depNow !== null) {
      findings.push(L(`Across the quarter the average new AZN deposit rate moved from ${p(first.value)} to ${p(depNow)}.`, `Rüb ərzində yeni AZN depozitlərin orta faizi ${p(first.value)}-dən ${p(depNow)}-ə dəyişib.`));
    }
    const lastLoan = at(loan);
    if (lastLoan !== null && depNow !== null) findings.push(L(`The loan–deposit spread on new AZN business was ${n(lastLoan - depNow)} points.`, `Yeni AZN əməliyyatlarında kredit–depozit fərqi ${n(lastLoan - depNow)} bənd olub.`));
    const pol = policy.at(-1);
    if (pol) findings.push(L(`The refinancing rate was ${p(pol.refinancing)} (corridor ${p(pol.floor)} to ${p(pol.ceiling)}).`, `Uçot dərəcəsi ${p(pol.refinancing)} olub (dəhliz ${p(pol.floor)} – ${p(pol.ceiling)}).`));
    findings.push(dispersion);
    sections.push({ heading: L('Statistical findings', 'Statistik nəticələr'), paragraphs: findings, tables: [officialTable, offerTable], charts: [trendChart] });
  } else if (d.type === 'deposit_rates') {
    const above = probAbove(azn.map((r) => r.rate), 10);
    findings.push(dispersion);
    if (above) findings.push(L(`${above.favourable} of ${above.total} banks (${n(above.p * 100)}%) offer more than 10%. This is a share of this snapshot, not a market-wide probability.`, `${above.total} bankdan ${above.favourable}-i (${n(above.p * 100)}%) 10%-dən yüksək təklif edir. Bu, bütün bazar üzrə ehtimal deyil, bu məlumat görüntüsündəki paydır.`));
    if (stats.cv !== null) findings.push(L(`Coefficient of variation ${n(stats.cv * 100)}%; interquartile range ${n(stats.iqr)} points.`, `Variasiya əmsalı ${n(stats.cv * 100)}%; kvartillərarası genişlik ${n(stats.iqr)} bənd.`));
    const stat: ReportTable = {
      caption: L('Descriptive statistics', 'Təsviri statistika'),
      head: [L('Measure', 'Göstərici'), L('Value', 'Qiymət')],
      rows: [['n', String(stats.n)], [L('Mean', 'Orta'), p(stats.mean)], ['Median', p(stats.median)], ['Q1', p(stats.q1)], ['Q3', p(stats.q3)], [L('Sample variance', 'Seçmə dispersiyası'), n(stats.varianceSample)], [L('Sample std. deviation', 'Seçmə standart kənarlaşması'), n(stats.sdSample)]],
    };
    sections.push({ heading: L('Statistical findings', 'Statistik nəticələr'), paragraphs: findings, tables: [stat, offerTable], charts: bins.length ? [histChart] : [] });
  } else if (d.type === 'inflation_real') {
    const real = exPostRealRates(dep.map((x) => ({ month: x.month, rate: x.value })), cpi.map((x) => ({ month: x.month, yoy: x.value })));
    const last = real.at(-1);
    findings.push(headline);
    if (last) findings.push(L(`A deposit at the ${last.contractedIn.slice(0, 7)} average (${p(last.nominal)}) held to ${last.month.slice(0, 7)} returned ${p(last.real)} in real terms before tax.`, `${last.contractedIn.slice(0, 7)} orta faizi (${p(last.nominal)}) ilə qoyulub ${last.month.slice(0, 7)} ayınadək saxlanılan depozit vergidən əvvəl real ${p(last.real)} gəlir gətirib.`));
    if (real.length) findings.push(L(`Realised real returns were negative in ${real.filter((x) => x.real < 0).length} of ${real.length} months with aligned data; the median was ${p(median(real.map((x) => x.real)))}.`, `Uzlaşdırılmış ${real.length} ayın ${real.filter((x) => x.real < 0).length}-də reallaşmış real gəlir mənfi olub; median ${p(median(real.map((x) => x.real)))}.`));
    const corr = correlation(dep.map((x) => x.value), dep.map((x) => cpi.find((c) => c.month === x.month)?.value));
    if (corr) findings.push(L(`Same-month correlation of deposit rate and inflation: r = ${n(corr.r)} (n = ${corr.n}). Correlation between persistent series is not evidence of cause.`, `Eyni ay üzrə depozit faizi ilə inflyasiyanın korrelyasiyası: r = ${n(corr.r)} (n = ${corr.n}). Davamlı sıralar arasındakı korrelyasiya səbəb sübutu deyil.`));
    sections.push({
      heading: L('Statistical findings', 'Statistik nəticələr'),
      paragraphs: findings,
      tables: [{ caption: L('Aligned ex-post real returns, last 12 months', 'Uzlaşdırılmış real gəlirlər, son 12 ay'), head: [L('Month', 'Ay'), L('Rate 12 months earlier', '12 ay əvvəlki faiz'), L('Inflation', 'İnflyasiya'), L('Real return', 'Real gəlir')], rows: real.slice(-12).map((x) => [x.month.slice(0, 7), p(x.nominal), p(x.inflation), p(x.real)]) }],
      charts: [{ caption: L('Ex-post real return, %', 'Reallaşmış real gəlir, %'), kind: 'line', labels: real.slice(-60).map((x) => x.month.slice(0, 7)), series: [{ name: L('Real return', 'Real gəlir'), values: real.slice(-60).map((x) => x.real) }] }],
    });
  } else if (d.type === 'currency') {
    const by = (['AZN', 'USD', 'EUR'] as const).map((c) => ({ c, s: describe(offers(c).map((r) => r.rate)) }));
    for (const { c, s } of by) findings.push(s.n ? L(`${c}: ${s.n} banks, median ${p(s.median)}, range ${p(s.min)} to ${p(s.max)}.`, `${c}: ${s.n} bank, median ${p(s.median)}, interval ${p(s.min)} – ${p(s.max)}.`) : `${c}: ${missing}`);
    findings.push(L('The manat premium is not a free gain: it reflects exchange-rate risk, deposit-insurance rate caps and different bank funding needs. Manat inflation does not measure the real return of a foreign-currency saver.', 'Manat mükafatı pulsuz qazanc deyil: o, məzənnə riskini, sığorta faiz hədlərini və bankların fərqli maliyyələşmə ehtiyaclarını əks etdirir. Manat inflyasiyası valyuta əmanətçisinin real gəlirini ölçmür.'));
    sections.push({
      heading: L('Statistical findings', 'Statistik nəticələr'),
      paragraphs: findings,
      tables: [{ caption: L('12-month term deposits at maturity, best per bank', '12 aylıq müddətli depozit, faiz sonda, hər bankdan ən yaxşısı'), head: [L('Currency', 'Valyuta'), L('Banks', 'Banklar'), L('Mean', 'Orta'), 'Median', 'Min', 'Max'], rows: by.map(({ c, s }) => [c, String(s.n), p(s.mean), p(s.median), p(s.min), p(s.max)]) }],
      charts: [{ caption: L('Median advertised rate by currency, %', 'Valyutalar üzrə median elan edilən faiz, %'), kind: 'bar', labels: by.map((x) => x.c), series: [{ name: 'Median', values: by.map((x) => x.s.median) }] }],
    });
  } else {
    const scored = d.index.filter((x) => x.score !== null);
    findings.push(L(`${scored.length} banks could be scored; ${scored.filter((x) => x.provisional).length} scores are provisional because at least one component lacks data.`, `${scored.length} bank qiymətləndirilib; ${scored.filter((x) => x.provisional).length} bal ən azı bir komponent üzrə məlumat çatışmadığı üçün ilkindir.`));
    findings.push(L(`Score history covers ${d.indexHistoryDays} day(s). A historical comparison needs a longer record; none is inferred.`, `Bal tarixçəsi ${d.indexHistoryDays} günü əhatə edir. Tarixi müqayisə üçün daha uzun qeydiyyat lazımdır; heç nə fərz edilmir.`));
    findings.push(L('The index measures product competitiveness under a published method. It is not a solvency, creditworthiness or deposit-safety rating.', 'İndeks dərc edilmiş metodika üzrə məhsulların rəqabətqabiliyyətini ölçür. Bu, ödəmə qabiliyyəti, kredit reytinqi və ya əmanət təhlükəsizliyi qiyməti deyil.'));
    sections.push({
      heading: L('Statistical findings', 'Statistik nəticələr'),
      paragraphs: findings,
      tables: [{ caption: L('AZFI index', 'AZFI indeksi'), head: [L('Bank', 'Bank'), L('Score', 'Bal'), L('Coverage', 'Əhatə'), L('Status', 'Status')], rows: d.index.map((x) => [x.bankName, x.score === null ? '—' : n(x.score), `${Math.round(x.coverage * 100)}%`, x.score === null ? L('Not scored', 'Qiymətləndirilməyib') : x.provisional ? L('Provisional', 'İlkin') : L('Full', 'Tam')]) }],
      charts: [{ caption: L('Index score', 'İndeks balı'), kind: 'bar', labels: scored.map((x) => x.bankName), series: [{ name: L('Score', 'Bal'), values: scored.map((x) => x.score) }] }],
    });
  }

  const recent = monthsBack(36);
  const trend = linearRegression(recent.map((_, i) => i / 12), recent.map((x) => x.value));
  const interpretation = [
    trend
      ? L(`A linear fit over the last ${trend.n} months gives ${n(trend.slope)} points per year for the AZN deposit rate with R² = ${n(trend.r2)}; it describes the past and does not forecast.`, `Son ${trend.n} ay üzrə xətti uyğunlaşdırma AZN depozit faizi üçün ildə ${n(trend.slope)} bənd, R² = ${n(trend.r2)} verir; bu keçmişi təsvir edir, proqnoz deyil.`)
      : missing,
    L('Advertised offers and volume-weighted official averages measure different things and are not directly comparable.', 'Elan edilən təkliflər və həcmə görə çəkili rəsmi ortalamalar fərqli şeyləri ölçür və birbaşa müqayisə olunmur.'),
  ];

  return {
    title: reportTitle(d.type, lang),
    subtitle: L(`Period ${d.period} · generated ${d.generatedAt.slice(0, 10)} · automated report, not peer reviewed`, `Dövr ${d.period} · hazırlanıb ${d.generatedAt.slice(0, 10)} · avtomatik hesabat, resenziya olunmayıb`),
    sections: [
      { heading: L('Executive summary', 'Qısa xülasə'), paragraphs: findings.slice(0, 3) },
      { heading: L('Research question', 'Tədqiqat sualı'), paragraphs: [QUESTIONS[d.type][lang === 'en' ? 0 : 1]] },
      {
        heading: L('Data period and sample', 'Məlumat dövrü və seçmə'),
        paragraphs: [
          L(`Official series: through ${d.periodEnd.slice(0, 7)}. Advertised offers: as verified on ${d.offersAsOf?.slice(0, 10) ?? '—'}, which can be later than the official period.`, `Rəsmi sıralar: ${d.periodEnd.slice(0, 7)} ayınadək. Elan edilən təkliflər: ${d.offersAsOf?.slice(0, 10) ?? '—'} tarixində yoxlanıb və rəsmi dövrdən gec ola bilər.`),
          L(`Snapshot: ${d.offers.length} advertised rates from ${new Set(d.offers.map((r) => r.bankSlug)).size} banks. This is the set of banks that could be collected, not a random sample of the market.`, `Məlumat görüntüsü: ${new Set(d.offers.map((r) => r.bankSlug)).size} bankdan ${d.offers.length} elan edilən faiz. Bu, toplana bilən bankların dəstidir, bazarın təsadüfi seçməsi deyil.`),
        ],
      },
      {
        heading: L('Methodology', 'Metodologiya'),
        paragraphs: [
          L('Offers are compared within one currency, term and payment method, one best standard offer per bank; campaign, uninsured and unreviewed values are excluded. Official rows labelled 01.MM.YYYY are assigned to the preceding month. Real return = (1 + nominal) / (1 + inflation) − 1.', 'Təkliflər eyni valyuta, müddət və ödəniş üsulu daxilində, hər bankdan bir ən yaxşı standart təklif olmaqla müqayisə edilir; kampaniya, sığortalanmayan və yoxlanılmamış qiymətlər çıxarılır. 01.AA.İİİİ ilə işarələnmiş rəsmi sətirlər əvvəlki aya aid edilir. Real gəlir = (1 + nominal) / (1 + inflyasiya) − 1.'),
        ],
      },
      ...sections,
      { heading: L('Interpretation', 'Şərh'), paragraphs: interpretation },
      {
        heading: L('Limitations', 'Məhdudiyyətlər'),
        paragraphs: [
          L('Bank coverage is partial. Most bank pages carry no publication date. Missing values are left missing. Nothing here is financial advice.', 'Bank əhatəsi qismidir. Əksər bank səhifələrində dərc tarixi yoxdur. Çatışmayan qiymətlər doldurulmur. Buradakı heç nə maliyyə məsləhəti deyil.'),
        ],
      },
      { heading: L('Conclusion', 'Nəticə'), paragraphs: [findings[0] ?? missing, L('These conclusions apply to the snapshot described above.', 'Bu nəticələr yuxarıda təsvir olunan məlumat görüntüsünə aiddir.')] },
      { heading: L('Sources', 'Mənbələr'), paragraphs: d.sources.map((s) => `${s.name} — ${s.url} (${L('verified', 'yoxlanıb')} ${s.lastVerifiedAt?.slice(0, 10) ?? '—'})`) },
    ],
  };
}
