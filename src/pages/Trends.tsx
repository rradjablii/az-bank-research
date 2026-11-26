import { useState } from 'react';
import { useI18n } from '../i18n';
import { marketQuery, useApi } from '../lib/api';
import { Check, Empty, Loaded, PageHeader, Panel, Select, SourceLine } from '../components/ui';
import { TimeSeries } from '../components/charts';
import { merge, monthlyRates } from '../lib/series';
import { describe, linearRegression } from '../../shared/stats';
import type { MarketBasis, MarketMetric, Segment } from '../../shared/types';

const BUCKETS = {
  deposit_rate: ['all', 'lt_1m', '1_3m', '3_6m', '6_9m', '9_12m', '1_5y', 'gt_5y'],
  loan_rate: ['all', 'lt_1m', '1_3m', '3_6m', '6_9m', '9_12m', '1_3y', '3_5y', '5_10y', 'gt_10y'],
} as const;
type Bucket = (typeof BUCKETS)[MarketMetric][number];

export default function Trends() {
  const { t, f } = useI18n();
  const [metric, setMetric] = useState<MarketMetric>('deposit_rate');
  const [basis, setBasis] = useState<MarketBasis>('new_business');
  const [segmentChoice, setSegment] = useState<Segment>('total');
  const [bucketChoice, setBucket] = useState<Bucket>('all');
  const [range, setRange] = useState<'12' | '36' | '60' | 'all'>('all');
  const [azn, setAzn] = useState(true);
  const [fx, setFx] = useState(true);
  const [trend, setTrend] = useState(false);

  // Segment and maturity breakdowns exist only for the outstanding portfolio (table 3.2).
  const segment = basis === 'outstanding' ? segmentChoice : 'total';
  const bucket = basis === 'outstanding' && segment === 'total' && (BUCKETS[metric] as readonly string[]).includes(bucketChoice) ? bucketChoice : 'all';
  const market = useApi('market', marketQuery(metric, basis, { segment, bucket }));
  const snaps = useApi('snapshots');
  const policy = useApi('policy');

  return (
    <>
      <PageHeader title={t('tr_title')} subtitle={t('tr_sub')} />
      <div className="space-y-4">
        <Panel>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Select label={t('tr_metric')} value={metric} onChange={setMetric} options={(['deposit_rate', 'loan_rate'] as const).map((v) => ({ value: v, label: t(`metric_${v}`) }))} />
            <Select label={t('tr_basis')} value={basis} onChange={setBasis} options={(['new_business', 'outstanding'] as const).map((v) => ({ value: v, label: t(`basis_${v}`) }))} />
            {basis === 'outstanding' && (
              <>
                <Select label={t('tr_segment')} value={segment} onChange={setSegment} options={(['total', 'individuals', 'legal_entities'] as const).map((v) => ({ value: v, label: t(`segment_${v}`) }))} />
                {segment === 'total' && <Select label={t('tr_bucket')} value={bucket} onChange={setBucket} options={BUCKETS[metric].map((v) => ({ value: v as Bucket, label: t(`bucket_${v}`) }))} />}
              </>
            )}
            <Select label={t('st_range')} value={range} onChange={setRange} options={(['12', '36', '60', 'all'] as const).map((v) => ({ value: v, label: t(`range_${v}`) }))} />
          </div>
          <fieldset className="mt-3 flex flex-wrap gap-5">
            <legend className="sr-only">{t('tr_currencies')}</legend>
            <Check label={t('cur_AZN')} checked={azn} onChange={setAzn} />
            <Check label={t('cur_FX')} checked={fx} onChange={setFx} />
            <Check label={t('tr_show_trend')} checked={trend} onChange={setTrend} />
          </fieldset>
        </Panel>

        <Loaded state={market}>
          {({ points, source }) => {
            const n = range === 'all' ? Infinity : Number(range);
            const cut = <T,>(x: T[]) => (n === Infinity ? x : x.slice(-n));
            const a = cut(monthlyRates(points, 'AZN'));
            const x = cut(monthlyRates(points, 'FX'));
            const fit = linearRegression(a.map((_, i) => i / 12), a.map((m) => m.value));
            const series = [
              ...(azn ? [{ key: 'azn', label: t('cur_AZN'), slot: 0 }] : []),
              ...(fx ? [{ key: 'fx', label: t('cur_FX'), slot: 1 }] : []),
              ...(trend && fit ? [{ key: 'trend', label: t('tr_trend'), slot: 2, dashed: true }] : []),
            ];
            const data = merge({
              ...(azn ? { azn: a } : {}),
              ...(fx ? { fx: x } : {}),
              ...(trend && fit ? { trend: a.map((m, i) => ({ month: m.month, value: fit.intercept + (fit.slope * i) / 12 })) } : {}),
            });
            return (
              <>
                <Panel title={`${t(`metric_${metric}`)} · ${t(`basis_${basis}`)}`} note={t('tr_annual')}>
                  {data.length ? <TimeSeries height={340} data={data} series={series} /> : <Empty>{t('no_data')}</Empty>}
                  {trend && fit && <p className="mt-2 text-xs text-ink-2">{t('tr_trend')}: {t('tr_trend_result', { slope: f.number(fit.slope), r2: f.number(fit.r2), n: fit.n })}</p>}
                  {source && <SourceLine name={source.name} url={source.url} verified={source.lastVerifiedAt} state={source.freshness} />}
                </Panel>
                <Panel title={t('tr_summary')} flush>
                  <div className="overflow-x-auto">
                    <table className="data num">
                      <thead><tr><th>{t('currency')}</th><th className="r">{t('observations')}</th><th className="r">{t('tr_latest')}</th><th className="r">{t('tr_change')}</th><th className="r">{t('mean')}</th><th className="r">{t('median')}</th><th className="r">{t('min')}</th><th className="r">{t('max')}</th></tr></thead>
                      <tbody>
                        {([[t('cur_AZN'), a], [t('cur_FX'), x]] as const).map(([label, values]) => {
                          const s = describe(values.map((v) => v.value));
                          return (
                            <tr key={label}>
                              <td>{label}</td><td className="r">{s.n}</td><td className="r">{f.pct(values.at(-1)?.value)}</td>
                              <td className="r">{values.length > 1 ? f.number(values.at(-1)!.value - values[0]!.value) : '—'}</td>
                              <td className="r">{f.pct(s.mean)}</td><td className="r">{f.pct(s.median)}</td><td className="r">{f.pct(s.min)}</td><td className="r">{f.pct(s.max)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                <Panel title={t('tr_table')} flush>
                  <div className="max-h-80 overflow-auto">
                    <table className="data num">
                      <thead className="sticky top-0 bg-surface"><tr><th>{t('inf_month')}</th><th className="r">{t('cur_AZN')}</th><th className="r">{t('cur_FX')}</th></tr></thead>
                      <tbody>
                        {merge({ azn: a, fx: x }).reverse().map((r) => (
                          <tr key={String(r.date)}><td>{f.month(String(r.date))}</td><td className="r">{f.pct(r.azn as number | null)}</td><td className="r">{f.pct(r.fx as number | null)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            );
          }}
        </Loaded>

        <Panel title={t('tr_policy')}>
          <Loaded state={policy}>
            {({ points, source }) => {
              const rows = range === 'all' ? points : points.slice(-Number(range));
              if (!rows.length) return <Empty>{t('no_data')}</Empty>;
              return (
                <>
                  <TimeSeries height={240} data={rows.map((p) => ({ date: p.month, refinancing: p.refinancing, floor: p.floor, ceiling: p.ceiling }))}
                    series={[{ key: 'refinancing', label: t('tr_refi'), slot: 0 }, { key: 'floor', label: t('tr_floor'), slot: 2, dashed: true }, { key: 'ceiling', label: t('tr_ceiling'), slot: 1, dashed: true }]} />
                  {source && <SourceLine name={source.name} url={source.url} verified={source.lastVerifiedAt} state={source.freshness} />}
                </>
              );
            }}
          </Loaded>
        </Panel>

        <Panel title={t('tr_snap')} note={t('tr_snap_note')}>
          <Loaded state={snaps}>
            {({ snapshots }) => {
              const rows = snapshots.filter((s) => s.productType === 'term_deposit' && s.currency === 'AZN' && s.term === 12 && s.payout === 'at_maturity');
              if (!rows.length) return <Empty>{t('no_data')}</Empty>;
              return (
                <>
                  {rows.length > 1 && (
                    <TimeSeries height={220} data={rows.map((r) => ({ date: r.date, median: r.median, max: r.max }))}
                      series={[{ key: 'median', label: t('median'), slot: 0 }, { key: 'max', label: t('max'), slot: 1 }]} />
                  )}
                  {rows.length < 2 && <p className="mb-2 text-sm text-ink-2">{t('tr_snap_one', { n: rows.length })}</p>}
                  <div className="max-h-64 overflow-auto">
                    <table className="data num">
                      <thead><tr><th>{t('tr_date')}</th><th className="r">{t('banks_covered')}</th><th className="r">{t('mean')}</th><th className="r">{t('median')}</th><th className="r">{t('min')}</th><th className="r">{t('max')}</th></tr></thead>
                      <tbody>
                        {[...rows].reverse().map((r) => (
                          <tr key={r.date}><td>{f.date(r.date)}</td><td className="r">{r.nBanks}</td><td className="r">{f.pct(r.mean)}</td><td className="r">{f.pct(r.median)}</td><td className="r">{f.pct(r.min)}</td><td className="r">{f.pct(r.max)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            }}
          </Loaded>
        </Panel>
      </div>
    </>
  );
}
