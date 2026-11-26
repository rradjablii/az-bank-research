import { useState } from 'react';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { marketQuery, useApi } from '../lib/api';
import { Empty, FreshnessBadge, Loaded, Notice, PageHeader, Panel, Select, SourceLine, Stat, StatGrid } from '../components/ui';
import { HistogramChart, RankedBars, TimeSeries } from '../components/charts';
import { STANDARD_TERMS, hasTerm, selectOffers, type Selection } from '../../shared/selection';
import { describe, histogram } from '../../shared/stats';
import { realRate } from '../../shared/finance';
import { merge, monthlyInflation, monthlyRates } from '../lib/series';
import { CURRENCIES, type Currency, type Payout, type ProductType, type RateRow } from '../../shared/types';

function AdvertisedMarket({ rows }: { rows: RateRow[] }) {
  const { t, f } = useI18n();
  const [currency, setCurrency] = useState<Currency>('AZN');
  const [bank, setBank] = useState('');
  const [productType, setType] = useState<ProductType>('term_deposit');
  const [term, setTerm] = useState('12');
  const [payout, setPayout] = useState<Payout>('at_maturity');
  const deposits = rows.filter((r) => r.category === 'deposit');
  const banks = [...new Map(rows.map((r) => [r.bankSlug, r.bankName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const selection: Selection = {
    productType, currency, term: hasTerm(productType) ? Number(term) : null, payout: productType === 'flexible_deposit' ? 'monthly' : payout,
    includeCampaigns: false, includeUninsured: false, perBank: !bank,
  };
  const offers = selectOffers(bank ? rows.filter((r) => r.bankSlug === bank) : rows, selection);
  const s = describe(offers.map((r) => r.rate));
  const bins = histogram(offers.map((r) => r.rate));
  const verified = new Set(
    deposits.filter((r) => r.freshness === 'fresh' && r.verification !== 'pending_review' && r.verification !== 'rejected').map((r) => `${r.bankSlug}/${r.productKey}`),
  ).size;

  return (
    <>
      <section aria-label={t('dash_filters')} className="space-y-3">
        <h2 className="text-xs font-semibold text-ink-2">{t('dash_filters')}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Select label={t('currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <Select label={t('bank')} value={bank} onChange={setBank} options={[{ value: '', label: t('all') }, ...banks.map(([value, label]) => ({ value, label }))]} />
          <Select label={t('product_type')} value={productType} onChange={setType} options={(['term_deposit', 'savings_deposit', 'flexible_deposit'] as ProductType[]).map((v) => ({ value: v, label: t(`type_${v}`) }))} />
          {hasTerm(productType) && <Select label={t('term')} value={term} onChange={setTerm} options={STANDARD_TERMS.map((m) => ({ value: String(m), label: t('months_n', { n: m }) }))} />}
          {productType !== 'flexible_deposit' && <Select label={t('payout')} value={payout} onChange={setPayout} options={(['at_maturity', 'monthly', 'quarterly', 'upfront'] as Payout[]).map((p) => ({ value: p, label: t(`payout_${p}`) }))} />}
        </div>
        <StatGrid cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          <Stat label={t('banks_covered')} value={new Set(offers.map((r) => r.bankSlug)).size} />
          <Stat label={t('dash_products')} value={verified} />
          <Stat label={t('mean')} value={f.pct(s.mean)} />
          <Stat label={t('median')} value={f.pct(s.median)} />
          <Stat label={t('min')} value={f.pct(s.min)} />
          <Stat label={t('max')} value={f.pct(s.max)} />
          <Stat label={t('dash_sd')} value={f.number(s.sdSample)} />
        </StatGrid>
        {!bank && <p className="text-xs text-ink-2">{t('dash_filter_note', { n: offers.length, b: new Set(offers.map((r) => r.bankSlug)).size })}</p>}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t('advertised')}>
          {offers.length ? <RankedBars label={t('rate')} data={offers.map((r) => ({ name: bank ? `${r.productName.slice(0, 18)} #${r.id}` : r.bankName, value: r.rate }))} /> : <Empty>{t('no_data')}</Empty>}
        </Panel>
        <div className="space-y-5">
          <Panel title={t('dash_distribution')}>
            {bins.length ? <HistogramChart label={t('st_count')} data={bins.map((b) => ({ range: `${f.number(b.from, 1)}–${f.number(b.to, 1)}`, count: b.count }))} /> : <Empty>{t('no_data')}</Empty>}
          </Panel>
          <Panel title={t('dash_breakdown')} flush>
            <table className="data num">
              <thead><tr><th>{t('currency')}</th><th className="r">{t('banks_covered')}</th><th className="r">{t('dash_products_n')}</th><th className="r">{t('dash_rates_n')}</th></tr></thead>
              <tbody>
                {CURRENCIES.map((c) => {
                  const own = deposits.filter((r) => r.currency === c);
                  return <tr key={c}><td>{c}</td><td className="r">{new Set(own.map((r) => r.bankSlug)).size}</td><td className="r">{new Set(own.map((r) => `${r.bankSlug}/${r.productKey}`)).size}</td><td className="r">{own.length}</td></tr>;
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </>
  );
}

export default function Overview() {
  const { t, f, lang } = useI18n();
  const [range, setRange] = useState<'12' | '36' | '60' | 'all'>('36');
  const meta = useApi('meta');
  const rates = useApi('rates');
  const dep = useApi('market', marketQuery('deposit_rate', 'new_business', { segment: 'total', bucket: 'all' }));
  const loan = useApi('market', marketQuery('loan_rate', 'new_business', { segment: 'total', bucket: 'all' }));
  const inf = useApi('inflation');
  const policy = useApi('policy');

  const depAzn = dep.data ? monthlyRates(dep.data.points, 'AZN') : [];
  const depFx = dep.data ? monthlyRates(dep.data.points, 'FX') : [];
  const loanAzn = loan.data ? monthlyRates(loan.data.points, 'AZN') : [];
  const cpi = inf.data ? monthlyInflation(inf.data.points) : [];
  const [d, l, x, c] = [depAzn.at(-1), loanAzn.at(-1), depFx.at(-1), cpi.at(-1)];
  const pol = policy.data?.points.at(-1);
  const official = (v: typeof d) => (v ? t('ov_ref', { month: f.month(v.month) }) : t('fresh_unavailable'));
  const window = <T,>(rows: T[]) => (range === 'all' ? rows : rows.slice(-Number(range)));

  return (
    <>
      <PageHeader title={t('ov_title')} subtitle={t('ov_sub')} />
      <div className="space-y-5">
        <section aria-label={t('official')}>
          <h2 className="mb-2 text-xs font-semibold text-ink-2">{t('official')}</h2>
          <StatGrid cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <Stat label={t('ov_dep_new')} value={f.pct(d?.value)} hint={official(d)} />
            <Stat label={t('ov_loan_new')} value={f.pct(l?.value)} hint={official(l)} />
            <Stat label={t('ov_dep_fx')} value={f.pct(x?.value)} hint={official(x)} />
            <Stat label={t('ov_inflation')} value={f.pct(c?.value)} hint={c ? f.month(c.month) : t('fresh_unavailable')} />
            <Stat label={t('ov_real')} value={d && c ? f.pct(realRate(d.value, c.value)) : '—'} hint={t('ov_real_hint')} />
            <Stat label={t('dash_policy')} value={f.pct(pol?.refinancing)} hint={pol ? `${f.month(pol.month)} · ${t('dash_corridor', { a: f.number(pol.floor), b: f.number(pol.ceiling) })}` : t('fresh_unavailable')} />
          </StatGrid>
          {dep.data?.source && <SourceLine name={dep.data.source.name} url={dep.data.source.url} verified={dep.data.source.lastVerifiedAt} state={dep.data.source.freshness} />}
          {inf.data?.source && <SourceLine name={inf.data.source.name} url={inf.data.source.url} verified={inf.data.source.lastVerifiedAt} state={inf.data.source.freshness} />}
          {(dep.error || inf.error) && <Notice tone="warn">{t('load_error', { error: dep.error ?? inf.error ?? '' })}</Notice>}
          {!dep.loading && !dep.error && !depAzn.length && <Notice tone="warn">{t('no_data_yet')}</Notice>}
        </section>

        <Loaded state={rates}>
          {({ rows }) => (
            <>
              <AdvertisedMarket rows={rows} />
              <Panel title={t('ov_by_currency')} note={t('ov_by_currency_note')} flush>
                <div className="overflow-x-auto">
                  <table className="data num">
                    <thead><tr><th>{t('currency')}</th><th className="r">{t('mean')}</th><th className="r">{t('median')}</th><th className="r">{t('min')}</th><th className="r">{t('max')}</th><th className="r">{t('banks_covered')}</th></tr></thead>
                    <tbody>
                      {CURRENCIES.map((currency) => {
                        const s = describe(selectOffers(rows, { productType: 'term_deposit', currency, term: 12, payout: 'at_maturity', includeCampaigns: false, includeUninsured: false, perBank: true }).map((r) => r.rate));
                        return <tr key={currency}><td className="font-medium">{currency}</td><td className="r">{f.pct(s.mean)}</td><td className="r">{f.pct(s.median)}</td><td className="r">{f.pct(s.min)}</td><td className="r">{f.pct(s.max)}</td><td className="r">{s.n}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
        </Loaded>

        {depAzn.length > 0 && (
          <>
            <div className="w-48"><Select label={t('dash_trend_range')} value={range} onChange={setRange} options={(['12', '36', '60', 'all'] as const).map((v) => ({ value: v, label: t(`range_${v}`) }))} /></div>
            <div className="grid gap-5 xl:grid-cols-2">
              <Panel title={t('ov_trend')}>
                <TimeSeries data={window(merge({ deposit: depAzn, inflation: cpi }))}
                  series={[{ key: 'deposit', label: t('series_deposit'), slot: 0 }, { key: 'inflation', label: t('series_inflation'), slot: 1 }]} />
              </Panel>
              <Panel title={t('ov_spread')}>
                <TimeSeries data={window(merge({ deposit: depAzn, loan: loanAzn }))}
                  series={[{ key: 'deposit', label: t('series_deposit'), slot: 0 }, { key: 'loan', label: t('series_loan'), slot: 2 }]} />
              </Panel>
            </div>
          </>
        )}

        <Loaded state={meta}>
          {({ sources }) => (
            <Panel title={t('ov_sources')} flush>
              <div className="max-h-80 overflow-auto">
                <table className="data">
                  <thead><tr><th>{t('source')}</th><th>{t('status')}</th><th>{t('verified')}</th><th className="r">{t('records')}</th></tr></thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.key}>
                        <td><a className="hover:underline" href={s.url} target="_blank" rel="noreferrer">{localize(lang, s.publisher)}</a></td>
                        <td><FreshnessBadge state={s.freshness} /></td>
                        <td className="num whitespace-nowrap">{f.dateTime(s.lastVerifiedAt)}</td>
                        <td className="r num">{s.recordCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </Loaded>
      </div>
    </>
  );
}
