import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '../i18n';
import { useApi, type Responses } from '../lib/api';
import { Loaded, PageHeader, Panel } from '../components/ui';
import { Legend, SERIES } from '../components/charts';
import { renderReport, type ReportChart } from '../../shared/report';

const axis = { tick: { fill: 'var(--ink-2)', fontSize: 11 }, tickLine: false, axisLine: { stroke: 'var(--line)' } };
const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 } };

function Chart({ chart }: { chart: ReportChart }) {
  const data = chart.labels.map((label, i) => ({ label, ...Object.fromEntries(chart.series.map((s, k) => [`s${k}`, s.values[i] ?? null])) }));
  const common = { data, margin: { top: 6, right: 8, bottom: 0, left: -14 } };
  return (
    <figure className="my-3">
      <figcaption className="mb-1 text-xs font-semibold">{chart.caption}</figcaption>
      {chart.series.length > 1 && <Legend items={chart.series.map((s, k) => ({ label: s.name, color: SERIES[k]! }))} />}
      <ResponsiveContainer width="100%" height={240}>
        {chart.kind === 'line' ? (
          <LineChart {...common}>
            <CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="label" {...axis} minTickGap={28} /><YAxis {...axis} axisLine={false} /><Tooltip {...tip} />
            {chart.series.map((s, k) => <Line key={s.name} dataKey={`s${k}`} name={s.name} stroke={SERIES[k]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
          </LineChart>
        ) : (
          <BarChart {...common}>
            <CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="label" {...axis} interval="preserveStartEnd" /><YAxis {...axis} axisLine={false} /><Tooltip {...tip} />
            <Bar dataKey="s0" name={chart.series[0]!.name} fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}

function Report({ report }: { report: Responses['report'] }) {
  const { t, lang } = useI18n();
  const doc = useMemo(() => renderReport(report.data, lang), [report, lang]);
  return (
    <>
      <PageHeader title={doc.title} subtitle={doc.subtitle}>
        <a className="btn btn-primary" href={`/api/reports/${report.slug}/pdf?lang=${lang}`}>{t('res_pdf')}</a>
      </PageHeader>
      <Panel>
        <article className="max-w-4xl space-y-5">
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="mb-1.5 text-base font-semibold">{s.heading}</h2>
              {s.paragraphs.map((p, i) => <p key={i} className="mb-1.5 break-words leading-relaxed">{p}</p>)}
              {s.tables?.map((table) => (
                <div key={table.caption} className="my-3 overflow-x-auto">
                  <table className="data num text-xs">
                    <caption className="mb-1 text-left text-xs font-semibold">{table.caption}</caption>
                    <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              ))}
              {s.charts?.map((c) => <Chart key={c.caption} chart={c} />)}
            </section>
          ))}
        </article>
      </Panel>
      <Link className="link mt-3 inline-block text-sm" to="/research">← {t('res_back')}</Link>
    </>
  );
}

export default function ReportView() {
  const { slug = '' } = useParams();
  const report = useApi('report', '', slug);
  return <Loaded state={report}>{(r) => <Report report={r} />}</Loaded>;
}
