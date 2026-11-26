import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { request, useApi } from '../lib/api';
import { Check, Empty, Field, Loaded, Notice, NumberInput, PageHeader, Panel, Select, VerificationBadge } from '../components/ui';
import { EarlyText, termsFor, useTermsText } from '../components/terms';
import { STANDARD_TERMS } from '../../shared/selection';
import { eligibleOffers, type WithdrawalNeed } from '../../shared/eligibility';
import { CURRENCIES, type Currency, type Payout, type ProductTermsRow, type RateRow } from '../../shared/types';

function Comparison({ rows, terms }: { rows: RateRow[]; terms: ProductTermsRow[] }) {
  const { t, f, lang } = useI18n();
  const text = useTermsText();
  const [search, setSearch] = useSearchParams();
  // Controlled inputs need synchronous state; the URL only mirrors it (router updates are deferred).
  const [params, setParams] = useState(() => new URLSearchParams(search));
  useEffect(() => {
    setSearch(params, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const get = (k: string, fallback: string) => params.get(k) ?? fallback;
  const currency = (CURRENCIES.includes(params.get('currency') as Currency) ? params.get('currency') : 'AZN') as Currency;
  const term = Number(get('term', '12')) || 12;
  const amount = get('amount', '10000');
  const payout = get('payout', 'at_maturity') as Payout;
  const need = get('need', 'any') as WithdrawalNeed;
  const campaigns = params.get('campaigns') === '1';
  const selected = new Set(get('ids', '').split(',').filter(Boolean).map(Number));
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  // The comparison lives in the URL, so it can be bookmarked and saved.
  const set = (patch: Record<string, string>) => setParams((current) => new URLSearchParams({ ...Object.fromEntries(current), ...patch }));

  const result = eligibleOffers(rows, terms, { currency, term, amount: Number(amount) || 0, payout, need, includeCampaigns: campaigns });
  const chosen = result.offers.filter((o) => selected.has(o.offer.id));
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < 4) next.add(id);
    set({ ids: [...next].join(',') });
  };
  const save = async () => {
    try {
      await request('account/items', { method: 'POST', body: { kind: 'comparison', label: label.trim() || `${currency} ${term}m`, payload: { query: params.toString().slice(0, 200) } } });
      setMessage(t('cmp_saved'));
    } catch {
      setMessage(t('cmp_signin'));
    }
  };

  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Select label={t('currency')} value={currency} onChange={(v) => set({ currency: v, ids: '' })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <NumberInput label={`${t('cmp_amount')} (${currency})`} value={amount} onChange={(v) => set({ amount: v })} min={1} step={100} />
          <Select label={t('term')} value={String(term)} onChange={(v) => set({ term: v, ids: '' })} options={STANDARD_TERMS.map((m) => ({ value: String(m), label: t('months_n', { n: m }) }))} />
          <Select label={t('payout')} value={payout} onChange={(v) => set({ payout: v, ids: '' })} options={(['at_maturity', 'monthly', 'quarterly', 'upfront'] as Payout[]).map((p) => ({ value: p, label: t(`payout_${p}`) }))} />
          <Select label={t('cmp_withdrawal')} value={need} onChange={(v) => set({ need: v })} options={(['any', 'interest', 'partial'] as const).map((v) => ({ value: v, label: t(`cmp_w_${v}`) }))} />
        </div>
        <div className="mt-3"><Check label={t('include_campaigns')} checked={campaigns} onChange={(v) => set({ campaigns: v ? '1' : '0' })} /></div>
      </Panel>
      {(result.excluded.amount > 0 || result.excluded.withdrawal > 0) && <Notice>{t('cmp_excluded', { a: result.excluded.amount, w: result.excluded.withdrawal })}</Notice>}

      <Panel title={t('cmp_eligible', { n: result.offers.length })} note={t('cmp_select')} flush>
        {!result.offers.length ? <Empty>{t('no_data')}</Empty> : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="data">
              <thead><tr><th><span className="sr-only">{t('cmp_side')}</span></th><th>{t('bank')}</th><th>{t('product')}</th><th className="r">{t('rate')}</th><th className="r">{t('cmp_net_interest')}</th><th className="r">{t('cmp_eay')}</th><th>{t('t_min')}</th></tr></thead>
              <tbody>
                {result.offers.map(({ offer, interest, eay, minimumKnown }) => (
                  <tr key={offer.id}>
                    <td><input type="checkbox" aria-label={`${offer.bankName} ${offer.productName}`} checked={selected.has(offer.id)} onChange={() => toggle(offer.id)} className="size-4 accent-[var(--accent)]" /></td>
                    <td className="whitespace-nowrap font-medium">{offer.bankName}</td>
                    <td>{localize(lang, offer.productName)} {offer.variant !== 'standard' && <span className="badge text-warn">{t(`variant_${offer.variant}`)}</span>} <VerificationBadge state={offer.verification} /></td>
                    <td className="r num font-semibold">{f.pct(offer.rate)}</td>
                    <td className="r num">{f.money(interest, currency)}</td>
                    <td className="r num">{f.pct(eay)}</td>
                    <td className="num text-xs">{minimumKnown ? text.minimum(termsFor(terms, offer.bankSlug, offer.productKey), currency) : <span className="text-warn">{t('cmp_unknown_min')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {chosen.length > 0 && (
        <Panel title={t('cmp_side')} flush>
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th><span className="sr-only">{t('st_measure')}</span></th>{chosen.map((c) => <th key={c.offer.id}>{c.offer.bankName}</th>)}</tr></thead>
              <tbody>
                {([
                  [t('product'), (c) => localize(lang, c.offer.productName)],
                  [t('rate'), (c) => f.pct(c.offer.rate)],
                  [t('cmp_net_interest'), (c) => f.money(c.interest, currency)],
                  [t('cmp_eay'), (c) => f.pct(c.eay)],
                  [t('t_min'), (c) => text.minimum(termsFor(terms, c.offer.bankSlug, c.offer.productKey), currency)],
                  [t('t_topup'), (c) => text.flag(termsFor(terms, c.offer.bankSlug, c.offer.productKey)?.topUp ?? null)],
                  [t('t_partial'), (c) => text.flag(termsFor(terms, c.offer.bankSlug, c.offer.productKey)?.partialWithdrawal ?? null)],
                  [t('t_early'), (c) => <EarlyText rule={termsFor(terms, c.offer.bankSlug, c.offer.productKey)?.earlyWithdrawal ?? null} currency={currency} />],
                  [t('verified'), (c) => f.date(c.offer.lastVerifiedAt)],
                  [t('source'), (c) => <a className="link" href={c.offer.sourceUrl} target="_blank" rel="noreferrer">{new URL(c.offer.sourceUrl).hostname}</a>],
                ] as [string, (c: (typeof chosen)[number]) => React.ReactNode][]).map(([name, render]) => (
                  <tr key={name}><th scope="row">{name}</th>{chosen.map((c) => <td key={c.offer.id} className="num">{render(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title={t('cmp_save')}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64"><Field label={t('cmp_label')}>{(id) => <input id={id} className="field" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field></div>
          <button type="button" className="btn" onClick={save}>{t('cmp_save')}</button>
          {message && <span role="status" className="text-sm text-ink-2">{message}</span>}
        </div>
      </Panel>
    </div>
  );
}

export default function Compare() {
  const { t } = useI18n();
  const rates = useApi('rates');
  const terms = useApi('terms');
  return (
    <>
      <PageHeader title={t('cmp_title')} subtitle={t('cmp_sub')} />
      <Loaded state={rates}>{({ rows }) => <Loaded state={terms}>{(x) => <Comparison rows={rows} terms={x.terms} />}</Loaded>}</Loaded>
    </>
  );
}
