import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { usePagedList, useDebounced } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Broker } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BrokerFormDialog } from './BrokerFormDialog';

export function WorkloadBar({ active, max }: { active: number; max: number }) {
  const pct = Math.min(100, Math.round((active / Math.max(1, max)) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{active}/{max}</span>
    </div>
  );
}

export function BrokersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const q = usePagedList<Broker>('brokers', '/brokers', { search: useDebounced(search), status });
  return (
    <>
      <PageHeader title="Brokers" description="Coverage areas and workload drive automatic lead assignment." actions={can('broker:write') && <Button onClick={() => setOpen(true)}><Plus /> Add broker</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input placeholder="Search name, email, phone" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" aria-label="Search brokers" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status">
            <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
          </Select>
        </div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No brokers yet" description="Add brokers and their coverage areas to enable automatic assignment." />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Broker</TH><TH>Areas</TH><TH>Availability</TH><TH>Workload</TH><TH className="text-right">Converted</TH><TH className="text-right">Win rate</TH><TH>Status</TH></TR></THead>
              <TBody>
                {q.data.items.map((b) => (
                  <TR key={b.id}>
                    <TD><Link to={`/brokers/${b.id}`} className="font-medium hover:underline">{b.user.fullName}</Link><p className="text-xs text-muted-foreground">{b.user.email} · {b.phone}</p></TD>
                    <TD><div className="flex max-w-xs flex-wrap gap-1">{b.areas.slice(0, 4).map((a) => <Badge key={a} className="capitalize">{a}</Badge>)}{b.areas.length > 4 && <Badge>+{b.areas.length - 4}</Badge>}</div></TD>
                    <TD><StatusBadge status={b.availability} /></TD>
                    <TD><WorkloadBar active={b.stats?.active ?? 0} max={b.maxActiveLeads} /></TD>
                    <TD className="text-right tabular-nums">{b.stats?.converted ?? 0}</TD>
                    <TD className="text-right tabular-nums">{b.stats?.conversionRate ?? 0}%</TD>
                    <TD><StatusBadge status={b.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.page} totalPages={q.data.totalPages} total={q.data.total} onPage={q.setPage} />
          </>
        )}
      </Card>
      <BrokerFormDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
