import { useState } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { localize } from '../i18n/data';
import { marketQuery, useApi } from '../lib/api';
import { Check, Empty, Loaded, Notice, NumberInput, PageHeader, Panel, Segmented, Select, SourceLine, Stat, StatGrid } from '../components/ui';
import { HistogramChart, ScatterFit } from '../components/charts';
import { DEFAULT_SELECTION, SelectionControls } from '../components/SelectionControls';
import { selectOffers } from '../../shared/selection';
import * as S from '../../shared/stats';
import { exPostRealRates, referenceMonth } from '../../shared/finance';
import { align, monthlyInflation, monthlyRates, type Monthly } from '../lib/series';
import { ProbabilityLab, TestsTab } from '../components/lab';
import type { Freshness } from '../../shared/types';

type Tab = 'offers' | 'probability' | 'series' | 'relations' | 'tests' | 'notes';
type SeriesKey = 'dep_azn' | 'dep_fx' | 'loan_azn' | 'loan_fx' | 'cpi';
const SERIES_KEYS: SeriesKey[] = ['dep_azn', 'dep_fx', 'loan_azn', 'loan_fx', 'cpi'];

function useOfficialSeries() {
  const dep = useApi('market', marketQuery('deposit_rate', 'new_business', { segment: 'total', bucket: 'all' }));
  const loan = useApi('market', marketQuery('loan_rate', 'new_business', { segment: 'total', bucket: 'all' }));
  const inf = useApi('inflation');
  const series: Record<SeriesKey, Monthly[]> = {
    dep_azn: dep.data ? monthlyRates(dep.data.points, 'AZN') : [],
    dep_fx: dep.data ? monthlyRates(dep.data.points, 'FX') : [],
    loan_azn: loan.data ? monthlyRates(loan.data.points, 'AZN') : [],
    loan_fx: loan.data ? monthlyRates(loan.data.points, 'FX') : [],
    cpi: inf.data ? monthlyInflation(inf.data.points) : [],
  };
  return {
    state: {
      loading: dep.loading || loan.loading || inf.loading,
      error: dep.error ?? loan.error ?? inf.error,
      data: dep.data && loan.data && inf.data ? { series, inflation: inf.data, rates: dep.data } : null,
    },
  };
}

interface Observation {
  label: string;
  value: number;
}

