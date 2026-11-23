import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton, EmptyState } from '@/components/ui/feedback';

export const CHART_COLORS = ['#0f766e', '#0284c7', '#7c3aed', '#d97706', '#dc2626', '#16a34a', '#db2777', '#475569', '#0891b2'];
const axis = { fontSize: 11, fill: '#64748b' };

export function ChartCard({ title, children, loading, empty, className }: { title: string; children: ReactNode; loading?: boolean; empty?: boolean; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        {loading ? <Skeleton className="h-full w-full" /> : empty ? <EmptyState title="No data yet" /> : children}
      </CardContent>
    </Card>
  );
}

export function TrendLine({ data, lines }: { data: Array<Record<string, unknown>>; lines: Array<{ key: string; label: string }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
        <YAxis tick={axis} allowDecimals={false} />
        <Tooltip />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((l, i) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={CHART_COLORS[i]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimpleBar({ data, xKey, yKey, label, horizontal }: { data: Array<Record<string, unknown>>; xKey: string; yKey: string; label: string; horizontal?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: horizontal ? 10 : -20, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {/* Recharts 2 only detects axes that are direct children (no fragments). */}
        {horizontal ? <XAxis type="number" tick={axis} allowDecimals={false} /> : <XAxis dataKey={xKey} tick={axis} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? 'end' : 'middle'} height={data.length > 5 ? 50 : 30} />}
        {horizontal ? <YAxis type="category" dataKey={xKey} tick={axis} width={110} /> : <YAxis tick={axis} allowDecimals={false} />}
        <Tooltip />
        <Bar dataKey={yKey} name={label} fill={CHART_COLORS[0]} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, nameKey, valueKey }: { data: Array<Record<string, unknown>>; nameKey: string; valueKey: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="55%" outerRadius="80%" paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle" />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function GroupedBar({ data, xKey, bars }: { data: Array<Record<string, unknown>>; xKey: string; bars: Array<{ key: string; label: string }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={axis} interval={0} />
        <YAxis tick={axis} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.label} fill={CHART_COLORS[i]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
