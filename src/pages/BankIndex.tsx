import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type MessageKey } from '../i18n';
import { useApi, type Responses } from '../lib/api';
import { Empty, Loaded, Notice, PageHeader, Panel } from '../components/ui';
import {
  COMPONENTS, DEFAULT_WEIGHTS, METHODOLOGY_VERSION, computeIndex, reweight, sensitivity, type BankScore, type Component, type Weights,
} from '../../shared/index-score';

function useExplain() {
  const { t, f } = useI18n();
  return (component: Component, r: BankScore['components'][Component]) => {
    const i = r.inputs;
    if (component === 'stability') return r.score === null ? t('ix_e_stability', i as Record<string, number>) : t('ix_e_stability_ok', i as Record<string, number>);
    if (component === 'flexibility') return r.score === null ? t('ix_e_flexibility_none') : t('ix_e_flexibility', { documentedProducts: i.documentedProducts!, partialWithdrawal: i.partialWithdrawal === 'yes' ? t('t_yes') : t('t_unknown') });
    if (r.score === null) return t('ix_e_none');
    if (component === 'transparency') {
      const list = (v: string) => Object.entries(i).filter(([, x]) => x === v).map(([k]) => t(`ix_k_${k}` as MessageKey)).join(', ') || '—';
      return t('ix_e_transparency', { found: list('found'), missing: list('not found') });
    }
    if (component === 'realReturn') return t('ix_e_realReturn', { rate: f.number(Number(i.rate)), inflation: f.number(Number(i.inflation)), real: f.number(Number(i.real)) });
    return t('ix_e_competitiveness', { segments: i.segments!, example: i.example!, exampleRate: f.number(Number(i.exampleRate)) });
  };
}

function Index({ data }: { data: Responses['index'] }) {
  const { t, f } = useI18n();
  const explain = useExplain();
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [open, setOpen] = useState<string | null>(null);
  const base = useMemo(() => computeIndex(data), [data]);
  const scores = useMemo(() => reweight(base, weights), [base, weights]);
  const ranges = useMemo(() => sensitivity(base), [base]);
  const dates = [...new Set(data.scoreHistory.map((h) => h.date))];
  const custom = COMPONENTS.some((c) => weights[c] !== DEFAULT_WEIGHTS[c]);
  if (!scores.length) return <Panel><Empty>{t('no_data_yet')}</Empty></Panel>;

  return (
    <div className="space-y-4">
      <Panel title={t('ix_method', { v: METHODOLOGY_VERSION })} flush>
        <div className="max-h-[36rem] overflow-auto">
          <table className="data">
            <thead>
              <tr>
                <th className="r">#</th><th>{t('bank')}</th><th className="r">{t('ix_score')}</th>
                {COMPONENTS.map((c) => <th key={c} className="r !whitespace-normal">{t(`ix_c_${c}`)} ({weights[c]})</th>)}
                <th className="r">{t('ix_coverage')}</th><th>{t('ix_status')}</th><th className="r !whitespace-normal">{t('ix_range')}</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => (
                <tr key={s.bankSlug}>
                  <td className="r num">{s.score === null ? '—' : i + 1}</td>
                  <td className="whitespace-nowrap">
                    <button type="button" className="link font-medium" aria-expanded={open === s.bankSlug} onClick={() => setOpen(open === s.bankSlug ? null : s.bankSlug)}>{s.bankName}</button>
                  </td>
                  <td className="r num text-base font-semibold">{f.number(s.score, 1)}</td>
                  {COMPONENTS.map((c) => <td key={c} className="r num">{f.number(s.components[c].score, 0)}</td>)}
                  <td className="r num">{f.pct(s.coverage * 100, 0)}</td>
                  <td><span className={`badge ${s.score === null || s.provisional ? 'text-warn' : 'text-good'}`}>{s.score === null ? t('ix_not_scored') : s.provisional ? t('ix_provisional') : t('ix_full')}</span></td>
                  <td className="r num">{ranges.get(s.bankSlug) ? `${ranges.get(s.bankSlug)!.best}–${ranges.get(s.bankSlug)!.worst}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {scores.filter((s) => s.bankSlug === open).map((s) => (
        <Panel key={s.bankSlug} title={s.bankName} actions={<Link className="link text-sm" to={`/banks/${s.bankSlug}`}>{t('ix_observations')} →</Link>} flush>
          <table className="data">
            <tbody>
              {COMPONENTS.map((c) => (
                <tr key={c}><th scope="row">{t(`ix_c_${c}`)}</th><td className="r num font-semibold">{f.number(s.components[c].score, 1)}</td><td className="text-sm">{explain(c, s.components[c])}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t('ix_weights')} actions={custom ? <button type="button" className="btn" onClick={() => setWeights(DEFAULT_WEIGHTS)}>{t('ix_reset')}</button> : undefined}>
          <div className="space-y-2">
            {COMPONENTS.map((c) => (
              <label key={c} className="grid grid-cols-[minmax(0,1fr)_2fr_3rem] items-center gap-3 text-sm">
                <span>{t(`ix_c_${c}`)}</span>
                <input type="range" min={0} max={60} step={5} value={weights[c]} onChange={(e) => setWeights({ ...weights, [c]: Number(e.target.value) })} className="accent-[var(--accent)]" />
                <span className="num text-right">{weights[c]}</span>
              </label>
            ))}
          </div>
        </Panel>
        <Panel title={t('ix_history')} note={t('ix_history_one', { n: dates.length })} flush>
          <div className="max-h-72 overflow-auto">
            <table className="data num text-xs">
              <thead><tr><th>{t('tr_date')}</th><th>{t('bank')}</th><th className="r">{t('ix_score')}</th><th className="r">{t('ix_coverage')}</th></tr></thead>
              <tbody>
                {[...data.scoreHistory].reverse().slice(0, 200).map((h) => (
                  <tr key={`${h.date}-${h.bankSlug}`}><td>{f.date(h.date)}</td><td>{base.find((b) => b.bankSlug === h.bankSlug)?.bankName ?? h.bankSlug}</td><td className="r">{f.number(h.score, 1)}</td><td className="r">{f.pct(h.coverage * 100, 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel title={t('ix_method', { v: METHODOLOGY_VERSION })}>
        <dl className="max-w-3xl space-y-2 text-sm">
          {COMPONENTS.map((c) => (
            <div key={c}><dt className="font-semibold">{t(`ix_c_${c}`)} — {DEFAULT_WEIGHTS[c]}%</dt><dd className="text-ink-2">{t(`ix_m_${c}`)}</dd></div>
          ))}
        </dl>
        <p className="mt-3 max-w-3xl text-sm text-ink-2">{t('ix_min_cov')}</p>
      </Panel>
    </div>
  );
}

export default function BankIndex() {
  const { t } = useI18n();
  const state = useApi('index');
  return (
    <>
      <PageHeader title={t('ix_title')} subtitle={t('ix_sub')} />
      <div className="mb-4"><Notice tone="warn">{t('ix_warning')}</Notice></div>
      <Loaded state={state}>{(data) => <Index data={data} />}</Loaded>
    </>
  );
}
