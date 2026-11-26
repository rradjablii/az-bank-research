import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { clearApiCache, request, useLive } from '../lib/api';
import { Check, Empty, Field, FreshnessBadge, Loaded, Notice, PageHeader, Panel, Select, VerificationBadge } from '../components/ui';
import { REPORT_TYPES, reportTitle, type ReportType } from '../../shared/report';
import type { overview, observations, rejectedRecords, rawRecords, auditLog } from '../../server/admin';

type Overview = Awaited<ReturnType<typeof overview>>;
type Observation = Awaited<ReturnType<typeof observations>>[number];

function Pager({ page, setPage, full }: { page: number; setPage: (n: number) => void; full: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2 text-xs">
      <button type="button" className="btn" disabled={page === 1} onClick={() => setPage(page - 1)}>{t('adm_prev_page')}</button>
      <span className="num">{page}</span>
      <button type="button" className="btn" disabled={!full} onClick={() => setPage(page + 1)}>{t('adm_next_page')}</button>
    </div>
  );
}

function Review({ secret, onChanged }: { secret?: string; onChanged: () => void }) {
  const { t, f, lang } = useI18n();
  const [status, setStatus] = useState('pending_review');
  const [bank, setBank] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Observation | null>(null);
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const query = new URLSearchParams({ page: String(page), ...(status ? { status } : {}), ...(bank ? { bank } : {}) });
  const list = useLive<{ observations: Observation[] }>(`admin/observations?${query}`, secret);
  const banks = useLive<{ banks: { slug: string; name: string }[] }>('banks');

  const submit = async (action: 'approve' | 'reject' | 'correct') => {
    try {
      await request(`admin/observations/${target!.id}/review`, { method: 'POST', secret, body: { action, note, ...(action === 'correct' ? { rate: Number(rate) } : {}) } });
      setTarget(null);
      setNote('');
      setRate('');
      setMessage(t('adm_done'));
      clearApiCache();
      list.reload();
      onChanged();
    } catch (e) {
      setMessage(t('load_error', { error: (e as Error).message }));
    }
  };

  return (
    <Panel title={t('adm_observations')} flush>
      <div className="flex flex-wrap gap-3 p-3">
        <div className="w-56"><Select label={t('adm_filter_status')} value={status} onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: '', label: t('all') }, ...(['pending_review', 'auto_validated', 'approved', 'corrected', 'rejected'] as const).map((v) => ({ value: v as string, label: t(`v_${v}`) }))]} /></div>
        <div className="w-56"><Select label={t('adm_filter_bank')} value={bank} onChange={(v) => { setBank(v); setPage(1); }} options={[{ value: '', label: t('all') }, ...(banks.data?.banks.map((b) => ({ value: b.slug, label: b.name })) ?? [])]} /></div>
      </div>
      {message && <div className="px-3 pb-2"><Notice>{message}</Notice></div>}
      {target && (
        <form className="border-y border-line bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); void submit('approve'); }}>
          <p className="mb-2 text-sm font-medium">{target.bankName} · {localize(lang, target.productName)} · {target.currency} · {target.termMin ?? '—'} · {f.pct(target.rate)}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1"><Field label={t('adm_note')}>{(id) => <input id={id} className="field" required minLength={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field></div>
            <button className="btn" disabled={note.trim().length < 3}>{t('adm_approve')}</button>
            <button type="button" className="btn" disabled={note.trim().length < 3} onClick={() => submit('reject')}>{t('adm_reject')}</button>
            <div className="w-36"><Field label={t('adm_new_rate')}>{(id) => <input id={id} type="number" step="0.01" min="0.01" className="field num" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field></div>
            <button type="button" className="btn" disabled={note.trim().length < 3 || !(Number(rate) > 0)} onClick={() => submit('correct')}>{t('adm_correct')}</button>
          </div>
        </form>
      )}
      <Loaded state={list}>
        {({ observations: rows }) => (
          <>
            {!rows.length ? <Empty>{t('adm_empty')}</Empty> : (
              <div className="overflow-x-auto">
                <table className="data text-xs">
                  <thead><tr><th>{t('bank')}</th><th>{t('product')}</th><th>{t('currency')}</th><th>{t('term')}</th><th className="r">{t('adm_previous')}</th><th className="r">{t('adm_rate')}</th><th className="r">{t('adm_source_value')}</th><th>{t('status')}</th><th><span className="sr-only">{t('adm_review')}</span></th></tr></thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.id}>
                        <td>{o.bankName}</td><td><a className="link" href={o.sourceUrl} target="_blank" rel="noreferrer">{localize(lang, o.productName)}</a></td><td>{o.currency}</td><td className="num">{o.termMin ?? '—'}</td>
                        <td className="r num">{f.pct(o.previous)}</td><td className="r num font-semibold">{f.pct(o.rate)}</td><td className="r num">{f.pct(o.sourceRate)}</td>
                        <td><VerificationBadge state={o.verification as 'approved'} />{o.verification === 'auto_validated' && t('v_auto_validated')}</td>
                        <td><button type="button" className="link" onClick={() => { setTarget(o); setMessage(''); }}>{t('adm_review')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager page={page} setPage={setPage} full={rows.length === 20} />
          </>
        )}
      </Loaded>
    </Panel>
  );
}

function Raw({ source, secret }: { source: string; secret?: string }) {
  const { t, f } = useI18n();
  const raw = useLive<{ records: Awaited<ReturnType<typeof rawRecords>> }>(`admin/raw/${source}`, secret);
  return (
    <Panel title={`${t('adm_inspect')} — ${source}`}>
      <Loaded state={raw}>
        {({ records }) => !records.length ? <Empty>{t('adm_empty')}</Empty> : (
          <div className="space-y-2">
            {records.map((r) => (
              <details key={r.id} className="text-xs">
                <summary className="cursor-pointer">#{r.id} · {f.dateTime(r.collectedAt)} · <span className="break-all">{r.sourceUrl}</span></summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2">{r.payload}{r.truncated ? ' …' : ''}</pre>
              </details>
            ))}
          </div>
        )}
      </Loaded>
    </Panel>
  );
}

function Center({ secret }: { secret?: string }) {
  const { t, f, lang } = useI18n();
  const sources = useLive<{ sources: Overview }>('admin/overview', secret);
  const rejected = useLive<{ records: Awaited<ReturnType<typeof rejectedRecords>> }>('admin/rejected', secret);
  const audit = useLive<{ entries: Awaited<ReturnType<typeof auditLog>> }>('admin/audit', secret);
  const [inspect, setInspect] = useState('');
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState<ReportType>('monthly');

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await work());
      clearApiCache();
      sources.reload();
      rejected.reload();
    } catch (e) {
      setMessage(t('me_refresh_fail', { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  const refresh = (keys?: string[]) =>
    run(async () => {
      const { results } = await request<{ results: { key: string; status: string }[] }>('admin/refresh', { method: 'POST', secret, body: { force: force || !!keys, ...(keys ? { sources: keys } : {}) } });
      return `${t('me_done')}: ${results.map((r) => `${r.key} ${r.status}`).join(', ')}`;
    });

  return (
    <Loaded state={sources}>
      {({ sources: list }) => (
        <div className="space-y-4">
          <Panel>
            <div className="flex flex-wrap items-end gap-3">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => refresh()}>{busy ? t('me_running') : t('me_run')}</button>
              <div className="flex h-9 items-center"><Check label={t('me_force')} checked={force} onChange={setForce} /></div>
              <div className="ml-auto w-72"><Select label={t('res_report')} value={type} onChange={setType} options={REPORT_TYPES.map((v) => ({ value: v, label: reportTitle(v, lang) }))} /></div>
              <button type="button" className="btn" disabled={busy} onClick={() => run(async () => {
                const r = await request<{ slug: string; created: boolean }>('admin/reports', { method: 'POST', secret, body: { type } });
                return t('adm_published', { s: r.slug, c: r.created ? t('adm_new') : t('adm_exists') });
              })}>{t('adm_publish')}</button>
            </div>
            {message && <div className="mt-3"><Notice>{message}</Notice></div>}
          </Panel>
          <Panel title={t('adm_sources')} note={t('adm_conf_note')} flush>
            <div className="overflow-x-auto">
              <table className="data text-xs">
                <thead><tr><th className="sticky left-0 bg-surface">{t('source')}</th><th>{t('status')}</th><th>{t('verified')}</th><th className="r">{t('adm_records')}</th><th className="r">{t('adm_raw')}</th><th className="r">{t('adm_dup')}</th><th className="r">{t('adm_invalid')}</th><th className="r">{t('adm_pending')}</th><th className="r">{t('adm_failures')}</th><th>{t('adm_since')}</th><th className="r">{t('adm_confidence')}</th><th>{t('adm_last_error')}</th><th /></tr></thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.key}>
                      <th scope="row" className="sticky left-0 whitespace-nowrap bg-surface !font-medium !text-ink">{s.key}</th><td><FreshnessBadge state={s.freshness} /></td><td className="num whitespace-nowrap">{f.dateTime(s.lastVerifiedAt)}</td>
                      <td className="r num">{s.recordCount}</td><td className="r num">{s.raw}</td><td className="r num">{s.duplicates}</td><td className="r num">{s.invalid}</td>
                      <td className="r num">{s.pending}</td><td className="r num">{s.failures} ({s.consecutiveFailures})</td><td className="num whitespace-nowrap">{f.date(s.coverageFrom)}</td>
                      <td className="r num">{f.number(s.confidence, 0)}</td>
                      <td className="min-w-48 break-words text-ink-2">{s.lastError}</td>
                      <td className="whitespace-nowrap">
                        {s.accessStatus === 'active' && <button type="button" className="link mr-2" disabled={busy} onClick={() => refresh([s.key])}>{t('me_run')}</button>}
                        <button type="button" className="link" onClick={() => setInspect(s.key)}>{t('adm_inspect')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {inspect && <Raw key={inspect} source={inspect} secret={secret} />}
          <Review secret={secret} onChanged={() => { sources.reload(); audit.reload(); }} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title={t('adm_rejected')} flush>
              <Loaded state={rejected}>
                {({ records }) => !records.length ? <Empty>{t('adm_empty')}</Empty> : (
                  <div className="max-h-80 overflow-auto">
                    <table className="data text-xs">
                      <thead><tr><th>{t('source')}</th><th>{t('adm_reason')}</th><th>{t('adm_records')}</th></tr></thead>
                      <tbody>{records.map((r) => <tr key={r.id}><td>{r.sourceKey}</td><td>{r.reason}</td><td className="max-w-xs break-all font-mono">{JSON.stringify(r.payload).slice(0, 200)}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </Loaded>
            </Panel>
            <Panel title={t('adm_audit')} flush>
              <Loaded state={audit}>
                {({ entries }) => !entries.length ? <Empty>{t('adm_empty')}</Empty> : (
                  <div className="max-h-80 overflow-auto">
                    <table className="data text-xs">
                      <thead><tr><th>{t('tr_date')}</th><th>{t('adm_actor')}</th><th>{t('adm_action')}</th><th>{t('adm_rate')}</th><th>{t('adm_reason')}</th></tr></thead>
                      <tbody>
                        {entries.map((e) => (
                          <tr key={e.id}><td className="num whitespace-nowrap">{f.dateTime(e.createdAt)}</td><td>{e.actor}</td><td>{e.action} #{e.entityId}</td><td className="num">{f.number((e.before as { rate: number }).rate)} → {f.number((e.after as { rate: number }).rate)}</td><td>{e.note}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Loaded>
            </Panel>
          </div>
        </div>
      )}
    </Loaded>
  );
}

export default function Admin() {
  const { t } = useI18n();
  const me = useLive<{ user: { role: string } | null }>('auth/me');
  const [input, setInput] = useState('');
  // The secret lives only in component memory.
  const [secret, setSecret] = useState('');
  const asRole = me.data?.user?.role === 'admin';
  const unlock = (e: FormEvent) => {
    e.preventDefault();
    setSecret(input);
  };
  return (
    <>
      <PageHeader title={t('adm_title')} subtitle={t('adm_sub')} />
      {asRole ? <Center /> : secret ? <Center key={secret} secret={secret} /> : (
        <Panel className="max-w-lg">
          <p className="mb-3 text-sm text-ink-2">{t('adm_need')}</p>
          <form onSubmit={unlock} className="flex flex-wrap items-end gap-3">
            <div className="w-72"><Field label={t('me_secret')}>{(id) => <input id={id} type="password" autoComplete="off" className="field" required value={input} onChange={(e) => setInput(e.target.value)} />}</Field></div>
            <button className="btn btn-primary">{t('adm_unlock')}</button>
          </form>
        </Panel>
      )}
    </>
  );
}
