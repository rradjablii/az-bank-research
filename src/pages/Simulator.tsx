import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { useApi } from '../lib/api';
import { Loaded, Notice, NumberInput, PageHeader, Panel, Segmented, Select, SourceLine, Stat, StatGrid, Empty } from '../components/ui';
import { termLabel } from './Explorer';
import { payoutToMethod, realRate, reinvestedValue, simulateDeposit, type CompoundingFrequency, type InterestMethod, type TaxPreset } from '../../shared/finance';
import { Alternatives, EarlyClosure, SaveScenario } from '../components/decision';
import { CURRENCIES, type Currency, type RateRow } from '../../shared/types';

function Simulator({ offers }: { offers: RateRow[] }) {
  const { t, f, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const requested = offers.find((o) => String(o.id) === params.get('offer'));
  const [mode, setMode] = useState<'bank' | 'manual'>(offers.length ? 'bank' : 'manual');
  const [currency, setCurrency] = useState<Currency>(requested?.currency ?? 'AZN');
  const inCurrency = offers.filter((o) => o.currency === currency);
  const banks = [...new Map(inCurrency.map((o) => [o.bankSlug, o.bankName])).entries()];
  const [bankChoice, setBank] = useState(requested?.bankSlug ?? '');
  const bank = banks.some(([s]) => s === bankChoice) ? bankChoice : (banks[0]?.[0] ?? '');
  const bankOffers = inCurrency.filter((o) => o.bankSlug === bank);
  const [offerChoice, setOffer] = useState(requested ? String(requested.id) : '');
  const offer =
    bankOffers.find((o) => String(o.id) === offerChoice) ??
    bankOffers.find((o) => o.termMin === 12 && o.payout === 'at_maturity' && o.variant === 'standard') ??
    bankOffers[0];

  const [principal, setPrincipal] = useState(params.get('amount') ?? '10000');
  const [reinvest, setReinvest] = useState('');
  const [manualRate, setManualRate] = useState('');
  const [monthsInput, setMonths] = useState(params.get('months') ?? '');
  const [methodChoice, setMethod] = useState<InterestMethod | ''>('');
  const [compounding, setCompounding] = useState('12');
  // No tax is applied unless the user picks a scenario: the rules are not verified.
  const [tax, setTax] = useState<TaxPreset>('none');
  const inflation = useApi('inflation');
  const cpi = inflation.data?.points.filter((p) => p.yoy !== null).at(-1);

  const product = mode === 'bank' ? offer : undefined;
  // A bank product fixes the term (or term range); manual mode leaves it free.
  const termMin = product?.termMin ?? null;
  const termMax = product?.termMax ?? termMin;
  const typed = Number(monthsInput);
  const months = monthsInput && (!product || termMin === null || (typed >= termMin && typed <= termMax!)) ? typed : (termMin ?? 12);
  const rate = product ? product.rate : Number(manualRate || NaN);
  const productMethod = product ? payoutToMethod(product.payout) : 'at_maturity';
  const method: InterestMethod = methodChoice || productMethod;

  const result = useMemo(() => {
    try {
      return simulateDeposit({
        principal: Number(principal), annualRate: rate, months, method, currency,
        compounding: Number(compounding) as CompoundingFrequency, tax,
      });
    } catch {
      return null;
    }
  }, [principal, rate, months, method, currency, compounding, tax]);
  const valid = result !== null && rate <= 100;

  const p = Number(principal);
  const outsideBand = product && ((product.amountMin !== null && p < product.amountMin) || (product.amountMax !== null && p > product.amountMax));
  const reset = () => {
    setMonths('');
    setMethod('');
    setOffer('');
    if (params.has('offer')) setParams({}, { replace: true });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel title={t('sim_inputs')}>
        <div className="space-y-3">
          <Segmented label={t('sim_mode')} value={mode} onChange={(m) => { setMode(m); setMethod(''); setMonths(''); }}
            options={[{ value: 'bank', label: t('sim_mode_bank') }, { value: 'manual', label: t('sim_mode_manual') }]} />
          <Select label={t('currency')} value={currency} onChange={(c) => { setCurrency(c); reset(); }} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          {mode === 'bank' && (offer ? (
            <>
              <Select label={t('bank')} value={bank} onChange={(b) => { setBank(b); reset(); }} options={banks.map(([value, label]) => ({ value, label }))} />
              <Select label={t('sim_offer')} value={String(offer.id)} onChange={(v) => { setOffer(v); setMonths(''); setMethod(''); }}
                options={bankOffers.map((o) => ({
                  value: String(o.id),
                  label: `${localize(lang, o.productName)} · ${termLabel(o, t)} · ${t(`payout_${o.payout}`)} · ${f.pct(o.rate)}${o.variant === 'standard' ? '' : ` · ${t(`variant_${o.variant}`)}`}`,
                }))} />
              <div>
                <SourceLine name={offer.bankName} url={offer.sourceUrl} verified={offer.lastVerifiedAt} state={offer.freshness} />
                {offer.conditions && <p className="mt-1 text-xs text-ink-2">{t('conditions')}: {localize(lang, offer.conditions)}</p>}
              </div>
            </>
          ) : <Notice tone="warn">{t('no_data')}</Notice>)}
          <NumberInput label={`${t('sim_principal')} (${currency})`} value={principal} onChange={setPrincipal} min={1} step={100} />
          {mode === 'manual' && <NumberInput label={t('sim_rate')} value={manualRate} onChange={setManualRate} min={0} max={100} step={0.05} />}
          <NumberInput label={t('sim_months')} value={monthsInput || String(months)} onChange={setMonths} min={termMin ?? 1} max={product && termMax ? termMax : 600} step={1} />
          {product && termMin !== null && termMax !== termMin && <p className="text-xs text-ink-2">{t('sim_term_range', { a: termMin, b: termMax! })}</p>}
          <Select label={t('sim_method')} value={method} onChange={(v) => setMethod(v)}
            options={(['at_maturity', 'monthly_payout', 'quarterly_payout', 'upfront', 'compound'] as InterestMethod[])
              .filter((m) => !product || m === productMethod || m === 'compound')
              .map((m) => ({ value: m, label: t(`method_${m}`) }))} />
          {method === 'compound' && (
            <>
              <Select label={t('sim_compounding')} value={compounding} onChange={setCompounding} options={['12', '4', '1'].map((v) => ({ value: v, label: v }))} />
              <Notice tone="warn">{t('sim_compound_warn')}</Notice>
            </>
          )}
          <Select label={t('sim_tax')} value={tax} onChange={setTax}
            options={(['none', 'az_scheduled_2027', 'az_2026', 'flat10'] as TaxPreset[]).map((v) => ({ value: v, label: t(`tax_${v}`) }))} />
          <p className="text-xs text-ink-2">{t('dec_tax_unverified')}</p>
          {tax !== 'none' && <p className="text-xs text-ink-2">{t('sim_tax_note')}</p>}
          {(method === 'monthly_payout' || method === 'quarterly_payout') && <NumberInput label={t('dec_reinvest')} value={reinvest} onChange={setReinvest} min={0} max={50} step={0.1} />}
        </div>
      </Panel>

      <div className="min-w-0 space-y-4">
        {!valid || !result ? <Notice tone="warn">{t('sim_invalid')}</Notice> : (
          <>
            {outsideBand && (
              <Notice tone="warn">{t('sim_amount_warn', { band: `${f.number(product!.amountMin ?? 0, 0)} – ${product!.amountMax === null ? '∞' : f.number(product!.amountMax, 0)}` })}</Notice>
            )}
            <section aria-label={t('sim_results')} aria-live="polite">
              <StatGrid cols="grid-cols-2 md:grid-cols-3">
                <Stat label={t('sim_gross')} value={f.money(result.grossInterest, currency)} />
                <Stat label={t('sim_taxamt')} value={f.money(result.tax, currency)} />
                <Stat label={t('sim_net')} value={f.money(result.netInterest, currency)} />
                <Stat label={t('sim_total')} value={f.money(result.maturityValue, currency)} />
                <Stat label={t('sim_period_return')} value={f.pct(result.grossReturn * 100)} hint={`${t('sim_rate')}: ${f.number(rate)}`} />
                <Stat label={t('sim_annual')} value={f.pct(result.netAnnualised)} />
                <Stat label={t('dec_gross_balance')} value={f.money(Number(principal) + result.grossInterest, currency)} />
                <Stat label={t('dec_eay')} value={f.pct(result.grossAnnualised)} />
                {(method === 'monthly_payout' || method === 'quarterly_payout') && reinvest !== '' && Number(reinvest) >= 0 && (
                  <Stat label={t('dec_reinvested')} value={f.money(reinvestedValue(Number(principal), result.flows, Number(reinvest)).value, currency)}
                    hint={`${t('dec_eay')}: ${f.pct(reinvestedValue(Number(principal), result.flows, Number(reinvest)).effectiveAnnual)}`} />
                )}
              </StatGrid>
            </section>
            {currency === 'AZN' && cpi?.yoy != null && (
              <Notice>
                {t('sim_real', { i: f.number(cpi.yoy), month: f.month(cpi.month) })}: <strong className="num">{f.pct(realRate(result.netAnnualised, cpi.yoy))}</strong>
                <div className="text-xs text-ink-2">{t('dec_real_note')}</div>
              </Notice>
            )}
            <EarlyClosure offer={product} principal={Number(principal)} rate={rate} months={months} method={method} currency={currency} />
            {product && method !== 'compound' && <Alternatives offer={product} offers={offers} principal={Number(principal)} months={months} />}
            <SaveScenario query={new URLSearchParams({ ...(product ? { offer: String(product.id) } : {}), amount: principal, months: String(months) }).toString()}
              label={`${product ? product.bankName : t('sim_mode_manual')} · ${f.money(Number(principal), currency)} · ${months}m`} />
            <Panel title={t('sim_schedule')} note={t('sim_daycount')} flush>
              <div className="max-h-[28rem] overflow-auto">
                <table className="data num">
                  <thead className="sticky top-0 bg-surface">
                    <tr><th className="r">{t('sim_month')}</th><th className="r">{t('sim_accrued')}</th><th className="r">{t('sim_taxamt')}</th><th className="r">{t('sim_paid')}</th><th className="r">{t('sim_balance')}</th></tr>
                  </thead>
                  <tbody>
                    {result.flows.map((x) => (
                      <tr key={x.month}>
                        <td className="r">{x.month}</td><td className="r">{f.number(x.interest)}</td><td className="r">{f.number(x.tax)}</td>
                        <td className="r">{f.number(x.paid)}</td><td className="r">{f.number(x.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

export default function SimulatorPage() {
  const { t } = useI18n();
  const rates = useApi('rates');
  return (
    <>
      <PageHeader title={t('sim_title')} subtitle={t('sim_sub')} />
      <Loaded state={rates}>
        {({ rows }) => {
          const offers = rows.filter((r) => r.category === 'deposit' && r.termMin !== null);
          return (
            <>
              {!offers.length && <Panel><Empty>{t('no_data_yet')}</Empty></Panel>}
              <Simulator offers={offers} />
            </>
          );
        }}
      </Loaded>
    </>
  );
}
