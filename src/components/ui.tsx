import { useId, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import type { Freshness, VerificationStatus } from '../../shared/types';
import type { ApiState } from '../lib/api';

export function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-ink-2">{subtitle}</p>
      </div>
      {children}
    </header>
  );
}

export function Panel({ title, note, actions, children, className = '', flush = false }: {
  title?: string; note?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-line bg-surface ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {note && <p className="mt-0.5 text-xs text-ink-2">{note}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="num mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

/** Hairline-separated strip of figures. */
export function StatGrid({ children, cols = 'grid-cols-2 lg:grid-cols-4' }: { children: ReactNode; cols?: string }) {
  return <div className={`grid gap-px overflow-hidden rounded-lg border border-line bg-line ${cols}`}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">{label}</label>
      {children(id)}
    </div>
  );
}

export function Select<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

export function NumberInput({ label, value, onChange, step = 'any', min, max }: {
  label: string; value: string; onChange: (v: string) => void; step?: number | 'any'; min?: number; max?: number;
}) {
  return (
    <Field label={label}>
      {(id) => <input id={id} className="field num" type="number" inputMode="decimal" value={value} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

export function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded px-3 py-1 text-sm font-medium ${o.value === value ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FRESH: Record<Freshness, [string, string]> = {
  fresh: ['text-good', '●'], stale: ['text-warn', '▲'], refresh_failed: ['text-warn', '!'], unavailable: ['text-bad', '✕'],
};

export function FreshnessBadge({ state }: { state: Freshness }) {
  const { t } = useI18n();
  const [color, icon] = FRESH[state];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${color}`}>
      <span aria-hidden>{icon}</span>{t(`fresh_${state}`)}
    </span>
  );
}

export function SourceLine({ name, url, verified, state }: { name: string; url: string; verified: string | null; state: Freshness }) {
  const { t, f, lang } = useI18n();
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
      <span>{t('source')}: <a className="text-accent underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer">{localize(lang, name)}</a></span>
      <span>· {t('verified')}: {f.dateTime(verified)}</span>
      <FreshnessBadge state={state} />
    </p>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div role={tone === 'warn' ? 'alert' : 'note'} className={`rounded-md border border-line border-l-4 bg-surface px-3 py-2 text-sm ${tone === 'warn' ? 'border-l-warn' : 'border-l-accent'}`}>
      {children}
    </div>
  );
}

/** Renders loading / error states; children only with data. */
export function Loaded<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  const { t } = useI18n();
  if (state.loading) return <div className="p-6 text-center text-ink-2" role="status">{t('loading')}</div>;
  if (state.error || !state.data) {
    return <Notice tone="warn">{state.error === 'database_not_configured' ? t('db_missing') : t('load_error', { error: state.error ?? '' })}</Notice>;
  }
  return <>{children(state.data)}</>;
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-8 text-center text-ink-2">{children}</div>;

/** Review state of an observation; plain auto-validated values need no badge. */
export function VerificationBadge({ state }: { state: VerificationStatus }) {
  const { t } = useI18n();
  if (state === 'auto_validated') return null;
  return <span className={`badge ${state === 'pending_review' || state === 'rejected' ? 'text-warn' : 'text-ink-2'}`}>{t(`v_${state}`)}</span>;
}
