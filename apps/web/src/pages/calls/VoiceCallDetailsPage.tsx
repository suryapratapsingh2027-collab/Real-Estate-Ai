import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, PlayCircle, User } from 'lucide-react';
import { humanize } from '@rea/shared';
import { api } from '@/services/api';
import { errorMessage } from '@/hooks/useApi';
import type { VoiceCall } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailRow, PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/ui/badge';
import { cn } from '@/utils/cn';
import { formatDate, formatDuration } from '@/utils/format';

const RECORDING_TEXT: Record<string, string> = {
  NOT_REQUESTED: 'Recording is disabled in Business Settings.',
  NO_CONSENT: 'Customer did not consent to recording.',
  UNAVAILABLE: 'Recording requires S3-compatible storage to be configured.',
  RECORDING: 'Recording in progress / processing.',
  FAILED: 'Recording failed.',
  DELETED: 'Recording deleted by the retention policy.',
};

export function VoiceCallDetailsPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['call', id], queryFn: () => api<VoiceCall>(`/voice/calls/${id}`) });
  const [audio, setAudio] = useState<string | null>(null);
  const [recErr, setRecErr] = useState<string | null>(null);
  if (q.isLoading) return <TableSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const segments = c.transcript?.segments ?? [];
  return (
    <>
      <PageHeader back="/calls" title={`Call with ${c.customer.fullName ?? c.customer.phone}`} description={`${formatDate(c.createdAt)} · room ${c.roomName}`} actions={c.lead && <Button variant="outline" asChild><Link to={`/leads/${c.lead.id}`}>Open lead</Link></Button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Call</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="Status"><StatusBadge status={c.status} /></DetailRow>
                <DetailRow label="Started">{formatDate(c.startedAt)}</DetailRow>
                <DetailRow label="Ended">{formatDate(c.endedAt)}</DetailRow>
                <DetailRow label="Duration">{formatDuration(c.durationSeconds)}</DetailRow>
                <DetailRow label="Lead">{c.lead ? `LD-${String(c.lead.number).padStart(6, '0')}` : '—'}</DetailRow>
                {c.failureReason && <DetailRow label="Issue">{c.failureReason}</DetailRow>}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Captured requirement</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="Property">{c.propertyType ? humanize(c.propertyType) : '—'}</DetailRow>
                <DetailRow label="Budget">{c.budget ?? '—'}</DetailRow>
                <DetailRow label="Location">{c.preferredLocation ?? '—'}</DetailRow>
                <DetailRow label="Urgency">{c.urgency ? humanize(c.urgency) : '—'}</DetailRow>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Recording</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {c.recordingStatus === 'AVAILABLE' ? (
                audio ? <audio controls src={audio} className="w-full" /> : (
                  <Button variant="outline" onClick={async () => { try { setAudio((await api<{ url: string }>(`/voice/calls/${c.id}/recording`)).url); } catch (e) { setRecErr(errorMessage(e)); } }}><PlayCircle /> Load recording</Button>
                )
              ) : <p className="text-muted-foreground">{RECORDING_TEXT[c.recordingStatus] ?? 'Not available.'}</p>}
              {recErr && <p className="text-destructive">{recErr}</p>}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">AI summary</CardTitle></CardHeader>
            <CardContent className="text-sm">{c.summary ?? <span className="text-muted-foreground">No summary yet. It is saved by the voice agent when the call ends.</span>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Transcript</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!segments.length ? <EmptyState title="No transcript" /> : segments.map((s, i) => (
                <div key={i} className={cn('flex gap-2', s.role === 'user' ? '' : 'flex-row-reverse text-right')}>
                  <span className="mt-0.5 shrink-0 rounded-full bg-secondary p-1">{s.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}</span>
                  <p className={cn('rounded-lg px-3 py-1.5 text-sm', s.role === 'user' ? 'bg-white shadow-sm' : 'bg-teal-50')}>{s.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
