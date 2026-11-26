import { pageText } from '../../html.js';
import type { Currency, ProductTerms, WithdrawalTier } from '../../../../shared/types.js';

/**
 * Reads product conditions from page text. Every rule is anchored on wording seen
 * on that bank's page; when the wording is absent the field stays null ("not
 * found"), it is never defaulted.
 */
export type TermsParser = (html: string) => ProductTerms;

const empty = (): ProductTerms => ({ minAmount: null, topUp: null, partialWithdrawal: null, earlyWithdrawal: null, excerpts: [] });

/** ABB ships conditions inside the RSC payload rather than the visible markup. */
function textWithFlight(html: string): string {
  const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)<\/script>/g)].map((m) => JSON.parse(m[1]!) as string).join('');
  return `${pageText(html)} ${flight.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`;
}

interface Rule {
  /** Match → apply. The matched text is kept as evidence. */
  pattern: RegExp;
  apply: (t: ProductTerms, m: RegExpExecArray) => void;
}

const n = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const minAll = (pattern: RegExp, currencies: Currency[]): Rule => ({
  pattern,
  apply: (t, m) => (t.minAmount = Object.fromEntries(currencies.map((c) => [c, n(m[1]!)]))),
});
const flag = (pattern: RegExp, field: 'topUp' | 'partialWithdrawal', value: boolean): Rule => ({ pattern, apply: (t) => (t[field] = value) });
const forfeit = (pattern: RegExp): Rule => ({ pattern, apply: (t) => (t.earlyWithdrawal = { type: 'forfeit' }) });

/** Pattern groups alternate (from, to?, retained%) as described by `shape`. */
const share = (pattern: RegExp, build: (m: RegExpExecArray) => WithdrawalTier[], unit: 'days' | 'term_percent' = 'days'): Rule => ({
  pattern,
  apply: (t, m) => (t.earlyWithdrawal = { type: 'retained_share', unit, tiers: build(m) }),
});
const tier = (from: number, to: number | null, retainedPct: number): WithdrawalTier => ({ from, to, retainedPct });

function build(rules: Rule[], extract: (html: string) => string = pageText): TermsParser {
  return (html) => {
    const text = extract(html);
    const terms = empty();
    for (const rule of rules) {
      const m = rule.pattern.exec(text);
      if (!m) continue;
      rule.apply(terms, m);
      terms.excerpts.push(m[0].slice(0, 600).trim());
    }
    return terms;
  };
}

const AZN_USD: Currency[] = ['AZN', 'USD'];
const ALL: Currency[] = ['AZN', 'USD', 'EUR'];

const uniTiers = /90 günə kimi olduqda illik 0 \(sıfır\)[^;]*; 2\. Əmanətin müddəti faktiki olaraq 91-180 günə kimi olduqda illik faizs? dərəcəsinin (\d+)%[^;]*;? 3\. Əmanətin müddəti faktiki olaraq 181-360 günə kimi olduqda illik faiz dərəcəsinin (\d+)%/u;

