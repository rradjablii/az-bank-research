import { useState } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { marketQuery, useApi } from '../lib/api';
import { Check, Empty, Loaded, Notice, NumberInput, Panel, Select, Stat, StatGrid } from './ui';
import { HistogramChart } from './charts';
import { DEFAULT_SELECTION, SelectionControls } from './SelectionControls';
import { selectOffers, type Selection } from '../../shared/selection';
import * as S from '../../shared/stats';
import { monthlyRates } from '../lib/series';
import { CURRENCIES, type Currency, type RateRow } from '../../shared/types';

const CONDITIONS = {
  term_long: (r: RateRow) => (r.termMin ?? 0) >= 18,
  term_short: (r: RateRow) => r.termMin !== null && r.termMin < 12,
  monthly: (r: RateRow) => r.payout === 'monthly',
  maturity: (r: RateRow) => r.payout === 'at_maturity',
} as const;

function Explain({ formula, interpretation, limits }: { formula: string; interpretation: string; limits: string }) {
  const { t } = useI18n();
  return (
    <Panel>
      <dl className="grid gap-3 text-sm md:grid-cols-3">
        <div><dt className="text-xs font-semibold text-ink-2">{t('lab_formula')}</dt><dd className="font-mono text-xs">{formula}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-2">{t('lab_interpretation')}</dt><dd>{interpretation}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-2">{t('lab_assumptions')}</dt><dd className="text-ink-2">{limits}</dd></div>
      </dl>
    </Panel>
  );
}

