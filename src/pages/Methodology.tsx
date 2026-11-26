import { useState, type FormEvent } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { localize } from '../i18n/data';
import { clearApiCache, useApi } from '../lib/api';
import { Check, Field, FreshnessBadge, Loaded, Notice, PageHeader, Panel } from '../components/ui';

const FORMULAS: [string, string][] = [
  ['x̄', 'Σxᵢ / n'],
  ['σ²  /  s²', 'Σ(xᵢ − x̄)² / n   /   Σ(xᵢ − x̄)² / (n − 1)'],
  ['CV', 's / |x̄|'],
  ['Qₚ', 'h = (n − 1)p;  x₍⌊h⌋₎ + (h − ⌊h⌋)(x₍⌈h⌉₎ − x₍⌊h⌋₎)'],
  ['P̂(A)', '#{xᵢ ∈ A} / n'],
  ['95% CI', 'x̄ ± t₀.₉₇₅,ₙ₋₁ · s / √n'],
  ['r', 'Sxy / √(Sxx · Syy),  n ≥ 8'],
  ['OLS', 'b = Sxy / Sxx;  a = ȳ − b·x̄;  R² = 1 − SSE / SST'],
  ['method_at_maturity', 'I = P · r · m / 12'],
  ['method_compound', 'A = P · (1 + r / k)^(k · m / 12)'],
  ['series_real', '(1 + i) / (1 + π) − 1'],
];

function Confidence() {
  const { t, f, lang } = useI18n();
  const state = useApi('confidence');
  return (
    <Loaded state={state}>
      {({ sources }) => (
        <Panel title={t('me_confidence')} note={t('adm_conf_note')} flush>
          <div className="max-h-96 overflow-auto">
            <table className="data num">
              <thead><tr><th>{t('source')}</th><th className="r">{t('adm_confidence')}</th></tr></thead>
              <tbody>{sources.map((s) => <tr key={s.key}><td>{localize(lang, s.publisher)}</td><td className="r">{f.number(s.score, 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </Loaded>
  );
}

function Refresh({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [secret, setSecret] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // The secret stays in component memory: never stored, never put in a URL.
      const res = await fetch('/api/admin/refresh', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) setMessage({ tone: 'warn', text: t('me_unauth') });
      else if (!res.ok) setMessage({ tone: 'warn', text: t('me_refresh_fail', { error: body.error ?? res.status }) });
      else {
        const results = body.results as { key: string; status: string; inserted: number; unchanged: number }[];
        setMessage({ tone: 'info', text: `${t('me_done')}: ${results.map((r) => `${r.key} ${r.status}`).join(', ')}` });
        clearApiCache();
        onDone();
      }
    } catch (err) {
      setMessage({ tone: 'warn', text: t('me_refresh_fail', { error: (err as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('me_refresh')}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <Field label={t('me_secret')}>{(id) => <input id={id} type="password" autoComplete="off" className="field" value={secret} onChange={(e) => setSecret(e.target.value)} required />}</Field>
        </div>
        <div className="flex h-9 items-center"><Check label={t('me_force')} checked={force} onChange={setForce} /></div>
        <button className="btn btn-primary" disabled={busy}>{busy ? t('me_running') : t('me_run')}</button>
      </form>
      {message && <div className="mt-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
    </Panel>
  );
}

function Sources() {
  const { t, f, lang } = useI18n();
  const meta = useApi('meta');
  const logs = useApi('logs');
  return (
    <>
      <Loaded state={meta}>
        {({ sources }) => (
          <Panel title={t('me_sources')} flush>
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>{t('source')}</th><th>{t('me_format')}</th><th>{t('me_frequency')}</th><th>{t('status')}</th><th>{t('verified')}</th><th className="r">{t('records')}</th><th>{t('me_note')}</th></tr></thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.key}>
                      <td className="min-w-56"><a className="text-accent hover:underline" href={s.url} target="_blank" rel="noreferrer">{localize(lang, s.name)}</a><div className="text-xs text-ink-2">{localize(lang, s.publisher)}</div></td>
                      <td>{s.format}</td>
                      <td>{localize(lang, s.updateFrequency)}</td>
                      <td><FreshnessBadge state={s.freshness} /></td>
                      <td className="num whitespace-nowrap text-xs">{f.dateTime(s.lastVerifiedAt)}</td>
                      <td className="r num">{s.recordCount}</td>
                      <td className="min-w-64 text-xs text-ink-2">{localize(lang, s.accessNote)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </Loaded>
      <Loaded state={logs}>
        {({ logs: entries }) => (
          <Panel title={t('me_log')} flush>
            <div className="max-h-96 overflow-auto">
              <table className="data num text-xs">
                <thead className="sticky top-0 bg-surface"><tr><th>{t('me_started')}</th><th>{t('source')}</th><th>{t('me_trigger')}</th><th>{t('me_result')}</th><th className="r">{t('me_new')}</th><th className="r">{t('me_same')}</th><th className="r">{t('me_rejected')}</th><th>{t('me_message')}</th></tr></thead>
                <tbody>
                  {entries.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{f.dateTime(l.startedAt)}</td><td>{l.sourceKey}</td><td>{l.trigger}</td><td>{l.status}</td>
                      <td className="r">{l.inserted}</td><td className="r">{l.unchanged}</td><td className="r">{l.rejected}</td>
                      <td className="min-w-64 break-words text-ink-2">{l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </Loaded>
    </>
  );
}

export default function Methodology() {
  const { t } = useI18n();
  const [version, setVersion] = useState(0);
  const lists = [
    { title: t('me_process'), items: [t('me_p1'), t('me_p2'), t('me_p3'), t('me_p4')] },
    { title: t('me_compare'), items: [t('me_c1'), t('me_c2'), t('me_c3'), t('me_c4')] },
    { title: t('me_limits'), items: [t('me_l1'), t('me_l2'), t('me_l3'), t('me_l4'), t('me_l5'), t('me_l6')] },
    { title: t('inf_align_t'), items: [t('inf_align_2'), t('inf_align_3'), t('sim_tax_note'), t('sim_daycount')] },
  ];
  return (
    <>
      <PageHeader title={t('me_title')} subtitle={t('me_sub')} />
      <div className="space-y-4">
        <Sources key={version} />
        <Confidence />
        <div className="grid gap-4 lg:grid-cols-2">
          {lists.map((l) => (
            <Panel key={l.title} title={l.title}><div className="prose-sm"><ul>{l.items.map((i) => <li key={i}>{i}</li>)}</ul></div></Panel>
          ))}
        </div>
        <Panel title={t('me_formulas')} flush>
          <div className="overflow-x-auto">
            <table className="data"><tbody>{FORMULAS.map(([name, formula]) => <tr key={name}><td className="whitespace-nowrap font-medium">{name.includes('_') ? t(name as MessageKey) : name}</td><td className="font-mono text-xs">{formula}</td></tr>)}</tbody></table>
          </div>
        </Panel>
        <Refresh onDone={() => setVersion((v) => v + 1)} />
      </div>
    </>
  );
}
