import { useI18n } from '../i18n';
import type { EarlyWithdrawal, ProductTermsRow, Currency } from '../../shared/types';

export function EarlyText({ rule, currency }: { rule: EarlyWithdrawal | null; currency?: Currency }) {
  const { t, f } = useI18n();
  if (!rule) return <span className="text-ink-2">{t('t_unknown')}</span>;
  if (rule.type === 'forfeit') return <>{t('t_forfeit')}</>;
  if (rule.type === 'reduced_rate') {
    const rates = currency ? [rule.rates[currency]] : Object.values(rule.rates);
    return <>{t('t_reduced', { r: rates.map((r) => (r === undefined ? '—' : f.number(r, 1))).join(' / ') })}</>;
  }
  return (
    <ul>
      {rule.tiers.map((x) => (
        <li key={x.from} className="whitespace-nowrap">
          {x.to === null
            ? t(rule.unit === 'days' ? 't_share_days_open' : 't_share_term_open', { a: Math.ceil(x.from), p: x.retainedPct })
            : t(rule.unit === 'days' ? 't_share_days' : 't_share_term', { a: Math.ceil(x.from), b: Math.floor(x.to), p: x.retainedPct })}
        </li>
      ))}
    </ul>
  );
}

export function useTermsText() {
  const { t, f } = useI18n();
  return {
    flag: (v: boolean | null) => (v === null ? t('t_unknown') : v ? t('t_yes') : t('t_no')),
    minimum: (terms: ProductTermsRow | undefined, currency?: Currency) => {
      const entries = Object.entries(terms?.minAmount ?? {}).filter(([c]) => !currency || c === currency);
      return entries.length ? entries.map(([c, v]) => `${f.number(v, 0)} ${c}`).join(', ') : t('t_unknown');
    },
  };
}

export const termsFor = (terms: ProductTermsRow[], bankSlug: string, productKey: string) =>
  terms.find((x) => x.bankSlug === bankSlug && x.productKey === productKey);
