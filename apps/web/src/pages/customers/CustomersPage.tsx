import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UsersRound } from 'lucide-react';
import { humanize } from '@rea/shared';
import { usePagedList, useDebounced } from '@/hooks/useApi';
import type { Customer } from '@/types/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DemoBadge, PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { timeAgo } from '@/utils/format';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const q = usePagedList<Customer>('customers', '/customers', { search: useDebounced(search) });
  return (
    <>
      <PageHeader title="Customers" description="Customers are created automatically from WhatsApp, deduplicated by phone number." />
      <Card>
        <div className="border-b p-3"><Input placeholder="Search name, phone, email" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" aria-label="Search customers" /></div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
          <EmptyState icon={<UsersRound className="h-5 w-5" />} title="No customers yet" description="Customers appear here when they message your WhatsApp number." />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Customer</TH><TH>Preference</TH><TH>Budget</TH><TH className="text-right">Leads</TH><TH className="text-right">Calls</TH><TH>Consent</TH><TH>Updated</TH></TR></THead>
              <TBody>
                {q.data.items.map((c) => (
                  <TR key={c.id}>
                    <TD><Link to={`/customers/${c.id}`} className="font-medium hover:underline">{c.fullName ?? 'Unknown'}</Link><DemoBadge show={c.isDemo} /><p className="text-xs text-muted-foreground">{c.phone}</p></TD>
                    <TD className="text-sm">{[c.preferredPropertyType && humanize(c.preferredPropertyType), c.preferredLocation].filter(Boolean).join(' · ') || '—'}</TD>
                    <TD className="text-sm">{c.budgetRange ?? '—'}</TD>
                    <TD className="text-right tabular-nums">{c._count?.leads ?? 0}</TD>
                    <TD className="text-right tabular-nums">{c._count?.voiceCalls ?? 0}</TD>
                    <TD>{c.whatsappConsent ? <Badge tone="green">Opted in</Badge> : <Badge>None</Badge>}</TD>
                    <TD className="text-xs text-muted-foreground">{timeAgo(c.updatedAt)}</TD>
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
