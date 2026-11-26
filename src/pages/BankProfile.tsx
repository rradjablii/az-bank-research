import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { request, useApi } from '../lib/api';
import { Empty, FreshnessBadge, Loaded, Notice, PageHeader, Panel, Stat, StatGrid, VerificationBadge } from '../components/ui';
import { EarlyText, termsFor, useTermsText } from '../components/terms';
import { EventList } from '../components/events';
import { termLabel } from './Explorer';
import { STANDARD_TERMS, selectOffers } from '../../shared/selection';
import { median, percentileRank } from '../../shared/stats';
import { CURRENCIES, type RateRow } from '../../shared/types';

/** Where the bank's best rate sits among one-best-per-bank offers of the same segment. */
function positions(rows: RateRow[], slug: string) {
  return CURRENCIES.flatMap((currency) =>
    STANDARD_TERMS.flatMap((term) => {
      const market = selectOffers(rows, { productType: 'term_deposit', currency, term, payout: 'at_maturity', includeCampaigns: false, includeUninsured: false, perBank: true });
      const own = market.find((r) => r.bankSlug === slug);
      if (!own || market.length < 2) return [];
      const values = market.map((r) => r.rate);
      return [{ key: `${currency}-${term}`, currency, term, rate: own.rate, median: median(values)!, percentile: percentileRank(values, own.rate)!, n: market.length }];
    }),
  );
}

