import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserX } from 'lucide-react';
import { humanize } from '@rea/shared';
import { api } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Broker } from '@/types/api';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailRow, PageHeader, StatCard } from '@/components/ui/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate, timeAgo } from '@/utils/format';
import { BrokerFormDialog } from './BrokerFormDialog';
import { WorkloadBar } from './BrokersPage';

export function BrokerDetailsPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['broker', id], queryFn: () => api<Broker>(`/brokers/${id}`) });
  if (q.isLoading) return <TableSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  return (
    <>
      <PageHeader
        back="/brokers"
        title={b.user.fullName}
        description={`${b.user.email} · ${b.phone}`}
        actions={can('broker:write') && (
          <>
            <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> Edit</Button>
            {b.status === 'ACTIVE' && (
              <ConfirmButton title="Deactivate broker?" description="They will be signed out, excluded from auto-assignment, and unable to log in. History is kept." confirmLabel="Deactivate" onConfirm={async () => { await api(`/brokers/${b.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['broker', id] }); }}>
                <UserX /> Deactivate
              </ConfirmButton>
            )}
          </>
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total leads" value={b.stats?.total ?? 0} />
        <StatCard label="Active" value={<WorkloadBar active={b.stats?.active ?? 0} max={b.maxActiveLeads} />} />
        <StatCard label="Converted" value={b.stats?.converted ?? 0} />
        <StatCard label="Win rate" value={`${b.stats?.conversionRate ?? 0}%`} hint="Converted ÷ closed" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
          <CardContent>
            <dl className="divide-y">
              <DetailRow label="Status"><StatusBadge status={b.status} /></DetailRow>
              <DetailRow label="Availability"><StatusBadge status={b.availability} /></DetailRow>
              <DetailRow label="WhatsApp">{b.whatsappNumber ?? b.phone}</DetailRow>
              <DetailRow label="Areas"><div className="flex flex-wrap gap-1">{b.areas.map((a) => <Badge key={a} className="capitalize">{a}</Badge>)}</div></DetailRow>
              <DetailRow label="Specialization">{b.specialization.map(humanize).join(', ') || '—'}</DetailRow>
              <DetailRow label="Experience">{b.experienceYears} yrs</DetailRow>
              <DetailRow label="Last login">{formatDate(b.user.lastLoginAt)}</DetailRow>
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Assigned leads</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!b.leads?.length ? <EmptyState title="No leads assigned yet" /> : (
              <Table>
                <THead><TR><TH>Lead</TH><TH>Customer</TH><TH>Requirement</TH><TH>Status</TH><TH>Updated</TH></TR></THead>
                <TBody>
                  {b.leads.map((l) => (
                    <TR key={l.id}>
                      <TD><Link to={`/leads/${l.id}`} className="font-medium hover:underline">{l.leadNumber}</Link></TD>
                      <TD>{l.customer?.fullName ?? l.customer?.phone}</TD>
                      <TD className="text-sm">{[l.propertyType && humanize(l.propertyType), l.preferredLocation, l.budgetRange].filter(Boolean).join(' · ') || '—'}</TD>
                      <TD><StatusBadge status={l.status} /></TD>
                      <TD className="text-xs text-muted-foreground">{timeAgo(l.updatedAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <BrokerFormDialog open={edit} onOpenChange={setEdit} broker={b} />
    </>
  );
}
