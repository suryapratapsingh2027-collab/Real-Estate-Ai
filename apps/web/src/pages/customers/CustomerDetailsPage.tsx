import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, MessageSquare, Phone, Pencil } from 'lucide-react';
import { PROPERTY_TYPES, humanize } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Customer, Lead } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { DemoBadge, DetailRow, PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { formatDate, timeAgo } from '@/utils/format';

type CustomerDetail = Customer & {
  leads: Lead[];
  conversation: { id: string; lastMessageAt: string | null; humanTakeover: boolean; summary: string | null; _count: { messages: number } } | null;
  voiceCalls: Array<{ id: string; status: string; createdAt: string; durationSeconds: number | null; summary: string | null; leadId: string | null }>;
  timeline: Array<{ at: string; kind: 'lead' | 'message' | 'call'; text: string; by: string | null; leadId: string | null }>;
};

const ICON = { lead: ClipboardList, message: MessageSquare, call: Phone };

export function CustomerDetailsPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  if (q.isLoading) return <TableSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  return (
    <>
      <PageHeader
        back="/customers"
        title={<>{c.fullName ?? 'Unknown customer'}<DemoBadge show={c.isDemo} /></>}
        description={c.phone}
        actions={
          <>
            {c.conversation && <Button variant="outline" asChild><Link to={`/conversations/${c.conversation.id}`}><MessageSquare /> Conversation</Link></Button>}
            {can('customer:write') && <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> Edit</Button>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="WhatsApp">{c.whatsappNumber ?? '—'}</DetailRow>
                <DetailRow label="Email">{c.email ?? '—'}</DetailRow>
                <DetailRow label="Language">{c.preferredLanguage === 'hi' ? 'Hindi / Hinglish' : c.preferredLanguage === 'en' ? 'English' : c.preferredLanguage ?? '—'}</DetailRow>
                <DetailRow label="Property type">{c.preferredPropertyType ? humanize(c.preferredPropertyType) : '—'}</DetailRow>
                <DetailRow label="Location">{c.preferredLocation ?? '—'}</DetailRow>
                <DetailRow label="Budget">{c.budgetRange ?? '—'}</DetailRow>
                <DetailRow label="WhatsApp consent">{c.whatsappConsent ? <Badge tone="green">Opted in</Badge> : <Badge>None</Badge>}</DetailRow>
                <DetailRow label="Notes">{c.notes ?? '—'}</DetailRow>
                <DetailRow label="Created">{formatDate(c.createdAt)}</DetailRow>
              </dl>
            </CardContent>
          </Card>
          {c.conversation?.summary && (
            <Card><CardHeader><CardTitle className="text-base">Conversation summary</CardTitle></CardHeader><CardContent className="text-sm text-slate-700">{c.conversation.summary}</CardContent></Card>
          )}
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Leads ({c.leads.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!c.leads.length ? <EmptyState title="No leads" /> : c.leads.map((l) => (
                <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center justify-between rounded-md border p-3 hover:bg-secondary/40">
                  <div>
                    <p className="text-sm font-medium">{l.leadNumber} · {[l.propertyType && humanize(l.propertyType), l.preferredLocation, l.budgetRange].filter(Boolean).join(' · ') || 'Requirement pending'}</p>
                    <p className="text-xs text-muted-foreground">{l.broker?.user.fullName ? `Broker: ${l.broker.user.fullName}` : 'Unassigned'} · {timeAgo(l.createdAt)}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Activity timeline</CardTitle></CardHeader>
            <CardContent>
              {!c.timeline.length ? <EmptyState title="No activity yet" /> : (
                <ol className="relative space-y-4 border-l pl-5">
                  {c.timeline.slice(0, 40).map((t, i) => {
                    const Icon = ICON[t.kind];
                    return (
                      <li key={i} className="relative">
                        <span className="absolute -left-[29px] flex h-6 w-6 items-center justify-center rounded-full border bg-card"><Icon className="h-3 w-3 text-muted-foreground" /></span>
                        <p className="text-sm">{t.text}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(t.at)}{t.by ? ` · ${t.by}` : ''}</p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <EditCustomerDialog open={edit} onOpenChange={setEdit} customer={c} />
    </>
  );
}

function EditCustomerDialog({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (o: boolean) => void; customer: Customer }) {
  const [v, setV] = useState({ fullName: '', email: '', preferredLanguage: '', preferredPropertyType: '', budgetRange: '', preferredLocation: '', notes: '', whatsappConsent: false });
  useEffect(() => {
    if (open) setV({ fullName: customer.fullName ?? '', email: customer.email ?? '', preferredLanguage: customer.preferredLanguage ?? '', preferredPropertyType: customer.preferredPropertyType ?? '', budgetRange: customer.budgetRange ?? '', preferredLocation: customer.preferredLocation ?? '', notes: customer.notes ?? '', whatsappConsent: customer.whatsappConsent });
  }, [open, customer]);
  const save = useApiMutation(() => api(`/customers/${customer.id}`, { method: 'PATCH', body: { ...v, preferredPropertyType: v.preferredPropertyType || null, preferredLanguage: v.preferredLanguage || null } }), { success: 'Customer updated', invalidate: [['customer', customer.id], ['customers']], onSuccess: () => onOpenChange(false) });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit customer">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name"><Input value={v.fullName} onChange={set('fullName')} /></Field>
        <Field label="Email"><Input value={v.email} onChange={set('email')} /></Field>
        <Field label="Language"><Select value={v.preferredLanguage} onChange={set('preferredLanguage')}><option value="">—</option><option value="en">English</option><option value="hi">Hindi / Hinglish</option></Select></Field>
        <Field label="Property type"><Select value={v.preferredPropertyType} onChange={set('preferredPropertyType')}><option value="">—</option>{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
        <Field label="Budget"><Input value={v.budgetRange} onChange={set('budgetRange')} /></Field>
        <Field label="Location"><Input value={v.preferredLocation} onChange={set('preferredLocation')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={set('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.whatsappConsent} onChange={(e) => setV({ ...v, whatsappConsent: e.target.checked })} /> Customer consents to WhatsApp messages</label>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></div>
    </Dialog>
  );
}