export default function BankProfile() {
  const { slug = '' } = useParams();
  const { t, f, lang } = useI18n();
  const text = useTermsText();
  const detail = useApi('bank', '', slug);
  const rates = useApi('rates');
  const terms = useApi('terms');
  const [note, setNote] = useState('');

  const favourite = async (label: string, product?: string) => {
    try {
      await request('account/items', { method: 'POST', body: { kind: 'favorite', label, payload: { bank: slug, ...(product ? { product } : {}) } } });
      setNote(t('cmp_saved'));
    } catch {
      setNote(t('cmp_signin'));
    }
  };

  return (
    <Loaded state={detail}>
      {({ bank, history, events }) => {
        const all = rates.data?.rows ?? [];
        const own = all.filter((r) => r.bankSlug === slug);
        const products = [...new Map(own.filter((r) => r.category === 'deposit').map((r) => [r.productKey, r])).values()];
        const position = positions(all, slug);
        return (
          <div className="space-y-4">
            <PageHeader title={bank.name} subtitle={localize(lang, bank.accessNote) ?? t('banks_sub')}>
              <div className="flex gap-2">
                <a className="btn" href={bank.website} target="_blank" rel="noreferrer">{t('bank_website')}</a>
                <button type="button" className="btn" onClick={() => favourite(bank.name)}>{t('acc_fav_bank')}</button>
              </div>
            </PageHeader>
            {note && <Notice>{note}</Notice>}
            <section aria-label={t('bank_coverage')}>
              <StatGrid>
                <Stat label={t('records')} value={own.length} />
                <Stat label={t('banks_currencies')} value={[...new Set(own.map((r) => r.currency))].join(', ') || '—'} />
                <Stat label={t('status')} value={<FreshnessBadge state={bank.freshness} />} />
                <Stat label={t('verified')} value={<span className="text-sm">{f.dateTime(bank.lastVerifiedAt)}</span>} />
              </StatGrid>
            </section>
            {!own.length ? <Panel><Empty>{t('no_data')}</Empty></Panel> : (
              <>
                <Panel title={t('bank_current')} flush>
                  <div className="max-h-96 overflow-auto">
                    <table className="data">
                      <thead><tr><th>{t('product')}</th><th>{t('currency')}</th><th>{t('term')}</th><th>{t('payout')}</th><th className="r">{t('rate')}</th><th>{t('status')}</th><th>{t('source')}</th></tr></thead>
                      <tbody>
                        {own.map((r) => (
                          <tr key={r.id}>
                            <td>{localize(lang, r.productName)} {r.variant !== 'standard' && <span className="badge text-warn">{t(`variant_${r.variant}`)}</span>}</td>
                            <td>{r.currency}</td>
                            <td className="num whitespace-nowrap">{termLabel(r, t)}</td>
                            <td>{r.category === 'loan' ? '—' : t(`payout_${r.payout}`)}</td>
                            <td className="r num whitespace-nowrap font-semibold">{r.qualifier === 'from' && `${t('q_from')} `}{f.pct(r.rate)}{r.rateMax !== null && ` – ${f.pct(r.rateMax)}`}</td>
                            <td><FreshnessBadge state={r.freshness} /> <VerificationBadge state={r.verification} /></td>
                            <td className="text-xs"><a className="link" href={r.sourceUrl} target="_blank" rel="noreferrer">↗</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                <Panel title={t('bank_conditions')} note={t('bank_conditions_note')} flush>
                  <div className="overflow-x-auto">
                    <table className="data">
                      <thead><tr><th>{t('product')}</th><th>{t('t_min')}</th><th>{t('t_topup')}</th><th>{t('t_partial')}</th><th>{t('t_early')}</th></tr></thead>
                      <tbody>
                        {products.map((p) => {
                          const x = termsFor(terms.data?.terms ?? [], slug, p.productKey);
                          return (
                            <tr key={p.productKey}>
                              <td>
                                <a className="link" href={p.sourceUrl} target="_blank" rel="noreferrer">{localize(lang, p.productName)}</a>
                                <div><button type="button" className="link text-xs" onClick={() => favourite(`${bank.name} · ${p.productName}`, p.productKey)}>☆ {t('acc_fav_product')}</button></div>
                              </td>
                              <td className="num">{text.minimum(x)}</td>
                              <td>{text.flag(x?.topUp ?? null)}</td>
                              <td>{text.flag(x?.partialWithdrawal ?? null)}</td>
                              <td className="text-xs"><EarlyText rule={x?.earlyWithdrawal ?? null} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                {position.length > 0 && (
                  <Panel title={t('bank_position')} note={`${t('payout_at_maturity')} · ${t('one_per_bank')}`} flush>
                    <div className="max-h-80 overflow-auto">
                      <table className="data num">
                        <thead><tr><th>{t('bank_segment')}</th><th className="r">{t('bank_best')}</th><th className="r">{t('bank_market_median')}</th><th className="r">{t('bank_percentile')}</th><th className="r">{t('banks_covered')}</th></tr></thead>
                        <tbody>
                          {position.map((p) => (
                            <tr key={p.key}><td>{p.currency} · {t('months_n', { n: p.term })}</td><td className="r">{f.pct(p.rate)}</td><td className="r">{f.pct(p.median)}</td><td className="r">{f.number(p.percentile, 0)}</td><td className="r">{p.n}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                )}
              </>
            )}
            <Panel title={t('bank_changes')}>{events.length ? <EventList events={events} /> : <p className="text-sm text-ink-2">{t('bank_no_changes')}</p>}</Panel>
            {history.length > 0 && (
              <Panel title={t('bank_history')} note={t('bank_history_note')} flush>
                <div className="max-h-80 overflow-auto">
                  <table className="data num text-xs">
                    <thead><tr><th>{t('product')}</th><th>{t('currency')}</th><th>{t('term')}</th><th>{t('payout')}</th><th className="r">{t('rate')}</th><th>{t('bank_from')}</th><th>{t('bank_until')}</th></tr></thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i}>
                          <td>{localize(lang, h.productName)}</td><td>{h.currency}</td><td>{h.termMin ?? '—'}</td><td>{t(`payout_${h.payout as 'monthly'}`)}</td>
                          <td className="r">{f.pct(h.rate)}</td><td>{f.date(h.from)}</td><td>{h.until ? f.date(h.until) : t('bank_still')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
            <Link className="link text-sm" to="/banks">← {t('banks_title')}</Link>
          </div>
        );
      }}
    </Loaded>
  );
}
