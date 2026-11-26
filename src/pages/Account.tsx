import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type MessageKey } from '../i18n';
import { ApiError, request, useApi, useLive, type SessionUser } from '../lib/api';
import { Empty, Field, Loaded, Notice, PageHeader, Panel, Select } from '../components/ui';
import { useEventText } from '../components/events';
import type { ChangeEvent } from '../../shared/types';

const ALERTS = ['rate_change', 'new_product', 'conditions_change', 'indicator', 'report'] as const;

interface AccountData {
  items: { id: number; kind: string; label: string; payload: Record<string, unknown>; createdAt: string }[];
  subscriptions: { id: number; kind: ChangeEvent['kind']; bankSlug: string | null; currency: string | null }[];
  notifications: { id: number; read: boolean; kind: ChangeEvent['kind']; details: Record<string, unknown>; createdAt: string }[];
}

function useErrorText() {
  const { t } = useI18n();
  return (e: unknown) => {
    const code = e instanceof ApiError ? e.code : 'error';
    return ['invalid_credentials', 'email_unavailable', 'invalid_request', 'rate_limited'].includes(code) ? t(`acc_e_${code}` as MessageKey) : t('acc_e_other', { e: code });
  };
}

/** Where a saved item leads back to. */
function itemLink(item: AccountData['items'][number]) {
  if (item.kind === 'favorite') return `/banks/${encodeURIComponent(String(item.payload.bank ?? ''))}`;
  const path = item.kind === 'comparison' ? '/compare' : '/simulator';
  return `${path}?${new URLSearchParams(String(item.payload.query ?? '')).toString()}`;
}

