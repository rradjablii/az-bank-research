import { useI18n } from '../i18n';
import { marketQuery, useApi } from '../lib/api';
import { PageHeader, Panel, Empty } from '../components/ui';
import { DEFAULT_SELECTION } from '../components/SelectionControls';
import { selectOffers } from '../../shared/selection';
import { mean, median } from '../../shared/stats';
import { realRate, simulateDeposit } from '../../shared/finance';
import { monthlyInflation, monthlyRates } from '../lib/series';

export default function Learn() {
  const { t, f } = useI18n();
  const rates = useApi('rates');
  const dep = useApi('market', marketQuery('deposit_rate', 'new_business', { segment: 'total', bucket: 'all' }));
  const inf = useApi('inflation');
  const d = dep.data ? monthlyRates(dep.data.points, 'AZN').at(-1)?.value : undefined;
  const i = inf.data ? monthlyInflation(inf.data.points).at(-1)?.value : undefined;
  const offers = rates.data ? selectOffers(rates.data.rows, DEFAULT_SELECTION).map((r) => r.rate) : [];
  const med = median(offers);
  const example = (method: 'at_maturity' | 'compound') =>
    simulateDeposit({ principal: 10_000, annualRate: med!, months: 36, method, compounding: 12, currency: 'AZN', tax: 'none' });

  const cards: [string, string | null][] = [
    [t('learn_rate_t'), d !== undefined && i !== undefined ? t('learn_rate', { dep: f.number(d), inf: f.number(i), real: f.number(realRate(d, i)) }) : null],
    [t('learn_comp_t'), med !== null ? t('learn_comp', { r: f.number(med), simple: f.money(example('at_maturity').grossInterest), compound: f.money(example('compound').maturityValue) }) : null],
    [t('learn_med_t'), med !== null ? t('learn_med', { mean: f.number(mean(offers)), median: f.number(med) }) : null],
    [t('learn_check_t'), t('learn_check')],
  ];
  return (
    <>
      <PageHeader title={t('learn_title')} subtitle={t('learn_sub')} />
      <div className="grid max-w-5xl gap-4 md:grid-cols-2">
        {cards.map(([title, body]) => (
          <Panel key={title} title={title}>{body ? <p className="leading-relaxed">{body}</p> : <Empty>{t('no_data')}</Empty>}</Panel>
        ))}
      </div>
    </>
  );
}