/** The full descriptive/inferential toolkit applied to one comparable dataset. */
function Analysis({ data, kind }: { data: Observation[]; kind: 'offers' | 'series' }) {
  const { t, f } = useI18n();
  const [exclude, setExclude] = useState(false);
  const [threshold, setThreshold] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  if (!data.length) return <Panel><Empty>{t('no_data')}</Empty></Panel>;

  const all = data.map((d) => d.value);
  const fences = S.outlierFences(all);
  const isOutlier = (v: number) => !!fences && (v < fences.lower || v > fences.upper);
  const outliers = data.filter((d) => isOutlier(d.value));
  const used = exclude ? data.filter((d) => !isOutlier(d.value)) : data;
  const values = used.map((d) => d.value);
  const s = S.describe(values);
  const bins = S.histogram(values);
  const ci = S.confidenceInterval(values);

  const num = (v: string, fallback: number | null) => (v.trim() === '' || !Number.isFinite(Number(v)) ? (fallback ?? 0) : Number(v));
  const th = num(threshold, 10);
  const a = num(from, s.q1);
  const b = num(to, s.q3);
  const probs = [
    { label: t('st_p_above', { t: f.number(th) }), p: S.probAbove(values, th) },
    { label: t('st_p_between', { a: f.number(Math.min(a, b)), b: f.number(Math.max(a, b)) }), p: S.probBetween(values, a, b) },
    { label: t('st_p_median', { m: f.number(s.median) }), p: S.probAboveMedian(values) },
  ];

  const shape = S.shape(values);
  const jb = S.jarqueBera(values);
  const formulas: Partial<Record<MessageKey, string>> = {
    st_mean_d: 'x̄ = Σxᵢ / n', st_median_d: 'P50', st_range_d: 'max − min', st_var_p_d: 'Σ(xᵢ − x̄)² / n', st_var_s_d: 'Σ(xᵢ − x̄)² / (n − 1)',
    st_sd_d: '√variance', st_cv_d: 's / |x̄|', st_q_d: 'h = (n − 1)p', st_iqr_d: 'Q3 − Q1',
  };
  const rows: [string, string, MessageKey][] = [
    [t('st_n'), String(s.n), 'st_n_d'],
    [t('mean'), f.pct(s.mean), 'st_mean_d'],
    [t('median'), f.pct(s.median), 'st_median_d'],
    [t('st_mode'), s.mode.values.length ? `${s.mode.values.map((v) => f.pct(v)).join('; ')} (×${s.mode.count})` : t('st_mode_none'), 'st_mode_d'],
    [t('min'), f.pct(s.min), 'st_min_d'],
    [t('max'), f.pct(s.max), 'st_max_d'],
    [t('st_range_m'), f.number(s.range), 'st_range_d'],
    [t('st_var_p'), f.number(s.variancePop, 4), 'st_var_p_d'],
    [t('st_var_s'), f.number(s.varianceSample, 4), 'st_var_s_d'],
    [t('st_sd_p'), f.number(s.sdPop, 4), 'st_sd_d'],
    [t('st_sd_s'), f.number(s.sdSample, 4), 'st_sd_d'],
    [t('st_cv'), s.cv === null ? '—' : f.pct(s.cv * 100), 'st_cv_d'],
    [t('st_q1'), f.pct(s.q1), 'st_q_d'],
    [t('st_q3'), f.pct(s.q3), 'st_q_d'],
    [t('st_iqr'), f.number(s.iqr), 'st_iqr_d'],
  ];
  const ranks = S.rank(values);

  return (
    <div className="space-y-4">
      {s.n < 8 && <Notice tone="warn">{t('st_small', { n: s.n })}</Notice>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t('st_descriptive')} flush>
          <table className="data">
            <thead><tr><th>{t('st_measure')}</th><th className="r">{t('st_value')}</th><th className="hidden sm:table-cell">{t('st_meaning')}</th></tr></thead>
            <tbody>
              {rows.map(([label, value, help]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="r num font-semibold whitespace-nowrap">{value}</td>
                  <td className="hidden text-xs text-ink-2 sm:table-cell">{t(help)}{formulas[help] && <div className="font-mono text-[11px]">{formulas[help]}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <div className="space-y-4">
          <Panel title={t('st_hist')} note={t('st_bin_note')}>
            <HistogramChart label={t('st_count')} data={bins.map((x) => ({ range: `${f.number(x.from, 1)}–${f.number(x.to, 1)}`, count: x.count }))} />
            <div className="mt-2 max-h-56 overflow-auto">
              <table className="data num">
                <thead><tr><th>{t('st_bin')}</th><th className="r">{t('st_count')}</th><th className="r">{t('st_rel')}</th><th className="r">{t('st_cum')}</th></tr></thead>
                <tbody>
                  {bins.map((x) => (
                    <tr key={x.from}>
                      <td>{f.number(x.from)} – {f.number(x.to)}</td><td className="r">{x.count}</td>
                      <td className="r">{f.pct(x.relative * 100, 1)}</td><td className="r">{f.pct(x.cumulative * 100, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title={t('st_outliers')}>
            <p className="mb-2 text-sm">
              {!fences ? t('st_outliers_small') : outliers.length
                ? t('st_outliers_some', { n: outliers.length, a: f.number(fences.lower), b: f.number(fences.upper), list: outliers.slice(0, 8).map((o) => `${o.label} ${f.pct(o.value)}`).join(', ') })
                : t('st_outliers_none', { a: f.number(fences.lower), b: f.number(fences.upper) })}
            </p>
            {outliers.length > 0 && <Check label={t('st_exclude')} checked={exclude} onChange={setExclude} />}
          </Panel>
          <Panel title={t('st_ci')}>
            {ci ? (
              <>
                <div className="num text-lg font-semibold">{t('st_ci_value', { a: f.number(ci.lower), b: f.number(ci.upper) })}</div>
                <p className="mt-1 text-xs text-ink-2">{t(kind === 'offers' ? 'st_ci_offers' : 'st_ci_series', { df: ci.df })}</p>
              </>
            ) : <p className="text-sm text-ink-2">{t('st_ci_need')}</p>}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('lab_interp_title')}>
          {s.n > 1 ? (
            <p className="text-sm leading-relaxed">
              {t('lab_interp', { n: s.n, median: f.number(s.median), q1: f.number(s.q1), q3: f.number(s.q3) })}{' '}
              {t(Math.abs(s.mean! - s.median!) < 0.1 * (s.sdSample || 1) ? 'lab_interp_even' : s.mean! > s.median! ? 'lab_interp_high' : 'lab_interp_low', { mean: f.number(s.mean) })}
            </p>
          ) : <p className="text-sm text-ink-2">{t('st_ci_need')}</p>}
        </Panel>
        <Panel title={t('lab_shape')}>
          {shape && jb ? (
            <>
              <p className="num text-sm">{t('lab_skew')}: {f.number(shape.skewness)} · {t('lab_kurt')}: {f.number(shape.excessKurtosis)} · {t('lab_jb')}: {f.number(jb.p, 3)}</p>
              <p className="mt-1 text-xs text-ink-2">{t(!jb.reliable ? 'lab_jb_small' : jb.p < 0.05 ? 'lab_jb_reject' : 'lab_jb_ok')}</p>
            </>
          ) : <p className="text-sm text-ink-2">{t('st_ci_need')}</p>}
        </Panel>
      </div>

      <Panel title={t('st_prob')} note={t('st_prob_note')}>
        <div className="mb-3 grid max-w-xl grid-cols-3 gap-3">
          <NumberInput label={t('st_threshold')} value={threshold === '' ? String(th) : threshold} onChange={setThreshold} step={0.25} />
          <NumberInput label={t('st_from')} value={from === '' ? String(a) : from} onChange={setFrom} step={0.25} />
          <NumberInput label={t('st_to')} value={to === '' ? String(b) : to} onChange={setTo} step={0.25} />
        </div>
        <StatGrid cols="grid-cols-1 sm:grid-cols-3">
          {probs.map(({ label, p }) => (
            <Stat key={label} label={label} value={p ? f.pct(p.p * 100, 1) : '—'} hint={p ? t('st_of', { k: p.favourable, n: p.total }) : undefined} />
          ))}
        </StatGrid>
      </Panel>

      {kind === 'offers' && (
        <Panel title={t('st_rank')} flush>
          <div className="max-h-96 overflow-auto">
            <table className="data num">
              <thead><tr><th className="r">{t('st_position')}</th><th>{t('bank')}</th><th className="r">{t('rate')}</th><th className="r">{t('st_percentile')}</th></tr></thead>
              <tbody>
                {used.map((d, i) => (
                  <tr key={`${d.label}-${i}`}>
                    <td className="r">{ranks[i]}</td><td>{d.label}</td><td className="r">{f.pct(d.value)}</td>
                    <td className="r">{f.number(S.percentileRank(values, d.value), 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function OffersTab() {
  const { t, lang } = useI18n();
  const rates = useApi('rates');
  const [selection, setSelection] = useState(DEFAULT_SELECTION);
  return (
    <Loaded state={rates}>
      {({ rows }) => {
        const offers = selectOffers(rows, selection);
        // Loans sort ascending (cheapest first); rank table is highest-first.
        const data = [...offers].sort((a, b) => b.rate - a.rate).map((r) => ({
          label: selection.perBank ? r.bankName : `${r.bankName} · ${localize(lang, r.productName)}`, value: r.rate,
        }));
        const stale = offers.filter((r) => r.freshness !== 'fresh').length;
        return (
          <div className="space-y-4">
            <Panel>
              <SelectionControls value={selection} onChange={setSelection} />
              <p className="mt-3 text-xs text-ink-2">
                {t('offers_n', { n: offers.length })} · {t('banks_n', { n: new Set(offers.map((r) => r.bankSlug)).size })} · {t('source')}:{' '}
                {[...new Map(offers.map((r) => [r.bankName, r.sourceUrl]))].map(([name, url]) => (
                  <a key={name} className="mr-2 text-accent hover:underline" href={url} target="_blank" rel="noreferrer">{name}</a>
                ))}
              </p>
              {stale > 0 && <p className="mt-1 text-xs font-medium text-warn">▲ {stale} × {t('fresh_stale')} / {t('fresh_refresh_failed')}</p>}
            </Panel>
            <Analysis key={JSON.stringify(selection)} data={data} kind="offers" />
          </div>
        );
      }}
    </Loaded>
  );
}

const RANGES = { '12': 12, '36': 36, '60': 60, all: 10_000 } as const;
type Range = keyof typeof RANGES;

function useRangeOptions() {
  const { t } = useI18n();
  return (Object.keys(RANGES) as Range[]).map((v) => ({ value: v, label: t(`range_${v}`) }));
}

function SeriesTab() {
  const { t, f } = useI18n();
  const { state } = useOfficialSeries();
  const [key, setKey] = useState<SeriesKey>('dep_azn');
  const [range, setRange] = useState<Range>('36');
  const options = useRangeOptions();
  return (
    <Loaded state={state}>
      {({ series, rates, inflation }) => {
        const source = key === 'cpi' ? inflation.source : rates.source;
        const data = series[key].slice(-RANGES[range]).map((m) => ({ label: f.month(m.month), value: m.value }));
        return (
          <div className="space-y-4">
            <Panel>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label={t('st_series_pick')} value={key} onChange={setKey} options={SERIES_KEYS.map((k) => ({ value: k, label: t(`ser_${k}`) }))} />
                <Select label={t('st_range')} value={range} onChange={setRange} options={options} />
              </div>
              {source && <SourceLine name={source.name} url={source.url} verified={source.lastVerifiedAt} state={source.freshness as Freshness} />}
            </Panel>
            <Analysis key={`${key}-${range}`} data={data} kind="series" />
          </div>
        );
      }}
    </Loaded>
  );
}

function RelationsTab() {
  const { t, f } = useI18n();
  const { state } = useOfficialSeries();
  const [x, setX] = useState<SeriesKey>('cpi');
  const [y, setY] = useState<SeriesKey>('dep_azn');
  const [range, setRange] = useState<Range>('60');
  const [diff, setDiff] = useState(false);
  const options = useRangeOptions();
  const keys = SERIES_KEYS.map((k) => ({ value: k, label: t(`ser_${k}`) }));
  return (
    <Loaded state={state}>
      {({ series, rates, inflation }) => {
        const paired = align(series[x], series[y]).slice(-RANGES[range]);
        let xs = paired.map((p) => p.a);
        let ys = paired.map((p) => p.b);
        if (diff) [xs, ys] = [S.differences(xs), S.differences(ys)];
        const corr = S.correlation(xs, ys);
        const fit = S.linearRegression(xs, ys);
        const cov = S.covariance(xs, ys);
        const line = fit ? [Math.min(...xs), Math.max(...xs)].map((v) => ({ x: v, fit: fit.intercept + fit.slope * v })) : [];
        return (
          <div className="space-y-4">
            <Panel>
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label={t('st_corr_x')} value={x} onChange={setX} options={keys} />
                <Select label={t('st_corr_y')} value={y} onChange={setY} options={keys} />
                <Select label={t('st_range')} value={range} onChange={setRange} options={options} />
              </div>
              <div className="mt-3"><Check label={t('st_diff')} checked={diff} onChange={setDiff} /></div>
              {[rates.source, inflation.source].map((s) => s && <SourceLine key={s.key} name={s.name} url={s.url} verified={s.lastVerifiedAt} state={s.freshness} />)}
            </Panel>
            {corr && fit ? (
              <>
                <StatGrid cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
                  <Stat label={t('lab_covariance')} value={f.number(cov, 3)} />
                  <Stat label={t('st_corr_r')} value={f.number(corr.r, 3)} />
                  <Stat label={t('st_slope')} value={f.number(fit.slope, 3)} />
                  <Stat label={t('st_slope_se')} value={f.number(fit.slopeSe, 3)} />
                  <Stat label={t('st_intercept')} value={f.number(fit.intercept, 3)} />
                  <Stat label={t('st_r2')} value={f.number(fit.r2, 3)} />
                  <Stat label={t('st_pairs')} value={corr.n} />
                </StatGrid>
                <Panel title={t('st_relations')} note={t('st_corr_note')}>
                  <ScatterFit points={xs.map((v, i) => ({ x: v, y: ys[i]! }))} line={line} xLabel={t(`ser_${x}`)} yLabel={t(`ser_${y}`)} />
                </Panel>
              </>
            ) : <Notice tone="warn">{t('st_corr_need', { n: S.MIN_PAIRS })}</Notice>}
          </div>
        );
      }}
    </Loaded>
  );
}

function NotesTab() {
  const { t, f } = useI18n();
  const rates = useApi('rates');
  const { state } = useOfficialSeries();
  return (
    <Loaded state={rates}>
      {({ rows }) => (
        <Loaded state={state}>
          {({ series, rates: official, inflation }) => {
            const azn = selectOffers(rows, DEFAULT_SELECTION).map((r) => r.rate);
            const usd = selectOffers(rows, { ...DEFAULT_SELECTION, currency: 'USD' }).map((r) => r.rate);
            const s = S.describe(azn);
            const dep = series.dep_azn.at(-1);
            const loan = series.loan_azn.at(-1);
            const recent = series.dep_azn.slice(-36);
            const trend = S.linearRegression(recent.map((_, i) => i / 12), recent.map((m) => m.value));
            const real = exPostRealRates(
              series.dep_azn.map((m) => ({ month: m.month, rate: m.value })),
              series.cpi.map((m) => ({ month: m.month, yoy: m.value })),
            ).at(-1);
            const notes: { title: string; text: string }[] = [];
            if (azn.length >= 2) {
              notes.push({ title: t('note_disp_t'), text: t('note_disp', { n: s.n, min: f.number(s.min), max: f.number(s.max), median: f.number(s.median), mean: f.number(s.mean), sd: f.number(s.sdSample), cv: f.number((s.cv ?? 0) * 100, 1) }) });
            }
            if (azn.length && dep) {
              notes.push({ title: t('note_vs_t'), text: t('note_vs', { k: azn.filter((v) => v > dep.value).length, n: azn.length, avg: f.number(dep.value), month: f.month(dep.month) }) });
            }
            if (azn.length && usd.length) {
              notes.push({ title: t('note_fx_t'), text: t('note_fx', { azn: f.number(S.median(azn)), na: azn.length, usd: f.number(S.median(usd)), nu: usd.length, d: f.number(S.median(azn)! - S.median(usd)!) }) });
            }
            if (trend) notes.push({ title: t('note_trend_t'), text: t('note_trend', { n: trend.n, slope: f.number(trend.slope), r2: f.number(trend.r2) }) });
            if (real) {
              notes.push({ title: t('note_real_t'), text: t('note_real', { start: f.month(real.contractedIn), nominal: f.number(real.nominal), end: f.month(real.month), inflation: f.number(real.inflation), real: f.number(real.real) }) });
            }
            if (dep && loan && dep.month === loan.month) {
              notes.push({ title: t('note_spread_t'), text: t('note_spread', { month: f.month(dep.month), loan: f.number(loan.value), deposit: f.number(dep.value), spread: f.number(loan.value - dep.value) }) });
            }
            if (!notes.length) return <Panel><Empty>{t('no_data')}</Empty></Panel>;
            return (
              <Panel title={t('st_notes')}>
                <div className="prose-sm max-w-3xl space-y-4">
                  {notes.map((n) => (
                    <article key={n.title}><h3 className="mb-1 font-semibold">{n.title}</h3><p>{n.text}</p></article>
                  ))}
                </div>
                {[official.source, inflation.source].map((x) => x && <SourceLine key={x.key} name={x.name} url={x.url} verified={x.lastVerifiedAt} state={x.freshness} />)}
                {official.source?.latestPeriod && <p className="mt-1 text-xs text-ink-2">{t('inf_align_3')} ({f.month(referenceMonth(official.source.latestPeriod))})</p>}
              </Panel>
            );
          }}
        </Loaded>
      )}
    </Loaded>
  );
}

export default function StatisticsLab() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('offers');
  return (
    <>
      <PageHeader title={t('st_title')} subtitle={t('st_sub')}>
        <Segmented label={t('st_dataset')} value={tab} onChange={setTab}
          options={[{ value: 'offers', label: t('st_offers') }, { value: 'probability', label: t('lab_probability') }, { value: 'series', label: t('st_series') }, { value: 'relations', label: t('st_relations') }, { value: 'tests', label: t('lab_tests') }, { value: 'notes', label: t('st_notes') }]} />
      </PageHeader>
      {tab === 'offers' && <OffersTab />}
      {tab === 'probability' && <ProbabilityLab />}
      {tab === 'tests' && <TestsTab />}
      {tab === 'series' && <SeriesTab />}
      {tab === 'relations' && <RelationsTab />}
      {tab === 'notes' && <NotesTab />}
    </>
  );
}
