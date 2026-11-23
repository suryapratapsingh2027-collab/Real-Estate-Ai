import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Copy, MessageSquare, Phone, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { LEAD_STATUSES, humanize, type LeadStatus } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Lead } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { DemoBadge, DetailRow, PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { formatDate, formatDuration, formatINR, timeAgo } from '@/utils/format';

export function LeadDetailsPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const key = ['lead', id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Lead>(`/leads/${id}`) });
  const [note, setNote] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [callLink, setCallLink] = useState<string | null>(null);

  const updateStatus = useApiMutation((body: { status: LeadStatus; lostReason?: string }) => api(`/leads/${id}`, { method: 'PATCH', body }), { success: 'Status updated', invalidate: [key, ['leads'], ['dashboard']] });
  const addNote = useApiMutation(() => api(`/leads/${id}/notes`, { method: 'POST', body: { note } }), { success: 'Note added', invalidate: [key], onSuccess: () => setNote('') });
  const createCall = useApiMutation((sendLink: boolean) => api<{ link: string | null }>(`/leads/${id}/call`, { method: 'POST', body: { sendLink } }), {
    invalidate: [key, ['calls']],
    onSuccess: (r, sendLink) => {
      if (sendLink) toast.success('Call link sent to the customer on WhatsApp');
      else setCallLink(r.link);
    },
  });

  if (q.isLoading) return <TableSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const l = q.data;
  const canWrite = can('lead:write');

  return (
    <>
      <PageHeader
        back="/leads"
        title={<>{l.leadNumber}<DemoBadge show={l.isDemo} /></>}
        description={<>{l.customer?.fullName ?? 'Unknown'} · {l.customer?.phone} · created {timeAgo(l.createdAt)}</>}
        actions={
          <>
            {l.customer?.id && <Button variant="outline" asChild><Link to={`/customers/${l.customer.id}`}>Customer</Link></Button>}
            {can('call:create') && <Button variant="outline" loading={createCall.isPending} onClick={() => createCall.mutate(true)}><Phone /> Send AI call link</Button>}
            {can('lead:assign') && <Button variant="outline" onClick={() => setAssignOpen(true)}><UserCog /> Assign</Button>}
          </>
        }
      />
      {callLink && (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-accent px-3 py-2 text-sm">
          Call link: <code className="truncate">{callLink}</code>
          <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(callLink).then(() => toast.success('Copied'))}><Copy /></Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2"><StatusBadge status={l.status} />{l.isQualified && <Badge tone="blue">Qualified</Badge>}</div>
              {canWrite && (
                <Select
                  aria-label="Change status"
                  value={l.status}
                  onChange={(e) => {
                    const s = e.target.value as LeadStatus;
                    if (s === 'LOST') setLostOpen(true);
                    else updateStatus.mutate({ status: s });
                  }}
                >
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </Select>
              )}
              {l.lostReason && <p className="text-sm text-muted-foreground">Lost reason: {l.lostReason}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Requirement</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="Property">{l.propertyType ? humanize(l.propertyType) : '—'}{l.listingType ? ` (${humanize(l.listingType)})` : ''}</DetailRow>
                <DetailRow label="Bedrooms">{l.bedrooms != null ? `${l.bedrooms} BHK` : '—'}</DetailRow>
                <DetailRow label="Location">{l.preferredLocation ?? '—'}</DetailRow>
                <DetailRow label="Budget">{l.budgetRange ?? '—'}{l.budgetMax ? <span className="text-xs text-muted-foreground"> ({l.budgetMin ? `${formatINR(l.budgetMin)}–` : 'up to '}{formatINR(l.budgetMax)})</span> : null}</DetailRow>
                <DetailRow label="Urgency">{humanize(l.urgency)}</DetailRow>
                <DetailRow label="Source">{humanize(l.source)}</DetailRow>
                <DetailRow label="Summary">{l.summary ?? '—'}</DetailRow>
                <DetailRow label="First message">{l.originalMessage ?? '—'}</DetailRow>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Assignment</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{l.broker?.user.fullName ?? 'Unassigned'}</p>
              {l.assignedAt && <p className="text-muted-foreground">Assigned {formatDate(l.assignedAt)}</p>}
              {l.assignmentReason && <p className="rounded bg-secondary p-2 text-xs text-slate-700">{l.assignmentReason}</p>}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Follow-ups</CardTitle>
              {can('followup:write') && <Button size="sm" variant="outline" onClick={() => setFollowOpen(true)}><CalendarPlus /> Schedule</Button>}
            </CardHeader>
            <CardContent className="space-y-2">
              {!l.followUps?.length ? <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p> : l.followUps.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                  <div><p className="font-medium">{f.title}</p><p className="text-xs text-muted-foreground">{formatDate(f.dueAt)}{f.assignee ? ` · ${f.assignee.fullName}` : ''}</p></div>
                  <StatusBadge status={f.status === 'PENDING' && new Date(f.dueAt) < new Date() ? 'FAILED' : f.status} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">AI voice calls</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!l.voiceCalls?.length ? <p className="text-sm text-muted-foreground">No calls yet.</p> : l.voiceCalls.map((c) => (
                <Link key={c.id} to={`/calls/${c.id}`} className="block rounded-md border p-2.5 text-sm hover:bg-secondary/40">
                  <div className="flex items-center justify-between"><span>{formatDate(c.createdAt)} · {formatDuration(c.durationSeconds)}</span><StatusBadge status={c.status} /></div>
                  {c.summary && <p className="mt-1 text-xs text-muted-foreground">{c.summary}</p>}
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Notes & activity</CardTitle></CardHeader>
            <CardContent>
              {canWrite && (
                <div className="mb-4 flex gap-2">
                  <Textarea rows={2} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
                  <Button disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate(undefined)}>Add</Button>
                </div>
              )}
              {!l.activities?.length ? <EmptyState title="No activity" /> : (
                <ol className="space-y-3">
                  {l.activities.map((a) => (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <Badge tone={a.type === 'NOTE' ? 'amber' : a.type.includes('ASSIGN') ? 'violet' : 'gray'} className="h-fit">{humanize(a.type)}</Badge>
                      <div><p className="whitespace-pre-line">{a.message}</p><p className="text-xs text-muted-foreground">{formatDate(a.createdAt)}{a.actor ? ` · ${a.actor.fullName}` : ' · System'}</p></div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          {!!l.notifications?.length && (
            <Card>
              <CardHeader><CardTitle className="text-base"><MessageSquare className="mr-1 inline h-4 w-4" />WhatsApp notifications</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {l.notifications.map((n) => (
                  <div key={n.id} className="flex items-center justify-between text-sm">
                    <span>{humanize(n.type)} <span className="text-xs text-muted-foreground">· {timeAgo(n.createdAt)}{n.lastError ? ` · ${n.lastError}` : ''}</span></span>
                    <StatusBadge status={n.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} leadId={l.id} />
      <FollowUpDialog open={followOpen} onOpenChange={setFollowOpen} leadId={l.id} />
      <LostDialog open={lostOpen} onOpenChange={setLostOpen} onSubmit={(reason) => updateStatus.mutateAsync({ status: 'LOST', lostReason: reason })} />
    </>
  );
}

function AssignDialog({ open, onOpenChange, leadId }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string }) {
  const brokers = useQuery({ queryKey: ['brokers', 'options'], queryFn: () => api<Array<{ id: string; fullName: string; areas: string[]; activeLeads: number; maxActiveLeads: number; availability: string }>>('/brokers/options'), enabled: open });
  const [brokerId, setBrokerId] = useState('');
  const [reason, setReason] = useState('');
  const assign = useApiMutation((body: { auto?: boolean; brokerId?: string; reason?: string }) => api<{ reason: string }>(`/leads/${leadId}/assign`, { method: 'POST', body }), {
    invalidate: [['lead', leadId], ['leads']],
    onSuccess: (r) => {
      toast.success(r.reason);
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Assign lead" description="Auto-assignment uses location, availability and workload.">
      <div className="space-y-3">
        <Button variant="secondary" className="w-full" loading={assign.isPending} onClick={() => assign.mutate({ auto: true })}>Auto-assign best broker</Button>
        <div className="text-center text-xs text-muted-foreground">or choose manually</div>
        <Field label="Broker">
          <Select value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
            <option value="">Select broker…</option>
            {brokers.data?.map((b) => <option key={b.id} value={b.id}>{b.fullName} — {b.activeLeads}/{b.maxActiveLeads} active · {b.areas.join(', ')}{b.availability !== 'AVAILABLE' ? ` (${humanize(b.availability)})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!brokerId} loading={assign.isPending} onClick={() => assign.mutate({ brokerId, reason: reason || undefined })}>Assign</Button></div>
      </div>
    </Dialog>
  );
}

function FollowUpDialog({ open, onOpenChange, leadId }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string }) {
  const [title, setTitle] = useState('Call customer');
  const [dueAt, setDueAt] = useState('');
  const [description, setDescription] = useState('');
  const save = useApiMutation(() => api('/follow-ups', { method: 'POST', body: { leadId, title, dueAt: new Date(dueAt).toISOString(), description } }), { success: 'Follow-up scheduled', invalidate: [['lead', leadId], ['follow-ups']], onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Schedule follow-up" description="The assigned broker gets an in-app and WhatsApp reminder when it is due.">
      <div className="space-y-3">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Due"><Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
        <Field label="Details"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!dueAt || title.length < 2} loading={save.isPending} onClick={() => save.mutate(undefined)}>Schedule</Button></div>
      </div>
    </Dialog>
  );
}

function LostDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Mark lead as lost" description="A reason helps improve future qualification.">
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Bought elsewhere, budget mismatch…" /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="destructive" disabled={!reason.trim()} loading={busy} onClick={async () => { setBusy(true); try { await onSubmit(reason); onOpenChange(false); } finally { setBusy(false); } }}>Mark lost</Button>
      </div>
    </Dialog>
  );
}