function SignIn({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (action: 'login' | 'register') => {
    setError('');
    try {
      await request(`auth/${action}`, { method: 'POST', body: { email, password } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Panel className="max-w-md">
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void submit('login'); }}>
        <Field label={t('acc_email')}>{(id) => <input id={id} type="email" autoComplete="email" className="field" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label={t('acc_password')}>{(id) => <input id={id} type="password" autoComplete="current-password" className="field" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <div className="flex gap-2">
          <button className="btn btn-primary">{t('acc_login')}</button>
          <button type="button" className="btn" onClick={() => submit('register')}>{t('acc_register')}</button>
        </div>
        {error && <Notice tone="warn">{error}</Notice>}
        <p className="text-xs text-ink-2">{t('acc_privacy')}</p>
      </form>
    </Panel>
  );
}

function Preferences({ saved }: { saved: Record<string, unknown> }) {
  const { t, lang, setLang } = useI18n();
  const [message, setMessage] = useState('');
  // Apply once per sign-in; later manual switches are left alone.
  useEffect(() => {
    if (saved.lang === 'en' || saved.lang === 'az') setLang(saved.lang);
    if (saved.theme === 'light' || saved.theme === 'dark') window.dispatchEvent(new CustomEvent('azfi-theme', { detail: saved.theme }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    try {
      await request('account/preferences', { method: 'POST', body: { lang, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' } });
      setMessage(t('cmp_saved'));
    } catch (e) {
      setMessage(t('acc_e_other', { e: (e as Error).message }));
    }
  };
  return (
    <Panel title={t('acc_prefs')} note={t('acc_prefs_note')}>
      <button type="button" className="btn" onClick={save}>{t('acc_prefs_save')}</button>
      {message && <span role="status" className="ml-3 text-sm text-ink-2">{message}</span>}
    </Panel>
  );
}

function Dashboard({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const { t, f } = useI18n();
  const eventText = useEventText();
  const errorText = useErrorText();
  const account = useLive<AccountData>('account');
  const banks = useApi('banks');
  const [kind, setKind] = useState<(typeof ALERTS)[number]>('rate_change');
  const [bank, setBank] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const act = async (path: string, method: 'POST' | 'DELETE', body?: unknown, then?: () => void) => {
    setError('');
    try {
      await request(path, { method, body });
      (then ?? account.reload)();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const download = async () => {
    const data = await request('account/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'azfi-my-data.json' }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Panel actions={<button type="button" className="btn" onClick={() => act('auth/logout', 'POST', {}, onSignOut)}>{t('acc_logout')}</button>} title={t('acc_signed_in', { e: user.email })}>
        <button type="button" className="btn" onClick={download}>{t('acc_export')}</button>
      </Panel>
      {error && <Notice tone="warn">{error}</Notice>}
      <Preferences saved={user.preferences ?? {}} />
      <Loaded state={account}>
        {(data) => (
          <>
            <Panel title={t('acc_notifications')} actions={data.notifications.some((n) => !n.read) ? <button type="button" className="btn" onClick={() => act('account/notifications/read', 'POST', {})}>{t('acc_mark_read')}</button> : undefined}>
              {!data.notifications.length ? <p className="text-sm text-ink-2">{t('acc_no_notifications')}</p> : (
                <ul className="space-y-1.5 text-sm">
                  {data.notifications.map((n) => <li key={n.id} className={n.read ? 'text-ink-2' : 'font-medium'}><span className="num mr-3 text-xs">{f.date(n.createdAt)}</span>{eventText(n)}</li>)}
                </ul>
              )}
            </Panel>
            <Panel title={t('acc_alerts')}>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <div className="w-56"><Select label={t('acc_alert_type')} value={kind} onChange={setKind} options={ALERTS.map((a) => ({ value: a, label: t(`acc_a_${a}`) }))} /></div>
                <div className="w-56"><Select label={t('bank')} value={bank} onChange={setBank} options={[{ value: '', label: t('all') }, ...(banks.data?.banks.map((b) => ({ value: b.slug, label: b.name })) ?? [])]} /></div>
                <button type="button" className="btn" onClick={() => act('account/alerts', 'POST', { kind, bankSlug: bank && kind !== 'indicator' && kind !== 'report' ? bank : null })}>{t('acc_add_alert')}</button>
              </div>
              <ul className="space-y-1 text-sm">
                {data.subscriptions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3">
                    <span>{t(`acc_a_${s.kind}`)} · {banks.data?.banks.find((b) => b.slug === s.bankSlug)?.name ?? t('all')}</span>
                    <button type="button" className="link text-xs" onClick={() => act(`account/alerts/${s.id}`, 'DELETE')}>{t('acc_delete')}</button>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t('acc_saved')}>
              {!data.items.length ? <Empty>{t('acc_none_saved')}</Empty> : (
                <ul className="space-y-1 text-sm">
                  {data.items.map((i) => (
                    <li key={i.id} className="flex items-center gap-3">
                      <span className="badge">{i.kind}</span><span>{i.label}</span>
                      <Link className="link text-xs" to={itemLink(i)}>{t('acc_open')}</Link>
                      <button type="button" className="link text-xs" onClick={() => act(`account/items/${i.id}`, 'DELETE')}>{t('acc_delete')}</button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </Loaded>
      <Panel title={t('acc_delete_account')} note={t('acc_delete_confirm')}>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void act('account/delete', 'POST', { password }, onSignOut); }}>
          <div className="w-64"><Field label={t('acc_password')}>{(id) => <input id={id} type="password" autoComplete="current-password" className="field" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field></div>
          <button className="btn text-bad">{t('acc_delete_account')}</button>
        </form>
      </Panel>
    </div>
  );
}

export default function Account() {
  const { t } = useI18n();
  const me = useLive<{ user: SessionUser | null }>('auth/me');
  return (
    <>
      <PageHeader title={t('acc_title')} subtitle={t('acc_sub')} />
      <Loaded state={me}>{({ user }) => (user ? <Dashboard user={user} onSignOut={me.reload} /> : <SignIn onDone={me.reload} />)}</Loaded>
    </>
  );
}
