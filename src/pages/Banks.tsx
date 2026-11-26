import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { localize } from '../i18n/data';
import { useApi } from '../lib/api';
import { FreshnessBadge, Loaded, PageHeader, Panel, Empty } from '../components/ui';

export default function Banks() {
  const { t, f, lang } = useI18n();
  const banks = useApi('banks');
  const rates = useApi('rates');
  return (
    <>
      <PageHeader title={t('banks_title')} subtitle={t('banks_sub')} />
      <Loaded state={banks}>
        {({ banks: list }) => (
          <Panel flush>
            {!list.length ? <Empty>{t('no_data_yet')}</Empty> : (
              <div className="overflow-x-auto">
                <table className="data">
                  <thead><tr><th>{t('bank')}</th><th>{t('banks_currencies')}</th><th className="r">{t('records')}</th><th>{t('status')}</th><th>{t('verified')}</th></tr></thead>
                  <tbody>
                    {list.map((b) => {
                      const own = rates.data?.rows.filter((r) => r.bankSlug === b.slug) ?? [];
                      return (
                        <tr key={b.slug}>
                          <td className="min-w-52">
                            <Link className="link font-medium" to={`/banks/${b.slug}`}>{b.name}</Link>
                            {!own.length && b.accessNote && <div className="max-w-xl text-xs text-ink-2">{t('banks_not_covered')}: {localize(lang, b.accessNote)}</div>}
                            {own.length > 0 && <div className="text-xs text-ink-2">{t('banks_products', { n: new Set(own.map((r) => r.productKey)).size })}</div>}
                          </td>
                          <td>{[...new Set(own.map((r) => r.currency))].join(', ') || '—'}</td>
                          <td className="r num">{own.length}</td>
                          <td><FreshnessBadge state={b.freshness} /></td>
                          <td className="num whitespace-nowrap text-xs">{f.dateTime(b.lastVerifiedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </Loaded>
    </>
  );
}
