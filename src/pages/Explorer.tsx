import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { useApi } from '../lib/api';
import { Check, Empty, Field, FreshnessBadge, VerificationBadge, Loaded, Notice, PageHeader, Panel, Segmented, Select, Stat, StatGrid } from '../components/ui';
import { STANDARD_TERMS, coversTerm, hasTerm } from '../../shared/selection';
import { describe } from '../../shared/stats';
import { CURRENCIES, type Category, type Currency, type RateRow } from '../../shared/types';

export function termLabel(r: Pick<RateRow, 'termMin' | 'termMax' | 'category'>, t: ReturnType<typeof useI18n>['t']) {
  if (r.category === 'loan') return r.termMax ? t('up_to_months', { n: r.termMax }) : '—';
  if (r.termMin === null) return t('no_term');
  return t('month_short', { n: r.termMax && r.termMax !== r.termMin ? `${r.termMin}–${r.termMax}` : r.termMin });
}

type SortKey = 'bankName' | 'productName' | 'termMin' | 'rate';

export function filterRows(rows: RateRow[], f: {
  category: Category; currency: Currency; query: string; bank: string; type: string; term: string; payout: string; campaigns: boolean; uninsured: boolean;
}) {
  const q = f.query.trim().toLocaleLowerCase('az');
  return rows.filter(
    (r) =>
      r.category === f.category &&
      r.currency === f.currency &&
      (!q || `${r.bankName} ${r.productName}`.toLocaleLowerCase('az').includes(q) || `${r.bankName} ${r.productName}`.toLowerCase().includes(q)) &&
      (!f.bank || r.bankSlug === f.bank) &&
      (!f.type || r.productType === f.type) &&
      (!f.term || coversTerm(r, Number(f.term))) &&
      (!f.payout || r.payout === f.payout) &&
      (f.campaigns || (r.variant !== 'campaign' && r.variant !== 'legacy_renewal')) &&
      (f.uninsured || r.variant !== 'uninsured'),
  );
}

