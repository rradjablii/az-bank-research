import {
  Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useI18n } from '../i18n';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

const axis = { tick: { fill: 'var(--ink-2)', fontSize: 11 }, tickLine: false, axisLine: { stroke: 'var(--line)' } };
const tooltip = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: 'var(--ink-2)' },
  itemStyle: { color: 'var(--ink)' },
};

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-2" style={{ borderColor: i.color, borderStyle: i.dashed ? 'dashed' : 'solid' }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  dashed?: boolean;
  /** Colour slot, so an entity keeps its colour when others are hidden. */
  slot: number;
}

/** Monthly time series on a single percentage axis. */
export function TimeSeries({ data, series, height = 280, zero = false }: {
  data: Record<string, number | string | null>[]; series: LineSeries[]; height?: number; zero?: boolean;
}) {
  const { f } = useI18n();
  return (
    <div>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: SERIES[s.slot]!, dashed: s.dashed }))} />}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" {...axis} minTickGap={36} tickFormatter={(v) => f.month(String(v))} />
          <YAxis {...axis} axisLine={false} tickFormatter={(v) => `${v}%`} domain={['auto', 'auto']} />
          {zero && <ReferenceLine y={0} stroke="var(--ink-2)" />}
          <Tooltip {...tooltip} labelFormatter={(v) => f.month(String(v))} formatter={(v, name) => [f.pct(Number(v)), name]} />
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} name={s.label} stroke={SERIES[s.slot]} strokeWidth={2} dot={false}
              strokeDasharray={s.dashed ? '5 4' : undefined} isAnimationActive={false} connectNulls={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HistogramChart({ data, label }: { data: { range: string; count: number }[]; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -20 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="range" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltip} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey="count" name={label} fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.length <= 12 && <LabelList dataKey="count" position="top" fill="var(--ink-2)" fontSize={11} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RankedBars({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  const { f } = useI18n();
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 28 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="name" width={128} {...axis} axisLine={false} interval={0} />
        <Tooltip {...tooltip} cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => [f.pct(Number(v)), label]} />
        <Bar dataKey="value" fill={SERIES[0]} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey="value" position="right" fill="var(--ink)" fontSize={11} formatter={(v) => f.pct(Number(v))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ScatterFit({ points, line, xLabel, yLabel }: {
  points: { x: number; y: number }[]; line: { x: number; fit: number }[]; xLabel: string; yLabel: string;
}) {
  const { f } = useI18n();
  return (
    <div>
      <Legend items={[{ label: `${yLabel} × ${xLabel}`, color: SERIES[0]! }, { label: 'OLS', color: SERIES[1]! }]} />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart margin={{ top: 6, right: 8, bottom: 18, left: -8 }}>
          <CartesianGrid stroke="var(--grid)" />
          <XAxis type="number" dataKey="x" {...axis} domain={['auto', 'auto']} tickFormatter={(v) => f.number(v, 1)}
            label={{ value: xLabel, position: 'insideBottom', offset: -12, fill: 'var(--ink-2)', fontSize: 11 }} />
          <YAxis type="number" {...axis} domain={['auto', 'auto']} tickFormatter={(v) => f.number(v, 1)} />
          <Tooltip {...tooltip} formatter={(v, n) => [f.number(Number(v)), n]} />
          <Scatter data={points} dataKey="y" name={yLabel} fill={SERIES[0]} isAnimationActive={false} />
          <Line data={line} dataKey="fit" name="OLS" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
