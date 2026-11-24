import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, FlaskConical, Hand, MessageSquare, RefreshCw, Send, User } from 'lucide-react';
import { api, type Paged } from '@/services/api';
import { usePagedList, useDebounced, useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Conversation, Message } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, Skeleton, TableSkeleton } from '@/components/ui/feedback';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { cn } from '@/utils/cn';
import { formatDate, initials, timeAgo } from '@/utils/format';

export function ConversationsPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [takeover, setTakeover] = useState('');
  const [from, setFrom] = useState('');
  const [brokerId, setBrokerId] = useState('');
  const [simOpen, setSimOpen] = useState(false);
  const brokers = useQuery({ queryKey: ['brokers', 'options'], queryFn: () => api<Array<{ id: string; fullName: string }>>('/brokers/options'), enabled: can('lead:assign') });
  const list = usePagedList<Conversation>('conversations', '/conversations', { search: useDebounced(search), takeover, brokerId, from: from || undefined }, 25);

  return (
    <>
      <PageHeader
        title="Conversations"
        description="WhatsApp inbox. AI replies automatically unless a team member takes over."
        actions={can('settings:business') && <Button variant="outline" onClick={() => setSimOpen(true)}><FlaskConical /> Simulate message</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className={cn('flex flex-col', id && 'hidden lg:flex')}>
          <div className="space-y-2 border-b p-3">
            <Input placeholder="Search name, phone, message" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search conversations" />
            <div className="grid grid-cols-2 gap-2">
              <Select value={takeover} onChange={(e) => setTakeover(e.target.value)} aria-label="Handling"><option value="">All</option><option value="false">AI handling</option><option value="true">Human takeover</option></Select>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Since date" />
            </div>
            {brokers.data && (
              <Select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} aria-label="Broker"><option value="">All brokers</option>{brokers.data.map((b) => <option key={b.id} value={b.id}>{b.fullName}</option>)}</Select>
            )}
          </div>
          {list.isLoading ? <TableSkeleton /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.items.length ? (
            <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No conversations" description="Messages to your WhatsApp number appear here." />
          ) : (
            <ul className="flex-1 divide-y overflow-y-auto">
              {list.data.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/conversations/${c.id}`} className={cn('flex gap-3 px-3 py-3 hover:bg-secondary/50', c.id === id && 'bg-accent')}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(c.customer.fullName ?? c.customer.phone)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{c.customer.fullName ?? c.customer.phone}</p><span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(c.lastMessageAt)}</span></div>
                      <p className="truncate text-xs text-muted-foreground">{c.lastMessageText ?? '—'}</p>
                      <div className="mt-1 flex gap-1">{c.humanTakeover && <Badge tone="amber">Human</Badge>}{c.unreadCount > 0 && <Badge tone="teal">{c.unreadCount} new</Badge>}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {list.data && <Pagination page={list.page} totalPages={list.data.totalPages} total={list.data.total} onPage={list.setPage} />}
        </Card>
        <div className={cn(!id && 'hidden lg:block')}>{id ? <ConversationThread id={id} /> : <Card><EmptyState title="Select a conversation" description="Pick a chat on the left to view messages." /></Card>}</div>
      </div>
      <SimulateDialog open={simOpen} onOpenChange={setSimOpen} />
    </>
  );
}

function ConversationThread({ id }: { id: string }) {
  const { can } = useAuth();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const convo = useQuery({ queryKey: ['conversation', id], queryFn: () => api<Conversation>(`/conversations/${id}`) });
  const msgs = useQuery({ queryKey: ['messages', id], queryFn: () => api<Paged<Message>>(`/conversations/${id}/messages`, { query: { pageSize: 200 } }) });
  // Block body on purpose: newer browsers return a Promise from scrollIntoView(), and React
  // would treat any returned value as a cleanup function and crash calling it.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.data?.items.length]);

  const reply = useApiMutation(() => api(`/conversations/${id}/reply`, { method: 'POST', body: { text } }), { invalidate: [['messages', id], ['conversations']], onSuccess: () => setText('') });
  const takeover = useApiMutation((active: boolean) => api(`/conversations/${id}/takeover`, { method: 'POST', body: { active } }), { success: 'Updated', invalidate: [['conversation', id], ['conversations']] });
  const summarize = useApiMutation(() => api(`/conversations/${id}/summary`, { method: 'POST' }), { success: 'Summary refreshed', invalidate: [['conversation', id]] });

  if (convo.isLoading) return <Card className="p-6"><Skeleton className="h-96 w-full" /></Card>;
  if (convo.isError || !convo.data) return <Card><ErrorState error={convo.error} /></Card>;
  const c = convo.data;
  const canReply = can('conversation:reply');

  return (
    <Card className="flex h-[calc(100vh-11rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <Link to={`/customers/${c.customer.id}`} className="font-medium hover:underline">{c.customer.fullName ?? c.customer.phone}</Link>
          <p className="text-xs text-muted-foreground">{c.customer.phone} {c.customer.leads?.[0] && <>· <Link className="hover:underline" to={`/leads/${c.customer.leads[0].id}`}>LD-{String(c.customer.leads[0].number).padStart(6, '0')}</Link> <StatusBadge status={c.customer.leads[0].status} /></>}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" loading={summarize.isPending} onClick={() => summarize.mutate(undefined)}><RefreshCw /> Summary</Button>
          {canReply && (c.humanTakeover ? <Button size="sm" variant="secondary" onClick={() => takeover.mutate(false)}><Bot /> Hand back to AI</Button> : <Button size="sm" onClick={() => takeover.mutate(true)}><Hand /> Take over</Button>)}
        </div>
      </div>
      {c.summary && <div className="border-b bg-secondary/40 px-4 py-2 text-xs text-slate-700"><span className="font-medium">AI summary:</span> {c.summary}</div>}
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">
        {msgs.isLoading ? <Skeleton className="h-40 w-full" /> : msgs.data?.items.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>
      {canReply && (
        <div className="border-t p-3">
          {!c.windowOpen ? (
            <p className="text-sm text-muted-foreground">The 24-hour WhatsApp window is closed. You can reply after the customer messages again.</p>
          ) : !c.humanTakeover ? (
            <p className="text-sm text-muted-foreground">AI is handling this conversation. Take over to reply manually.</p>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) reply.mutate(undefined); }}>
              <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply…" aria-label="Reply" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) reply.mutate(undefined); } }} />
              <Button type="submit" loading={reply.isPending} disabled={!text.trim()} aria-label="Send"><Send /></Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

function Bubble({ m }: { m: Message }) {
  const inbound = m.direction === 'INBOUND';
  const who = inbound ? 'Customer' : m.sender === 'AI' ? 'AI' : m.sender === 'HUMAN' ? m.senderUser?.fullName ?? 'Team' : 'System';
  return (
    <div className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
      <div className={cn('max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm', inbound ? 'bg-white' : m.sender === 'AI' ? 'bg-teal-50' : m.sender === 'SYSTEM' ? 'bg-slate-100' : 'bg-sky-50')}>
        <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          {inbound ? <User className="h-3 w-3" /> : m.sender === 'AI' ? <Bot className="h-3 w-3" /> : null}
          {who}
          {m.aiMeta?.qualified && <Badge tone="blue" className="ml-1 px-1 py-0 text-[10px]">qualified</Badge>}
          {m.aiMeta?.fallback && <Badge tone="amber" className="ml-1 px-1 py-0 text-[10px]">fallback</Badge>}
        </div>
        <p className="whitespace-pre-line break-words">{m.body}</p>
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
          <span title={formatDate(m.createdAt)}>{new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          {!inbound && <StatusBadge status={m.status} className="px-1 py-0 text-[10px]" />}
        </div>
        {m.error && <p className="mt-1 text-[11px] text-destructive">{m.error}</p>}
      </div>
    </div>
  );
}

function SimulateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [v, setV] = useState({ phone: '+919800012345', name: 'Test Customer', text: 'Hi, I need a 2 BHK flat in Arera Colony, budget 50-70 lakhs' });
  const sim = useApiMutation(() => api<{ conversationId?: string }>('/conversations/simulate', { method: 'POST', body: v }), {
    success: 'Message injected — the AI reply will appear in a moment',
    invalidate: [['conversations']],
    onSuccess: (r) => {
      onOpenChange(false);
      if (r.conversationId) navigate(`/conversations/${r.conversationId}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Simulate an inbound WhatsApp message" description="Runs the same pipeline as the Meta webhook (AI → qualification → assignment). Outbound sends are skipped if WhatsApp is not configured.">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
          <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        </div>
        <Field label="Message"><Textarea value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={sim.isPending} onClick={() => sim.mutate(undefined)}>Send</Button></div>
      </div>
    </Dialog>
  );
}