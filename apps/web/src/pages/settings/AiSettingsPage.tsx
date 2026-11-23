import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { aiSettingsSchema } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { ErrorState, TableSkeleton } from '@/components/ui/feedback';

const formSchema = aiSettingsSchema.extend({ languages: z.string() });
type In = z.input<typeof formSchema>;
type Out = z.output<typeof formSchema>;
type AiSettings = z.output<typeof aiSettingsSchema>;

export function AiSettingsPage() {
  const { can } = useAuth();
  const editable = can('settings:ai');
  const q = useQuery({ queryKey: ['settings', 'ai'], queryFn: () => api<AiSettings>('/settings/ai') });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<In, unknown, Out>({ resolver: zodResolver(formSchema) });
  useEffect(() => {
    if (q.data) reset({ ...q.data, languages: q.data.languages.join(', '), voice: { ...q.data.voice, voiceId: q.data.voice.voiceId ?? '' } });
  }, [q.data, reset]);
  const save = useApiMutation((v: Out) => api('/settings/ai', { method: 'PUT', body: { ...v, languages: v.languages.split(',').map((s) => s.trim()).filter(Boolean), voice: { ...v.voice, voiceId: v.voice.voiceId || null } } }), { success: 'AI settings saved', invalidate: [['settings', 'ai']] });

  if (q.isLoading) return <TableSkeleton />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader title="AI settings" description={editable ? 'Configure the WhatsApp assistant and voice agent.' : 'Only a Super Admin can change AI settings.'} />
      <form noValidate onSubmit={handleSubmit((v) => save.mutateAsync(v))}>
        <fieldset disabled={!editable} className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Model</CardTitle><CardDescription>“Mock” is a deterministic rule-based responder for demos and testing — it never calls an external API.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Provider"><Select {...register('provider')}><option value="groq">Groq</option><option value="mock">Mock (demo)</option></Select></Field>
              <Field label="Model" error={errors.model?.message} hint="e.g. llama-3.3-70b-versatile"><Input {...register('model')} /></Field>
              <Field label="Temperature" error={errors.temperature?.message}><Input inputMode="decimal" {...register('temperature')} /></Field>
              <Field label="Languages" hint="Comma-separated" className="sm:col-span-3"><Input {...register('languages')} /></Field>
              <Field label="Additional system instructions" hint="Appended to the built-in prompt. The built-in rules against inventing listings always apply." className="sm:col-span-3"><Textarea rows={5} {...register('systemPromptAddendum')} /></Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Lead qualification rules</CardTitle><CardDescription>A lead is only created as qualified when these fields are known.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" {...register('qualificationRules.requireLocation')} /> Require location</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('qualificationRules.requireBudget')} /> Require budget</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('qualificationRules.requirePropertyType')} /> Require property type</label>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Voice AI</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="TTS provider"><Select {...register('voice.ttsProvider')}><option value="cartesia">Cartesia</option><option value="elevenlabs">ElevenLabs</option></Select></Field>
              <Field label="Voice ID (optional)"><Input {...register('voice.voiceId')} /></Field>
              <Field label="Max call minutes" error={errors.voice?.maxCallMinutes?.message}><Input inputMode="numeric" {...register('voice.maxCallMinutes')} /></Field>
              <Field label="Greeting" className="sm:col-span-3"><Input {...register('voice.greeting')} /></Field>
            </CardContent>
          </Card>
          {editable && <div className="flex justify-end"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button></div>}
        </fieldset>
      </form>
    </>
  );
}
