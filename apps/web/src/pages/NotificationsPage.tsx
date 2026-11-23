import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { humanize } from '@rea/shared';
import { api } from '@/services/api';
import { usePagedList, useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Notification } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/utils/cn';
import { formatDate, timeAgo } from '@/utils/format';

export function NotificationsPage() {
  const { can } = useAuth();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const q = usePagedList<Notification>('notifications', '/notifications', { scope });
  const readAll = useApiMutation(() => api('/notifications/read-all', { method: 'POST' }), { invalidate: [['notifications']] });
  const read = useApiMutation((id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), { invalidate: [['notifications']] });
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <>
            {can('lead:read_all') && (
              <div className="flex rounded-md border p-0.5 text-sm">
                {(['mine', 'all'] as const).map((s) => (
                  <button key={s} className={cn('rounded px-3 py-1', scope === s && 'bg-secondary font-medium')} onClick={() => setScope(s)}>{s === 'mine' ? 'My inbox' : 'WhatsApp delivery log'}</button>
                ))}
              </div>
            )}
            {scope === 'mine' && <Button variant="outline" onClick={() => readAll.mutate(undefined)}><CheckCheck /> Mark all read</Button>}
          </>
        }
      />
      <Card>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.items.length ? <EmptyState icon={<Bell className="h-5 w-5" />} title="No notifications" /> : scope === 'mine' ? (
          <ul className="divide-y">
            {q.data.items.map((n) => (
              <li key={n.id} className={cn('flex items-start justify-between gap-3 px-4 py-3', !n.readAt && 'bg-accent/40')}>
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{timeAgo(n.createdAt)}{n.leadId && <> · <Link to={`/leads/${n.leadId}`} className="hover:underline" onClick={() => !n.readAt && read.mutate(n.id)}>Open lead</Link></>}</p>
                </div>
                {!n.readAt && <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>Mark read</Button>}
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <THead><TR><TH>Created</TH><TH>Type</TH><TH>To</TH><TH>Attempts</TH><TH>Status</TH><TH>Error</TH></TR></THead>
            <TBody>
              {q.data.items.map((n) => (
                <TR key={n.id}>
                  <TD className="text-sm">{formatDate(n.createdAt)}</TD>
                  <TD>{humanize(n.type)}{n.leadId && <Link to={`/leads/${n.leadId}`} className="ml-1 text-xs text-primary hover:underline">lead</Link>}</TD>
                  <TD className="text-sm">{n.toAddress ?? '—'}</TD>
                  <TD className="tabular-nums">{n.attempts}</TD>
                  <TD><StatusBadge status={n.status} /></TD>
                  <TD className="max-w-xs truncate text-xs text-destructive">{n.lastError ?? ''}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {q.data && <Pagination page={q.page} totalPages={q.data.totalPages} total={q.data.total} onPage={q.setPage} />}
      </Card>
    </>
  );
}
