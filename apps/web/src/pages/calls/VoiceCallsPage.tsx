import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { CALL_STATUS, humanize } from '@rea/shared';
import { usePagedList, useDebounced } from '@/hooks/useApi';
import type { VoiceCall } from '@/types/api';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate, formatDuration } from '@/utils/format';

export function VoiceCallsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = usePagedList<VoiceCall>('calls', '/voice/calls', { search: useDebounced(search), status });
  return (
    <>
      <PageHeader title="AI Voice Calls" description="Browser-based LiveKit calls between customers and the AI assistant (not phone-network calls)." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input placeholder="Search customer or summary" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" aria-label="Search calls" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Status"><option value="">All statuses</option>{CALL_STATUS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        </div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
          <EmptyState icon={<Phone className="h-5 w-5" />} title="No calls yet" description="Customers receive a secure call link on WhatsApp when they ask to talk." />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Customer</TH><TH>Lead</TH><TH>Created</TH><TH>Duration</TH><TH>Summary</TH><TH>Status</TH></TR></THead>
              <TBody>
                {q.data.items.map((c) => (
                  <TR key={c.id}>
                    <TD><Link to={`/calls/${c.id}`} className="font-medium hover:underline">{c.customer.fullName ?? c.customer.phone}</Link></TD>
                    <TD>{c.lead ? <Link to={`/leads/${c.lead.id}`} className="hover:underline">LD-{String(c.lead.number).padStart(6, '0')}</Link> : '—'}</TD>
                    <TD className="text-sm">{formatDate(c.createdAt)}</TD>
                    <TD className="tabular-nums">{formatDuration(c.durationSeconds)}</TD>
                    <TD className="max-w-sm truncate text-sm text-muted-foreground">{c.summary ?? '—'}</TD>
                    <TD><StatusBadge status={c.status} /></TD>
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
