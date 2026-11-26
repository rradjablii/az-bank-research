import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useApi } from '../lib/api';
import { Empty, Loaded, PageHeader, Panel } from '../components/ui';
import { reportTitle } from '../../shared/report';

export default function Research() {
  const { t, f, lang } = useI18n();
  const reports = useApi('reports');
  return (
    <>
      <PageHeader title={t('res_title')} subtitle={t('res_sub')} />
      <div className="space-y-4">
        <Loaded state={reports}>
          {({ reports: list }) => (
            <Panel flush>
              {!list.length ? <Empty>{t('res_none')}</Empty> : (
                <div className="overflow-x-auto">
                  <table className="data">
                    <thead><tr><th>{t('res_report')}</th><th>{t('res_period')}</th><th>{t('res_published')}</th><th>PDF</th></tr></thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.slug}>
                          <td className="min-w-56"><Link className="link font-medium" to={`/research/${r.slug}`}>{reportTitle(r.type, lang)}</Link></td>
                          <td className="num whitespace-nowrap">{r.period}</td>
                          <td className="num whitespace-nowrap">{f.dateTime(r.publishedAt)}</td>
                          <td><a className="link whitespace-nowrap" href={`/api/reports/${r.slug}/pdf?lang=${lang}`}>{t('res_pdf')}</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </Loaded>
        <Panel title={t('res_exports')} note={t('res_export_note')}>
          <div className="flex flex-wrap gap-2">
            {(['rates', 'market', 'inflation', 'policy'] as const).map((d) => <a key={d} className="btn" href={`/api/export/${d}`} download>{t(`res_ex_${d}`)}</a>)}
          </div>
        </Panel>
      </div>
    </>
  );
}