function Probability({ rows }: { rows: RateRow[] }) {
  const { t, f } = useI18n();
  const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION);
  const [threshold, setThreshold] = useState('10');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [given, setGiven] = useState<keyof typeof CONDITIONS>('term_long');
  const banks = [...new Map(rows.map((r) => [r.bankSlug, r.bankName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const group = rows.filter((r) => !excluded.includes(r.bankSlug));
  const offers = selectOffers(group, selection);
  const values = offers.map((r) => r.rate);
  const th = Number(threshold) || 0;
  const p = S.probAbove(values, th);
  const bins = S.histogram(values);
  const missing = new Set(group.filter((r) => r.productType === selection.productType).map((r) => r.bankSlug)).size - new Set(offers.map((r) => r.bankSlug)).size;

  // Conditional analysis uses every comparable rate row of the type and currency.
  const universe = group.filter(
    (r) => r.productType === selection.productType && r.currency === selection.currency && r.variant === 'standard' && r.verification !== 'pending_review' && r.verification !== 'rejected',
  );
  const conditional = S.conditionalProbability(universe, (r) => r.rate > th, CONDITIONS[given]);

  return (
    <div className="space-y-4">
      <Panel>
        <SelectionControls value={selection} onChange={setSelection} />
        <fieldset className="mt-3">
          <legend className="mb-1 text-xs font-medium text-ink-2">{t('lab_banks')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {banks.map(([slug, name]) => (
              <Check key={slug} label={name} checked={!excluded.includes(slug)} onChange={(on) => setExcluded(on ? excluded.filter((x) => x !== slug) : [...excluded, slug])} />
            ))}
          </div>
        </fieldset>
        <div className="mt-3 w-40"><NumberInput label={t('st_threshold')} value={threshold} onChange={setThreshold} step={0.25} /></div>
        <p className="mt-2 text-xs text-ink-2">{t('lab_sampling')}: {t(selection.perBank ? 'lab_sampling_bank' : 'lab_sampling_all')}</p>
        {missing > 0 && <p className="text-xs text-ink-2">{t('lab_missing', { n: missing })}</p>}
      </Panel>
      <section aria-live="polite">
        <h2 className="mb-2 text-sm font-semibold">{t('lab_question', { t: f.number(th) })}</h2>
        <StatGrid cols="grid-cols-3">
          <Stat label={t('lab_qualifying')} value={p?.total ?? 0} />
          <Stat label={t('lab_successes')} value={p?.favourable ?? 0} />
          <Stat label={t('lab_probability_v')} value={p ? f.pct(p.p * 100, 1) : '—'} />
        </StatGrid>
      </section>
      {p ? (
        <>
          <Panel title={t('st_hist')}><HistogramChart label={t('st_count')} data={bins.map((x) => ({ range: `${f.number(x.from, 1)}–${f.number(x.to, 1)}`, count: x.count }))} /></Panel>
          <Explain formula="P̂(rate > t) = #{xᵢ > t} / n" interpretation={t('lab_interpret', { n: p.total, k: p.favourable })} limits={t('st_prob_note')} />
        </>
      ) : <Panel><Empty>{t('no_data')}</Empty></Panel>}
      <Panel title={t('lab_conditional')} note={t('lab_cond_note')}>
        <div className="mb-2 w-72">
          <Select label={t('lab_given')} value={given} onChange={setGiven} options={(Object.keys(CONDITIONS) as (keyof typeof CONDITIONS)[]).map((k) => ({ value: k, label: t(`lab_g_${k}` as MessageKey) }))} />
        </div>
        <p className="text-sm">
          {conditional
            ? t('lab_cond_result', { t: f.number(th), p: f.pct(conditional.p * 100, 1), k: conditional.favourable, n: conditional.total, u: f.pct(conditional.unconditional * 100, 1) })
            : t('lab_cond_none')}
        </p>
        <p className="mt-1 font-mono text-xs text-ink-2">P(A | B) = #(A ∩ B) / #B</p>
      </Panel>
    </div>
  );
}

export function ProbabilityLab() {
  const rates = useApi('rates');
  return <Loaded state={rates}>{({ rows }) => <Probability rows={rows} />}</Loaded>;
}

function TwoSample({ title, a, b, labelA, labelB }: { title: string; a: number[]; b: number[]; labelA: string; labelB: string }) {
  const { t, f } = useI18n();
  const welch = S.welchT(a, b);
  const mw = S.mannWhitney(a, b);
  const p = (v: number) => (v < 0.001 ? '< 0.001' : f.number(v, 3));
  return (
    <Panel title={title} note={t('lab_h0')}>
      <p className="num mb-2 text-sm">{labelA}: n = {a.length}, {t('mean')} {f.pct(S.mean(a))} · {labelB}: n = {b.length}, {t('mean')} {f.pct(S.mean(b))}</p>
      {!welch && !mw ? <Notice tone="warn">{t('lab_need', { n: S.MIN_TEST_N })}</Notice> : (
        <table className="data num">
          <tbody>
            {welch && <tr><th scope="row">{t('lab_welch')}</th><td>t = {f.number(welch.t, 3)}, df = {f.number(welch.df, 1)}</td><td>{t('lab_p')} {p(welch.p)}</td><td className="text-xs">{t(welch.p < 0.05 ? 'lab_sig' : 'lab_notsig')}</td></tr>}
            {mw && <tr><th scope="row">{t('lab_mw')}</th><td>U = {f.number(mw.u, 1)}, z = {f.number(mw.z, 3)}</td><td>{t('lab_p')} {p(mw.p)}</td><td className="text-xs">{t(mw.p < 0.05 ? 'lab_sig' : 'lab_notsig')}</td></tr>}
          </tbody>
        </table>
      )}
      <p className="mt-2 font-mono text-xs text-ink-2">t = (x̄ₐ − x̄ᵦ) / √(sₐ²/nₐ + sᵦ²/nᵦ)</p>
    </Panel>
  );
}

export function TestsTab() {
  const { t, f } = useI18n();
  const rates = useApi('rates');
  const market = useApi('market', marketQuery('deposit_rate', 'new_business', { segment: 'total', bucket: 'all' }));
  const [groupA, setA] = useState<Currency>('AZN');
  const [groupB, setB] = useState<Currency>('USD');
  const [mu, setMu] = useState('9');
  const options = CURRENCIES.map((c) => ({ value: c, label: c }));
  return (
    <Loaded state={rates}>
      {({ rows }) => {
        const values = (currency: Currency) =>
          selectOffers(rows, { ...DEFAULT_SELECTION, currency, perBank: true }).map((r) => r.rate);
        const series = market.data ? monthlyRates(market.data.points, 'AZN').map((m) => m.value) : [];
        const one = S.oneSampleT(values(groupA), Number(mu));
        return (
          <div className="space-y-4">
            <Notice tone="warn">{t('lab_test_warning')}</Notice>
            <Panel>
              <div className="grid max-w-xl grid-cols-3 gap-3">
                <Select label={t('lab_group_a')} value={groupA} onChange={setA} options={options} />
                <Select label={t('lab_group_b')} value={groupB} onChange={setB} options={options} />
                <NumberInput label={t('lab_mu')} value={mu} onChange={setMu} step={0.25} />
              </div>
            </Panel>
            <TwoSample title={t('lab_test_groups')} a={values(groupA)} b={values(groupB)} labelA={groupA} labelB={groupB} />
            <Panel title={`${t('lab_onesample')} (${groupA})`}>
              {one ? <p className="num text-sm">t = {f.number(one.t, 3)}, df = {one.df}, {t('lab_p')} {f.number(one.p, 3)} — {t(one.p < 0.05 ? 'lab_sig' : 'lab_notsig')}</p> : <Notice tone="warn">{t('lab_need', { n: S.MIN_TEST_N })}</Notice>}
              <p className="mt-2 font-mono text-xs text-ink-2">t = (x̄ − μ₀) / (s / √n)</p>
            </Panel>
            <TwoSample title={t('lab_group_official')} a={series.slice(-12)} b={series.slice(-24, -12)} labelA={t('range_12')} labelB="−12" />
          </div>
        );
      }}
    </Loaded>
  );
}
