import { useState } from 'react';
import { useI18n } from '../i18n';
import { marketQuery, useApi } from '../lib/api';
import { Empty, Loaded, NumberInput, PageHeader, Panel, SourceLine, Stat, StatGrid } from '../components/ui';
import { TimeSeries } from '../components/charts';
import { exPostRealRates, purchasingPower, realRate } from '../../shared/finance';
import { merge, monthlyInflation, monthlyRates } from '../lib/series';

export default function Inflation() {
  const { t, f } = useI18n();
  const inf = useApi('inflation');
  const dep = useApi('market', marketQuery('deposit_rate', 'new_business', { segment: 'total', bucket: 'all' }));
  const [nominalInput, setNominal] = useState('');
  const [inflationInput, setInflation] = useState('');
  const [amountInput, setAmount] = useState('10000');
  const [monthsInput, setMonths] = useState('12');

  return (
    <>
      <PageHeader title={t('inf_title')} subtitle={t('inf_sub')} />
      <Loaded state={inf}>
        {({ points, source }) => {
          const cpi = monthlyInflation(points);
          const latest = cpi.at(-1);
          const rates = dep.data ? monthlyRates(dep.data.points, 'AZN') : [];
          const nominal = nominalInput === '' ? rates.at(-1)?.value : Number(nominalInput);
          const inflation = inflationInput === '' ? latest?.value : Number(inflationInput);
          const amount = Number(amountInput);
          const months = Number(monthsInput);
          const ok = nominal !== undefined && inflation !== undefined && inflation > -100 && nominal > -100 && amount > 0 && months >= 1 && months <= 600;
          const future = ok ? amount * Math.pow(1 + nominal / 100, months / 12) : null;
          const expost = exPostRealRates(rates.map((r) => ({ month: r.month, rate: r.value })), cpi.map((c) => ({ month: c.month, yoy: c.value })));
          if (!cpi.length) return <Panel><Empty>{t('no_data_yet')}</Empty></Panel>;
          return (
            <div className="space-y-4">
              <Panel title={t('inf_calc')} note={t('inf_formula')}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <NumberInput label={t('inf_nominal')} value={nominalInput === '' ? String(nominal?.toFixed(2) ?? '') : nominalInput} onChange={setNominal} step={0.1} />
                  <NumberInput label={t('inf_inflation')} value={inflationInput === '' ? String(inflation?.toFixed(2) ?? '') : inflationInput} onChange={setInflation} step={0.1} />
                  <NumberInput label={t('inf_amount')} value={amountInput} onChange={setAmount} step={100} min={1} />
                  <NumberInput label={t('sim_months')} value={monthsInput} onChange={setMonths} step={1} min={1} max={600} />
                </div>
                {latest && (
                  <button type="button" className="btn mt-3" onClick={() => setInflation('')}>{t('inf_use_latest', { v: f.number(latest.value), month: f.month(latest.month) })}</button>
                )}
                <div className="mt-3">
                  <StatGrid cols="grid-cols-1 sm:grid-cols-3">
                    <Stat label={t('inf_real_rate')} value={ok ? f.pct(realRate(nominal, inflation)) : '—'} />
                    <Stat label={t('inf_nominal_value')} value={future === null ? '—' : f.money(future)} />
                    <Stat label={t('inf_real_value')} value={future === null ? '—' : f.money(purchasingPower(future, inflation!, months))} />
                  </StatGrid>
                </div>
                {source && <SourceLine name={source.name} url={source.url} verified={source.lastVerifiedAt} state={source.freshness} />}
              </Panel>

              <Panel title={t('inf_align_t')}>
                <div className="prose-sm max-w-3xl">
                  <ul><li>{t('inf_align_1')}</li><li>{t('inf_align_2')}</li><li>{t('inf_align_3')}</li><li>{t('inf_align_4')}</li></ul>
                </div>
              </Panel>

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title={t('inf_cpi')}>
                  <TimeSeries zero data={merge({ cpi }).slice(-120)} series={[{ key: 'cpi', label: t('series_inflation'), slot: 1 }]} />
                </Panel>
                <Panel title={t('inf_expost')}>
                  {expost.length ? (
                    <TimeSeries zero data={expost.map((e) => ({ date: e.month, real: Number(e.real.toFixed(3)), nominal: e.nominal }))}
                      series={[{ key: 'real', label: t('series_real'), slot: 0 }, { key: 'nominal', label: t('series_nominal'), slot: 2, dashed: true }]} />
                  ) : <Empty>{t('no_data')}</Empty>}
                </Panel>
              </div>

              <Panel title={t('inf_recent')} flush>
                <div className="overflow-x-auto">
                  <table className="data num">
                    <thead><tr><th>{t('inf_month')}</th><th className="r">{t('series_nominal')}</th><th className="r">{t('series_inflation')}</th><th className="r">{t('series_real')}</th></tr></thead>
                    <tbody>
                      {expost.slice(-12).reverse().map((e) => (
                        <tr key={e.month}><td>{f.month(e.month)}</td><td className="r">{f.pct(e.nominal)}</td><td className="r">{f.pct(e.inflation)}</td><td className="r font-semibold">{f.pct(e.real)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          );
        }}
      </Loaded>
    </>
  );
}
