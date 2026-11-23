import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Check, X } from 'lucide-react';
import { FOLLOWUP_STATUS, humanize } from '@rea/shared';
import { api } from '@/services/api';
import { usePagedList, useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { FollowUp } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/utils/format';

export function FollowUpsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('overdue') ? '' : 'PENDING');
  const [overdue, setOverdue] = useState(params.get('overdue') === 'true');
  const q = usePagedList<FollowUp>('follow-ups', '/follow-ups', { status: overdue ? undefined : status, overdue: overdue ? 'true' : undefined });
  const update = useApiMutation((v: { id: string; status: 'DONE' | 'CANCELLED' }) => api(`/follow-ups/${v.id}`, { method: 'PATCH', body: { status: v.status } }), { success: 'Follow-up updated', invalidate: [['follow-ups'], ['dashboard']] });
  return (
    <>
      <PageHeader title="Follow-ups" description="Reminders are sent to the assigned broker when a follow-up is due." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <Select value={status} disabled={overdue} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status"><option value="">All</option>{FOLLOWUP_STATUS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only</label>
        </div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
          <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="Nothing here" description="Schedule follow-ups from a lead's page." />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Due</TH><TH>Task</TH><TH>Lead</TH><TH>Assignee</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>
                {q.data.items.map((f) => (
                  <TR key={f.id}>
                    <TD className="text-sm">{formatDate(f.dueAt)} {f.overdue && <Badge tone="red" className="ml-1">Overdue</Badge>}</TD>
                    <TD><p className="font-medium">{f.title}</p>{f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}</TD>
                    <TD>{f.lead && <Link to={`/leads/${f.lead.id}`} className="hover:underline">LD-{String(f.lead.number).padStart(6, '0')}</Link>}<p className="text-xs text-muted-foreground">{f.lead?.customer.fullName ?? f.lead?.customer.phone}</p></TD>
                    <TD className="text-sm">{f.assignee?.fullName ?? '—'}</TD>
                    <TD><StatusBadge status={f.status} /></TD>
                    <TD className="text-right">
                      {can('followup:write') && f.status === 'PENDING' && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => update.mutate({ id: f.id, status: 'DONE' })} aria-label="Mark done"><Check /></Button>
                          <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: f.id, status: 'CANCELLED' })} aria-label="Cancel"><X /></Button>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.page} totalPages={q.data.totalPages} total={q.data.total} onPage={q.setPage} />
          </>
        )}
      </Card>
    </>
  );
}
