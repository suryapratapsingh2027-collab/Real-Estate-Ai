import { useState } from 'react';
import { humanize } from '@rea/shared';
import { PageHeader, StatCard } from '@/components/ui/page';
import { Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDuration } from '@/utils/format';
import { AnalyticsCharts, useAnalytics, useOverview } from './DashboardPage';

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const a = useAnalytics(days);
  const o = useOverview();
  if (a.isError) return <ErrorState error={a.error} onRetry={() => a.refetch()} />;
  const totalCalls = a.data?.voiceCallStats.reduce((s, x) => s + x.count, 0) ?? 0;
  const completed = a.data?.voiceCallStats.find((x) => x.status === 'COMPLETED');
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Pipeline, broker and channel performance from live data."
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40" aria-label="Date range">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </Select>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Leads in period" loading={a.isLoading} value={a.data?.leadsOverTime.reduce((s, x) => s + x.count, 0)} />
        <StatCard label="Conversion rate (all time)" loading={o.isLoading} value={o.data ? `${o.data.conversionRate}%` : ''} />
        <StatCard label="Voice calls in period" loading={a.isLoading} value={totalCalls} />
        <StatCard label="Avg completed call" loading={a.isLoading} value={formatDuration(completed?.avgDurationSeconds ?? null)} />
      </div>
      <AnalyticsCharts data={a.data} loading={a.isLoading} />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Broker leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Broker</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Active</TH>
                  <TH className="text-right">Converted</TH>
                  <TH className="text-right">Win rate</TH>
                </TR>
              </THead>
              <TBody>
                {(a.data?.brokerPerformance ?? []).map((b) => (
                  <TR key={b.brokerId}>
                    <TD className="font-medium">{b.name}</TD>
                    <TD className="text-right tabular-nums">{b.total}</TD>
                    <TD className="text-right tabular-nums">{b.active}</TD>
                    <TD className="text-right tabular-nums">{b.converted}</TD>
                    <TD className="text-right tabular-nums">{b.conversionRate}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Leads by source</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TBody>
                {(a.data?.leadsBySource ?? []).map((s) => (
                  <TR key={s.source}>
                    <TD>{humanize(s.source)}</TD>
                    <TD className="text-right tabular-nums">{s.count}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
