import { useI18n, type MessageKey } from '../i18n';
import { localize } from '../i18n/data';
import { reportTitle, type ReportType } from '../../shared/report';
import type { ChangeEvent } from '../../shared/types';

export function useEventText() {
  const { t, f, lang } = useI18n();
  return (e: Pick<ChangeEvent, 'kind' | 'details'>) => {
    const d = e.details as Record<string, string | number>;
    const product = localize(lang, String(d.productName ?? ''));
    if (e.kind === 'rate_change') return t('ev_rate_change', { bank: d.bankName!, product, from: f.number(Number(d.from)), to: f.number(Number(d.to)) });
    if (e.kind === 'indicator') return t('ev_indicator', { series: t(`ev_${d.series}` as MessageKey), value: f.number(Number(d.value)), period: String(d.period).slice(0, 7) });
    if (e.kind === 'report') return t('ev_report', { title: reportTitle(d.type as ReportType, lang), period: d.period! });
    return t(`ev_${e.kind}`, { bank: d.bankName!, product });
  };
}

export function EventList({ events }: { events: ChangeEvent[] }) {
  const { f } = useI18n();
  const text = useEventText();
  return (
    <ul className="space-y-1.5 text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3"><span className="num whitespace-nowrap text-xs text-ink-2">{f.date(e.createdAt)}</span><span>{text(e)}</span></li>
      ))}
    </ul>
  );
}
