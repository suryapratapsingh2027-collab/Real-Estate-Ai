import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, CheckCircle2, ClipboardList, MessageSquare, Percent, Phone, PhoneMissed, Sparkles, UserCheck, Users, UsersRound } from 'lucide-react';
import { humanize } from '@rea/shared';
import { api } from '@/services/api';
import { PageHeader, StatCard } from '@/components/ui/page';
import { ErrorState } from '@/components/ui/feedback';
import { ChartCard, Donut, GroupedBar, SimpleBar, TrendLine } from '@/components/charts';
import { useAuth } from '@/contexts/AuthContext';

export type Overview = {
  totalProperties: number; activeProperties: number; totalLeads: number; newLeads: number; qualifiedLeads: number; assignedLeads: number; convertedLeads: number;
  totalBrokers: number; totalCustomers: number; whatsappConversations: number; voiceCalls: number; missedOrFailedCalls: number; conversionRate: number; leadsThisWeek: number; overdueFollowUps: number;
};
export type Analytics = {
  days: number;
  leadsOverTime: Array<{ date: string; count: number }>;
  leadsByPropertyType: Array<{ type: string; count: number }>;
  leadsByLocation: Array<{ location: string; count: number }>;
  leadStatusDistribution: Array<{ status: string; count: number }>;
  leadsBySource: Array<{ source: string; count: number }>;
  brokerPerformance: Array<{ brokerId: string; name: string; total: number; converted: number; active: number; conversionRate: number }>;
  whatsappMessages: Array<{ date: string; inbound: number; outbound: number }>;
  voiceCallStats: Array<{ status: string; count: number; avgDurationSeconds: number | null }>;
};

export function useOverview() {
  return useQuery({ queryKey: ['dashboard', 'overview'], queryFn: () => api<Overview>('/dashboard/overview'), refetchInterval: 60_000 });
}
export function useAnalytics(days: number) {
  return useQuery({ queryKey: ['dashboard', 'analytics', days], queryFn: () => api<Analytics>('/dashboard/analytics', { query: { days } }) });
}

export function DashboardPage() {
  const { user } = useAuth();
  const o = useOverview();
  const a = useAnalytics(30);
  const d = o.data;
  const loading = o.isLoading;
  if (o.isError) return <ErrorState error={o.error} onRetry={() => o.refetch()} />;

  return (
    <>
      <PageHeader title={`Welcome back, ${user?.fullName.split(' ')[0] ?? ''}`} description={user?.role === 'BROKER' ? 'Your assigned leads and activity.' : 'Live overview of your real estate pipeline.'} />
      {d && d.overdueFollowUps > 0 && (
        <Link to="/follow-ups?overdue=true" className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" /> {d.overdueFollowUps} overdue follow-up{d.overdueFollowUps > 1 ? 's' : ''} need attention
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        <StatCard loading={loading} label="Total Properties" value={d?.totalProperties} icon={<Building2 className="h-4 w-4" />} />
        <StatCard loading={loading} label="Active Properties" value={d?.activeProperties} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard loading={loading} label="Total Leads" value={d?.totalLeads} icon={<ClipboardList className="h-4 w-4" />} hint={d ? `${d.leadsThisWeek} this week` : undefined} />
        <StatCard loading={loading} label="New Leads" value={d?.newLeads} icon={<Sparkles className="h-4 w-4" />} />
        <StatCard loading={loading} label="Qualified Leads" value={d?.qualifiedLeads} icon={<UserCheck className="h-4 w-4" />} />
        <StatCard loading={loading} label="Assigned (active)" value={d?.assignedLeads} icon={<Users className="h-4 w-4" />} />
        <StatCard loading={loading} label="Converted" value={d?.convertedLeads} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard loading={loading} label="Conversion Rate" value={d ? `${d.conversionRate}%` : ''} icon={<Percent className="h-4 w-4" />} hint="Converted ÷ closed leads" />
        <StatCard loading={loading} label="Brokers" value={d?.totalBrokers} icon={<Users className="h-4 w-4" />} />
        <StatCard loading={loading} label="Customers" value={d?.totalCustomers} icon={<UsersRound className="h-4 w-4" />} />
        <StatCard loading={loading} label="WhatsApp Chats" value={d?.whatsappConversations} icon={<MessageSquare className="h-4 w-4" />} />
        <StatCard loading={loading} label="AI Voice Calls" value={d?.voiceCalls} icon={<Phone className="h-4 w-4" />} />
        <StatCard loading={loading} label="Missed / Failed Calls" value={d?.missedOrFailedCalls} icon={<PhoneMissed className="h-4 w-4" />} tone="warn" />
      </div>
      <AnalyticsCharts data={a.data} loading={a.isLoading} />
    </>
  );
}

export function AnalyticsCharts({ data, loading }: { data?: Analytics; loading: boolean }) {
  const a = data;
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <ChartCard title={`Leads generated (last ${a?.days ?? 30} days)`} loading={loading} empty={!a?.leadsOverTime.some((x) => x.count)} className="lg:col-span-2">
        <TrendLine data={a?.leadsOverTime ?? []} lines={[{ key: 'count', label: 'Leads' }]} />
      </ChartCard>
      <ChartCard title="Leads by property type" loading={loading} empty={!a?.leadsByPropertyType.length}>
        <Donut data={(a?.leadsByPropertyType ?? []).map((x) => ({ name: humanize(x.type), value: x.count }))} nameKey="name" valueKey="value" />
      </ChartCard>
      <ChartCard title="Leads by location (top 10)" loading={loading} empty={!a?.leadsByLocation.length}>
        <SimpleBar data={a?.leadsByLocation ?? []} xKey="location" yKey="count" label="Leads" horizontal />
      </ChartCard>
      <ChartCard title="Lead status distribution" loading={loading} empty={!a?.leadStatusDistribution.length}>
        <Donut data={(a?.leadStatusDistribution ?? []).map((x) => ({ name: humanize(x.status), value: x.count }))} nameKey="name" valueKey="value" />
      </ChartCard>
      <ChartCard title="Broker performance" loading={loading} empty={!a?.brokerPerformance.length}>
        <GroupedBar data={a?.brokerPerformance ?? []} xKey="name" bars={[{ key: 'total', label: 'Leads' }, { key: 'active', label: 'Active' }, { key: 'converted', label: 'Converted' }]} />
      </ChartCard>
      <ChartCard title="WhatsApp messages" loading={loading} empty={!a?.whatsappMessages.some((x) => x.inbound || x.outbound)}>
        <TrendLine data={a?.whatsappMessages ?? []} lines={[{ key: 'inbound', label: 'Inbound' }, { key: 'outbound', label: 'Outbound' }]} />
      </ChartCard>
      <ChartCard title="AI voice calls by status" loading={loading} empty={!a?.voiceCallStats.length}>
        <SimpleBar data={(a?.voiceCallStats ?? []).map((x) => ({ status: humanize(x.status), count: x.count }))} xKey="status" yKey="count" label="Calls" />
      </ChartCard>
    </div>
  );
}