export const TERMS = {
  abbClassic: build([minAll(/(\d+) AZN\/USD Min\. əmanət məbləği/u, AZN_USD), forfeit(/Əmanət məbləği vaxtından əvvəl çıxarıldığı halda heç bir faiz ödənilmir/u)], textWithFlight),
  abbDigital: build([forfeit(/Əmanət məbləği vaxtından əvvəl çıxarıldığı halda heç bir faiz ödənilmir/u)], textWithFlight),
  access: build([minAll(/siz (\d+) manatdan \(ABŞ dolları\) başlayan/u, AZN_USD)]),
  afb: build([
    minAll(/Minimal məbləğ (\d+) Maksimal/u, AZN_USD),
    share(
      /vaxtından əvvəl xitam verildikdə: - 91-180 günədək - hesablanmış faizlərin (\d+) %[^-]*- 181-360 günədək - hesablanmış faizlərin (\d+) %[^-]*- 361 gündən artıq - hesablanmış faizlərin (\d+) %/u,
      (m) => [tier(91, 180, n(m[1]!)), tier(181, 360, n(m[2]!)), tier(361, null, n(m[3]!))],
    ),
  ]),
  bankOfBaku: build([minAll(/Əmanətin ilkin məbləği: (\d+) AZN\/USD/u, AZN_USD)]),
  bankOfBakuDynamic: build([
    minAll(/Əmanətin ilkin məbləği: (\d+) AZN\/USD\/EUR/u, ALL),
    flag(/Əmanətin azaldılması: İcazə verilir/u, 'partialWithdrawal', true),
    flag(/Əmanətin artırılması Əmanət müddətinin yarısınadək/u, 'topUp', true),
  ]),
  express: build([minAll(/(\d+) ₼\/\$ Minimal məbləğ/u, AZN_USD)]),
  premium: build([
    minAll(/Minimal Məbləği (\d+) AZN \/ \d+ USD \/ \d+ EUR/u, ALL),
    flag(/Əmanətin məbləğinin artırılması yoxdur/u, 'topUp', false),
    share(
      /Müqavilə müddəti <50% aktiv olduqda faiz ödənilmir Müqavilə müddəti 50%-dən çox aktiv olduqda əmanətin bağlanma anına faizlərin (\d+)%-i ödənilir/u,
      (m) => [tier(0, 49.999, 0), tier(50, null, n(m[1]!))],
      'term_percent',
    ),
  ]),
  rabitaUniversal: build([
    {
      pattern: /Əmanətin Minimal Məbləği (\d+) AZN \/ USD - (\d+) EUR/u,
      apply: (t, m) => (t.minAmount = { AZN: n(m[1]!), USD: n(m[1]!), EUR: n(m[2]!) }),
    },
    flag(/Mövcud əmanət üzrə məbləğ artımı nəzərdə tutulmur/u, 'topUp', false),
  ]),
  respublika: build([
    share(
      /90 gün və daha azdırsa – hesablanmış faizlər ödənilmir 91 – 365 gündürsə – hesablanmış faizlərin (\d+) %-i ödənilir 366 gün və daha çox – hesablanmış faizlərin (\d+)% -i ödənilir/u,
      (m) => [tier(0, 90, 0), tier(91, 365, n(m[1]!)), tier(366, null, n(m[2]!))],
    ),
  ]),
  unibankTerm: build([
    minAll(/Minimal məbləğ (\d+) AZN \/ EUR \/ USD/u, ALL),
    share(
      new RegExp(`${uniTiers.source}[^;]*; 4\\. Əmanətin müddəti faktiki olaraq 361 gündən çox olduqda illik faiz dərəcəsinin (\\d+)%`, 'u'),
      (m) => [tier(0, 90, 0), tier(91, 180, n(m[1]!)), tier(181, 360, n(m[2]!)), tier(361, null, n(m[3]!))],
    ),
  ]),
  unibankSavings: build([
    minAll(/Minimal məbləğ (\d+) AZN Cədvəl/u, ['AZN']),
    flag(/Əmanəti müddətin sonunadək minimum \d+ AZN məbləğində artırmaq mümkündür/u, 'topUp', true),
    share(uniTiers, (m) => [tier(0, 90, 0), tier(91, 180, n(m[1]!)), tier(181, 360, n(m[2]!))]),
  ]),
  vtb: build([
    minAll(/Depozitin minimal məbləği (\d+) AZN/u, ['AZN']),
    flag(/Depozitə vəsaitin əlavə edilməsi Mümkün deyil/u, 'topUp', false),
  ]),
  yelo: build([
    share(
      /1 – 90 gün (\d+)% 91 - 360 gün (\d+)% 361 gün və yuxarı (\d+)%/u,
      (m) => [tier(0, 90, n(m[1]!)), tier(91, 360, n(m[2]!)), tier(361, null, n(m[3]!))],
    ),
  ]),
  ziraat: build([
    minAll(/Əmanətin minimal məbləği- (\d+) AZN\/USD\/EUR/u, ALL),
    {
      pattern: /AZN valyutalı əmanətlər üzrə ([\d.]+)%, USD valyutalı əmanətlər üzrə ([\d.]+)%, EURO valyutalı əmanətlər üzrə ([\d.]+)% illik faiz dərəcəsi/u,
      apply: (t, m) => (t.earlyWithdrawal = { type: 'reduced_rate', rates: { AZN: n(m[1]!), USD: n(m[2]!), EUR: n(m[3]!) } }),
    },
  ]),
} satisfies Record<string, TermsParser>;
