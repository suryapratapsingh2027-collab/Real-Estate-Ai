import { useState } from 'react';
import { usePagedList, useDebounced } from '@/hooks/useApi';
import type { AuditLog } from '@/types/api';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/utils/format';

const ENTITIES = ['User', 'Property', 'BrokerProfile', 'Customer', 'Lead', 'Conversation', 'VoiceCall', 'Integration', 'BusinessSetting'];

export function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const q = usePagedList<AuditLog>('audit', '/audit-logs', { search: useDebounced(search), entityType }, 50);
  return (
    <>
      <PageHeader title="Audit logs" description="Security-relevant actions. Secret values are never recorded." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input placeholder="Search action or entity id" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" aria-label="Search audit logs" />
          <Select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-48" aria-label="Entity"><option value="">All entities</option>{ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}</Select>
        </div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.items.length ? <EmptyState title="No audit entries" /> : (
          <>
            <Table>
              <THead><TR><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>IP</TH><TH>Details</TH></TR></THead>
              <TBody>
                {q.data.items.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap text-sm">{formatDate(a.createdAt)}</TD>
                    <TD className="text-sm">{a.actor?.fullName ?? 'System'}</TD>
                    <TD><Badge tone={a.action.includes('failed') ? 'red' : 'gray'}>{a.action}</Badge></TD>
                    <TD className="text-xs">{a.entityType}{a.entityId && <span className="block truncate text-muted-foreground">{a.entityId}</span>}</TD>
                    <TD className="text-xs text-muted-foreground">{a.ip ?? '—'}</TD>
                    <TD className="max-w-xs truncate font-mono text-[11px] text-muted-foreground">{a.data ? JSON.stringify(a.data) : ''}</TD>
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
