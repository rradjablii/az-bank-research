import { useState } from 'react';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { request, useApi } from '../lib/api';
import { Notice, NumberInput, Panel, Stat, StatGrid } from './ui';
import { EarlyText, termsFor } from './terms';
import { earlyExit, type InterestMethod } from '../../shared/finance';
import { eligibleOffers } from '../../shared/eligibility';
import type { Currency, RateRow } from '../../shared/types';

export function EarlyClosure({ offer, principal, rate, months, method, currency }: {
  offer: RateRow | undefined; principal: number; rate: number; months: number; method: InterestMethod; currency: Currency;
}) {
  const { t, f } = useI18n();
  const terms = useApi('terms');
  const [after, setAfter] = useState('6');
  if (!offer) return null;
  const found = termsFor(terms.data?.terms ?? [], offer.bankSlug, offer.productKey);
  const rule = found?.earlyWithdrawal ?? null;
  const exit = earlyExit(principal, rate, months, Number(after), method, currency, rule);
  return (
    <Panel title={t('dec_early')}>
      <div className="mb-3 text-sm"><EarlyText rule={rule} currency={currency} /></div>
      <div className="mb-3 w-48"><NumberInput label={t('dec_early_after')} value={after} onChange={setAfter} min={1} max={Math.max(1, months - 1)} step={1} /></div>
      {exit ? (
        <StatGrid cols="grid-cols-1 sm:grid-cols-3">
          <Stat label={t('dec_early_interest')} value={f.money(exit.interest, currency)} />
          <Stat label={t('dec_early_clawback')} value={f.money(exit.clawback, currency)} />
          <Stat label={t('dec_early_total')} value={f.money(exit.proceeds, currency)} />
        </StatGrid>
      ) : <Notice tone="warn">{t('dec_early_unknown')}</Notice>}
      {found && <a className="link mt-2 inline-block text-xs" href={found.sourceUrl} target="_blank" rel="noreferrer">{t('source')}</a>}
    </Panel>
  );
}

export function Alternatives({ offer, offers, principal, months }: { offer: RateRow; offers: RateRow[]; principal: number; months: number }) {
  const { t, f, lang } = useI18n();
  const terms = useApi('terms');
  const { offers: list } = eligibleOffers(offers, terms.data?.terms ?? [], {
    currency: offer.currency, term: months, amount: principal, payout: offer.payout, need: 'any', includeCampaigns: false,
  });
  const own = (principal * (offer.rate / 100) * months) / 12;
  const others = list.filter((x) => x.offer.id !== offer.id).slice(0, 6);
  if (!others.length) return null;
  return (
    <Panel title={t('dec_alternatives')} flush>
      <div className="overflow-x-auto">
        <table className="data num">
          <thead><tr><th>{t('bank')}</th><th>{t('product')}</th><th className="r">{t('rate')}</th><th className="r">{t('cmp_net_interest')}</th><th className="r">{t('dec_difference')}</th></tr></thead>
          <tbody>
            {others.map((x) => (
              <tr key={x.offer.id}>
                <td>{x.offer.bankName}</td><td>{localize(lang, x.offer.productName)}</td><td className="r">{f.pct(x.offer.rate)}</td>
                <td className="r">{f.money(x.interest, offer.currency)}</td>
                <td className={`r ${x.interest > own ? 'text-good' : 'text-ink-2'}`}>{x.interest > own ? '+' : ''}{f.number(x.interest - own)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function SaveScenario({ query, label }: { query: string; label: string }) {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const save = async () => {
    try {
      await request('account/items', { method: 'POST', body: { kind: 'scenario', label: label.slice(0, 120), payload: { query: query.slice(0, 200) } } });
      setMessage(t('cmp_saved'));
    } catch {
      setMessage(t('cmp_signin'));
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn" onClick={save}>{t('dec_save')}</button>
      {message && <span role="status" className="text-sm text-ink-2">{message}</span>}
    </div>
  );
}
