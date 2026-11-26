import { useI18n } from '../i18n';
import { STANDARD_TERMS, hasTerm, type Selection } from '../../shared/selection';
import { CURRENCIES, type Payout, type ProductType } from '../../shared/types';
import { Check, Select } from './ui';

export const DEFAULT_SELECTION: Selection = {
  productType: 'term_deposit', currency: 'AZN', term: 12, payout: 'at_maturity', includeCampaigns: false, includeUninsured: false, perBank: true,
};

/** Forces the user to pick one product type, currency, term and payout, so offers stay comparable. */
export function SelectionControls({ value, onChange }: { value: Selection; onChange: (s: Selection) => void }) {
  const { t } = useI18n();
  const set = <K extends keyof Selection>(k: K, v: Selection[K]) => onChange({ ...value, [k]: v });
  const termed = hasTerm(value.productType);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Select label={t('product_type')} value={value.productType}
          onChange={(v: ProductType) => onChange({ ...value, productType: v, currency: v === 'consumer_loan' ? 'AZN' : value.currency, payout: v === 'flexible_deposit' ? 'monthly' : 'at_maturity', term: hasTerm(v) ? 12 : null })}
          options={(['term_deposit', 'savings_deposit', 'flexible_deposit', 'consumer_loan'] as ProductType[]).map((v) => ({ value: v, label: t(`type_${v}`) }))} />
        <Select label={t('currency')} value={value.currency} onChange={(v) => set('currency', v)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        {termed && (
          <Select label={t('term')} value={String(value.term)} onChange={(v) => set('term', Number(v))}
            options={STANDARD_TERMS.map((m) => ({ value: String(m), label: t('months_n', { n: m }) }))} />
        )}
        {value.productType !== 'consumer_loan' && (
          <Select label={t('payout')} value={value.payout} onChange={(v: Payout) => set('payout', v)}
            options={(['at_maturity', 'monthly', 'quarterly', 'upfront'] as Payout[]).map((p) => ({ value: p, label: t(`payout_${p}`) }))} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Check label={t('one_per_bank')} checked={value.perBank} onChange={(v) => set('perBank', v)} />
        <Check label={t('include_campaigns')} checked={value.includeCampaigns} onChange={(v) => set('includeCampaigns', v)} />
        <Check label={t('include_uninsured')} checked={value.includeUninsured} onChange={(v) => set('includeUninsured', v)} />
      </div>
    </div>
  );
}
