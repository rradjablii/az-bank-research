import { useState, type FormEvent } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { request, useApi } from '../lib/api';
import { Check, Field, Notice, PageHeader, Panel } from '../components/ui';
import type { AssistantAnswer } from '../../server/ai/assistant';

const EXAMPLES: MessageKey[] = ['ai_ex1', 'ai_ex2', 'ai_ex3', 'ai_ex4', 'ai_ex5'];

export default function Assistant() {
  const { t, f, lang } = useI18n();
  const status = useApi('aiStatus');
  const [question, setQuestion] = useState('');
  const [student, setStudent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState('');

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      setAnswer(await request<AssistantAnswer>('ai/ask', { method: 'POST', body: { question, lang, student } }));
    } catch (err) {
      setError(t('load_error', { error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  const notice = (code: string) => t(code === 'refused' ? 'ai_n_refused' : code === 'daily_limit' ? 'ai_n_daily_limit' : code === 'no_provider' ? 'ai_off' : 'ai_n_other');

  return (
    <>
      <PageHeader title={t('ai_title')} subtitle={t('ai_sub')} />
      <div className="max-w-4xl space-y-4">
        {status.data && !status.data.enabled && <Notice>{t('ai_off')}</Notice>}
        <Panel>
          <form onSubmit={ask} className="space-y-3">
            <Field label={t('ai_question')}>
              {(id) => <textarea id={id} className="field !h-20 py-2" required minLength={5} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} />}
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Check label={t('ai_student')} checked={student} onChange={setStudent} />
              <button className="btn btn-primary" disabled={busy}>{busy ? t('ai_thinking') : t('ai_ask')}</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((k) => <button key={k} type="button" className="badge !whitespace-normal text-left hover:bg-surface-2" onClick={() => setQuestion(t(k))}>{t(k)}</button>)}
            </div>
            {status.data?.enabled && <p className="text-xs text-ink-2">{t('ai_privacy')}</p>}
          </form>
        </Panel>
        {error && <Notice tone="warn">{error}</Notice>}
        {answer && (
          <div aria-live="polite" className="space-y-4">
            {answer.notice && <Notice tone="warn">{notice(answer.notice)}</Notice>}
            {answer.insufficient && <Notice tone="warn">{t('ai_insufficient')}</Notice>}
            {answer.withheld > 0 && <Notice tone="warn">{t('ai_withheld', { n: answer.withheld })}</Notice>}
            {answer.statements.length > 0 && (
              <Panel title={answer.mode === 'ai_draft' ? t('ai_draft') : t('ai_evidence_only')} note={answer.model ?? undefined}>
                <ul className="space-y-2.5">
                  {answer.statements.map((s, i) => (
                    <li key={i}>
                      <span className="badge mr-2">{t(`ai_k_${s.kind}`)}</span>
                      {s.text}{' '}
                      {s.citations.map((c) => <a key={c} href={`#${c}`} className="link text-xs">[{c}] </a>)}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {answer.evidence.length > 0 && (
              <Panel title={t('ai_evidence')}>
                <ol className="space-y-2.5 text-sm">
                  {answer.evidence.map((e) => (
                    <li key={e.id} id={e.id}>
                      <strong>[{e.id}]</strong> {e.text}
                      <div className="text-xs text-ink-2">
                        {t('ai_dated', { d: f.date(e.date) })} ·{' '}
                        {[...new Set(e.sources.map((s) => s.name))].map((name) => (
                          <span key={name} className="mr-2">
                            {e.sources.filter((s) => s.name === name).map((s, i) => (
                              <a key={s.url} className="link mr-0.5" href={s.url} target="_blank" rel="noreferrer">{i === 0 ? name : `[${i + 1}]`}</a>
                            ))}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </div>
        )}
      </div>
    </>
  );
}
