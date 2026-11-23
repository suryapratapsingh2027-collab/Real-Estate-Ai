import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Plug, XCircle } from 'lucide-react';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Integration } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/ui/badge';
import { formatDate, humanize } from '@/utils/format';

const HELP: Record<Integration['key'], string> = {
  whatsapp: 'Meta WhatsApp Cloud API. Webhook URL: <your domain>/api/webhooks/whatsapp. Optional broker/reminder template names are needed to message brokers outside the 24-hour window.',
  groq: 'Groq LLM for the WhatsApp assistant and summaries. Switch the AI provider to Groq in AI Settings after testing.',
  livekit: 'LiveKit server (Cloud or self-hosted) for browser voice calls. Configure the webhook URL <your domain>/api/webhooks/livekit in LiveKit.',
  tts: 'Text-to-speech used by the Python voice agent. The agent reads its own environment; keys here are used for status checks.',
  storage: 'Property images and call recordings. "local" stores on disk; "s3" uses any S3-compatible bucket (required for recordings).',
};

export function IntegrationSettingsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api<Integration[]>('/integrations') });
  const [editing, setEditing] = useState<Integration | null>(null);
  const test = useApiMutation((key: string) => api<{ ok: boolean; message: string }>(`/integrations/${key}/test`, { method: 'POST' }), {
    invalidate: [['integrations']],
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
  });
  if (q.isLoading) return <TableSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const manage = can('settings:integrations');
  return (
    <>
      <PageHeader title="Integrations" description="Secrets are encrypted at rest and never shown again — only whether a value is set." />
      <div className="grid gap-4 md:grid-cols-2">
        {q.data.map((i) => (
          <Card key={i.key}>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Plug className="h-4 w-4" />{i.name}</CardTitle>
                <CardDescription className="mt-1">{HELP[i.key]}</CardDescription>
              </div>
              <StatusBadge status={i.enabled ? i.status : 'INACTIVE'} />
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {i.configFields.map((f) => (
                  <li key={f} className="flex justify-between gap-2 truncate"><span className="text-muted-foreground">{humanize(f.replace(/([A-Z])/g, '_$1'))}</span><span className="truncate">{i.config[f] ?? '—'}</span></li>
                ))}
                {Object.entries(i.secretFields).map(([f, s]) => (
                  <li key={f} className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{humanize(f.replace(/([A-Z])/g, '_$1'))}</span>{s.hasValue ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{s.last4 ? `••••${s.last4}` : 'set'}</span> : <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="h-3.5 w-3.5" />not set</span>}</li>
                ))}
              </ul>
              {i.lastError && <p className="rounded bg-red-50 p-2 text-xs text-destructive">{i.lastError}</p>}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{i.lastCheckedAt ? `Last tested ${formatDate(i.lastCheckedAt)}` : 'Not tested yet'}</span>
                {manage && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(i)}>Configure</Button>
                    <Button size="sm" variant="secondary" loading={test.isPending && test.variables === i.key} onClick={() => test.mutate(i.key)}>Test</Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && <ConfigureDialog integration={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ConfigureDialog({ integration, onClose }: { integration: Integration; onClose: () => void }) {
  const [config, setConfig] = useState<Record<string, string>>({ ...integration.config });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(integration.enabled);
  const save = useApiMutation(() => api(`/integrations/${integration.key}`, { method: 'PATCH', body: { enabled, config, secrets } }), { success: 'Integration saved', invalidate: [['integrations']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Configure ${integration.name}`} description="Values saved here override environment variables. Leave a secret blank to keep the current value.">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
        {integration.configFields.map((f) => (
          <Field key={f} label={humanize(f.replace(/([A-Z])/g, '_$1'))}><Input value={config[f] ?? ''} onChange={(e) => setConfig({ ...config, [f]: e.target.value })} /></Field>
        ))}
        {Object.entries(integration.secretFields).map(([f, s]) => (
          <Field key={f} label={humanize(f.replace(/([A-Z])/g, '_$1'))} hint={s.hasValue ? 'A value is set. Enter a new one to replace it.' : undefined}>
            <Input type="password" autoComplete="new-password" value={secrets[f] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f]: e.target.value })} placeholder={s.hasValue ? '••••••••' : ''} />
          </Field>
        ))}
        <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></div>
      </div>
    </Dialog>
  );
}
