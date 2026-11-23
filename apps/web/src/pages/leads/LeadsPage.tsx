import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { LEAD_SOURCES, LEAD_STATUSES, PROPERTY_TYPES, URGENCY, humanize, leadCreateSchema } from '@rea/shared';
import { api } from '@/services/api';
import { usePagedList, useDebounced, useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Lead } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { DemoBadge, PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { timeAgo } from '@/utils/format';

export function LeadsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ status: '', source: '', location: '' });
  const [open, setOpen] = useState(false);
  const q = usePagedList<Lead>('leads', '/leads', { ...f, location: useDebounced(f.location), search: useDebounced(search) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Leads" description="Every qualified WhatsApp lead passes through the same assignment pipeline." actions={can('lead:write') && <Button onClick={() => setOpen(true)}><Plus /> New lead</Button>} />
      <Card>
        <div className="grid gap-2 border-b p-3 sm:grid-cols-4">
          <Input placeholder="Search LD-000123, name, phone…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" />
          <Select value={f.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select value={f.source} onChange={set('source')} aria-label="Source"><option value="">All sources</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Input placeholder="Location" value={f.location} onChange={set('location')} aria-label="Location" />
        </div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No leads found" description="Leads are created when the AI qualifies a WhatsApp conversation, or manually." />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Lead</TH><TH>Customer</TH><TH>Requirement</TH><TH>Urgency</TH><TH>Broker</TH><TH>Status</TH><TH>Created</TH></TR></THead>
              <TBody>
                {q.data.items.map((l) => (
                  <TR key={l.id}>
                    <TD><Link to={`/leads/${l.id}`} className="font-medium hover:underline">{l.leadNumber}</Link><DemoBadge show={l.isDemo} /><p className="text-xs text-muted-foreground">{humanize(l.source)}</p></TD>
                    <TD>{l.customer?.fullName ?? 'Unknown'}<p className="text-xs text-muted-foreground">{l.customer?.phone}</p></TD>
                    <TD className="max-w-xs text-sm">{[l.propertyType && humanize(l.propertyType), l.bedrooms != null && `${l.bedrooms} BHK`, l.preferredLocation, l.budgetRange].filter(Boolean).join(' · ') || '—'}</TD>
                    <TD>{l.urgency !== 'UNKNOWN' ? <Badge tone={l.urgency === 'IMMEDIATE' ? 'red' : 'gray'}>{humanize(l.urgency)}</Badge> : '—'}</TD>
                    <TD className="text-sm">{l.broker?.user.fullName ?? <span className="text-muted-foreground">Unassigned</span>}</TD>
                    <TD><StatusBadge status={l.status} /></TD>
                    <TD className="text-xs text-muted-foreground">{timeAgo(l.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.page} totalPages={q.data.totalPages} total={q.data.total} onPage={q.setPage} />
          </>
        )}
      </Card>
      <NewLeadDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

type In = z.input<typeof leadCreateSchema>;
type Out = z.output<typeof leadCreateSchema>;

export function NewLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<In, unknown, Out>({ resolver: zodResolver(leadCreateSchema), defaultValues: { source: 'MANUAL', urgency: 'UNKNOWN', autoAssign: true } });
  const create = useApiMutation((v: Out) => api<Lead>('/leads', { method: 'POST', body: { ...v, propertyType: v.propertyType || null } }), {
    success: 'Lead created',
    invalidate: [['leads'], ['dashboard']],
    onSuccess: (l) => {
      onOpenChange(false);
      reset();
      navigate(`/leads/${l.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New lead" description="Existing customers are matched by phone number." className="max-w-2xl">
      <form noValidate onSubmit={handleSubmit((v) => create.mutateAsync(v))} className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer phone" error={errors.customerPhone?.message}><Input {...register('customerPhone')} placeholder="+91 98…" /></Field>
        <Field label="Customer name" error={errors.customerName?.message}><Input {...register('customerName')} /></Field>
        <Field label="Property type"><Select {...register('propertyType')}><option value="">—</option>{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
        <Field label="Preferred location" error={errors.preferredLocation?.message}><Input {...register('preferredLocation')} /></Field>
        <Field label="Budget" hint="e.g. 50-70 Lakhs, 1.2 Cr" error={errors.budgetRange?.message}><Input {...register('budgetRange')} /></Field>
        <Field label="Bedrooms" error={errors.bedrooms?.message}><Input inputMode="numeric" {...register('bedrooms', { setValueAs: (v) => (v === '' ? null : v) })} /></Field>
        <Field label="Urgency"><Select {...register('urgency')}>{URGENCY.map((u) => <option key={u} value={u}>{humanize(u)}</option>)}</Select></Field>
        <Field label="Source"><Select {...register('source')}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
        <Field label="Summary" className="sm:col-span-2"><Textarea rows={2} {...register('summary')} /></Field>
        {user?.role !== 'BROKER' && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" {...register('autoAssign')} /> Auto-assign to the best broker if the lead is qualified</label>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={isSubmitting}>Create lead</Button></div>
      </form>
    </Dialog>
  );
}