export default function Explorer() {
  const { t, f, lang } = useI18n();
  const state = useApi('rates');
  const [category, setCategory] = useState<Category>('deposit');
  const [currency, setCurrency] = useState<Currency>('AZN');
  const [query, setQuery] = useState('');
  const [bank, setBank] = useState('');
  const [type, setType] = useState('term_deposit');
  const [term, setTerm] = useState('12');
  const [payout, setPayout] = useState('at_maturity');
  const [campaigns, setCampaigns] = useState(false);
  const [uninsured, setUninsured] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rate', dir: -1 });

  const loans = category === 'loan';
  const filtered = useMemo(
    () =>
      filterRows(state.data?.rows ?? [], {
        category, currency: loans ? 'AZN' : currency, query, bank, type: loans ? '' : type, term: loans ? '' : term, payout: loans ? '' : payout, campaigns, uninsured,
      }).sort((a, b) => {
        const x = a[sort.key] ?? 0;
        const y = b[sort.key] ?? 0;
        return (typeof x === 'string' ? x.localeCompare(String(y), 'az') : x - Number(y)) * sort.dir;
      }),
    [state.data, category, currency, query, bank, type, term, payout, campaigns, uninsured, sort, loans],
  );
  const banks = useMemo(() => [...new Map((state.data?.rows ?? []).map((r) => [r.bankSlug, r.bankName])).entries()], [state.data]);

  const comparable = loans || (!!type && !!payout && (!!term || !hasTerm(type as RateRow['productType'])));
  const best = new Map<string, number>();
  for (const r of filtered.filter((x) => x.verification !== 'pending_review')) {
    const cur = best.get(r.bankSlug);
    if (cur === undefined || (loans ? r.rate < cur : r.rate > cur)) best.set(r.bankSlug, r.rate);
  }
  const s = describe([...best.values()]);

  const header = (key: SortKey, label: string, right = false) => (
    <th className={right ? 'r' : ''} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="font-medium hover:text-ink" aria-label={t('sort_by', { c: label })}
        onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : key === 'rate' ? -1 : 1 })}>
        {label} {sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : ''}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader title={t('ex_title')} subtitle={t('ex_sub')}>
        <div className="flex flex-wrap gap-2">
          <Segmented label={t('category')} value={category} onChange={(c) => { setCategory(c); setSort({ key: 'rate', dir: c === 'loan' ? 1 : -1 }); }}
            options={[{ value: 'deposit', label: t('deposits') }, { value: 'loan', label: t('loans') }]} />
          {!loans && <Segmented label={t('currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
        </div>
      </PageHeader>
      <Loaded state={state}>
        {({ rows }) => (
          <div className="space-y-4">
            {!rows.length && <Notice tone="warn">{t('no_data_yet')}</Notice>}
            <Panel>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field label={t('search')}>{(id) => <input id={id} type="search" className="field" value={query} onChange={(e) => setQuery(e.target.value)} />}</Field>
                <Select label={t('bank')} value={bank} onChange={setBank} options={[{ value: '', label: t('all') }, ...banks.map(([v, label]) => ({ value: v, label }))]} />
                {!loans && (
                  <>
                    <Select label={t('product_type')} value={type} onChange={setType}
                      options={[{ value: '', label: t('all') }, ...(['term_deposit', 'savings_deposit', 'flexible_deposit'] as const).map((v) => ({ value: v as string, label: t(`type_${v}`) }))]} />
                    <Select label={t('term')} value={term} onChange={setTerm}
                      options={[{ value: '', label: t('all') }, ...STANDARD_TERMS.map((m) => ({ value: String(m), label: t('months_n', { n: m }) }))]} />
                    <Select label={t('payout')} value={payout} onChange={setPayout}
                      options={[{ value: '', label: t('all') }, ...(['at_maturity', 'monthly', 'quarterly', 'upfront'] as const).map((v) => ({ value: v as string, label: t(`payout_${v}`) }))]} />
                  </>
                )}
              </div>
              {!loans && (
                <div className="mt-3 flex flex-wrap gap-5">
                  <Check label={t('include_campaigns')} checked={campaigns} onChange={setCampaigns} />
                  <Check label={t('include_uninsured')} checked={uninsured} onChange={setUninsured} />
                </div>
              )}
            </Panel>

            {comparable ? (
              <section aria-label={t('ex_summary')}>
                <h2 className="mb-2 text-xs font-semibold text-ink-2">{t('ex_summary')} · {t('one_per_bank')}</h2>
                <StatGrid cols="grid-cols-2 sm:grid-cols-5">
                  <Stat label={t('mean')} value={f.pct(s.mean)} />
                  <Stat label={t('median')} value={f.pct(s.median)} />
                  <Stat label={t('min')} value={f.pct(s.min)} />
                  <Stat label={t('max')} value={f.pct(s.max)} />
                  <Stat label={t('banks_covered')} value={s.n} />
                </StatGrid>
              </section>
            ) : <Notice>{t('ex_mixed')}</Notice>}
            {loans && <Notice>{t('me_c4')}</Notice>}

            <Panel title={t('advertised')} note={t('ex_rows', { n: filtered.length })} flush>
              {!filtered.length ? <Empty>{t('no_data')}</Empty> : (
                <div className="max-h-[70vh] overflow-auto">
                  <table className="data">
                    <thead className="sticky top-0 bg-surface">
                      <tr>
                        {header('bankName', t('bank'))}
                        {header('productName', t('product'))}
                        {header('termMin', t('term'))}
                        <th>{loans ? t('apr') : t('payout')}</th>
                        {header('rate', t('rate'), true)}
                        <th>{t('status')}</th>
                        <th>{t('verified')}</th>
                        <th>{t('ex_details')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id}>
                          <td className="font-medium whitespace-nowrap">{r.bankName}</td>
                          <td className="min-w-52">
                            {localize(lang, r.productName)}
                            <div className="text-xs text-ink-2">
                              {r.variant !== 'standard' && <span className="mr-2 font-medium text-warn">{t(`variant_${r.variant}`)}</span>}
                              {r.amountMin !== null && <span className="mr-2">{r.amountMax !== null ? t('amount_band', { a: f.number(r.amountMin, 0), b: f.number(r.amountMax, 0) }) : t('amount_from', { v: f.number(r.amountMin, 0) })}</span>}
                              {localize(lang, r.conditions)}
                            </div>
                          </td>
                          <td className="num whitespace-nowrap">{termLabel(r, t)}</td>
                          <td className="num whitespace-nowrap">
                            {loans ? (r.aprMin === null ? '—' : `${f.pct(r.aprMin)} – ${f.pct(r.aprMax)}`) : t(`payout_${r.payout}`)}
                          </td>
                          <td className="r num whitespace-nowrap font-semibold">
                            {r.qualifier === 'from' && <span className="mr-1 text-xs font-normal text-ink-2">{t('q_from')}</span>}
                            {f.pct(r.rate)}{r.rateMax !== null && ` – ${f.pct(r.rateMax)}`}
                          </td>
                          <td><FreshnessBadge state={r.freshness} /><div><VerificationBadge state={r.verification} /></div></td>
                          <td className="num whitespace-nowrap text-xs text-ink-2">
                            {f.dateTime(r.lastVerifiedAt)}
                            {r.observedDate && <div>{t('published', { d: f.date(r.observedDate) })}</div>}
                          </td>
                          <td className="whitespace-nowrap text-xs">
                            <a className="text-accent hover:underline" href={r.sourceUrl} target="_blank" rel="noreferrer" title={r.sourceName}>{new URL(r.sourceUrl).hostname.replace('www.', '')}</a>
                            {!loans && <div><Link className="text-accent hover:underline" to={`/simulator?offer=${r.id}`}>{t('ex_simulate')}</Link></div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        )}
      </Loaded>
    </>
  );
}
