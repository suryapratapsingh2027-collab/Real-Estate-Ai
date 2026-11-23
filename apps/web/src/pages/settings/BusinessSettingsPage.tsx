import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { businessSettingsSchema } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { ErrorState, TableSkeleton } from '@/components/ui/feedback';

type In = z.input<typeof businessSettingsSchema>;
type Out = z.output<typeof businessSettingsSchema>;

export function BusinessSettingsPage() {
  const q = useQuery({ queryKey: ['settings', 'business'], queryFn: () => api<Out>('/settings/business') });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<In, unknown, Out>({ resolver: zodResolver(businessSettingsSchema) });
  useEffect(() => {
    if (q.data) reset({ ...q.data, businessPhone: q.data.businessPhone ?? '', businessWhatsapp: q.data.businessWhatsapp ?? '', businessAddress: q.data.businessAddress ?? '', businessEmail: q.data.businessEmail ?? '', logoUrl: q.data.logoUrl ?? '', workingHours: q.data.workingHours ?? '' });
  }, [q.data, reset]);
  const save = useApiMutation((v: Out) => api('/settings/business', { method: 'PUT', body: v }), { success: 'Business settings saved', invalidate: [['settings', 'business']] });

  if (q.isLoading) return <TableSkeleton />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader title="Business settings" />
      <form noValidate onSubmit={handleSubmit((v) => save.mutateAsync(v))} className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Business profile</CardTitle><CardDescription>Used in AI replies, notifications and the customer call page.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" error={errors.businessName?.message}><Input {...register('businessName')} /></Field>
            <Field label="Business email" error={errors.businessEmail?.message}><Input type="email" {...register('businessEmail')} /></Field>
            <Field label="Business phone"><Input {...register('businessPhone')} /></Field>
            <Field label="Business WhatsApp number"><Input {...register('businessWhatsapp')} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} {...register('businessAddress')} /></Field>
            <Field label="Logo URL"><Input {...register('logoUrl')} placeholder="https://…" /></Field>
            <Field label="Working hours"><Input {...register('workingHours')} /></Field>
            <Field label="Timezone"><Input {...register('timezone')} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Lead assignment</CardTitle></CardHeader>
          <CardContent className="max-w-md">
            <Field label="Fallback when no broker covers the location" hint="Primary rule is always: location match → availability → lowest workload.">
              <Select {...register('fallbackPolicy')}>
                <option value="LEAST_LOADED_ANY_AREA">Assign to least-loaded available broker (any area)</option>
                <option value="UNASSIGNED_QUEUE">Leave unassigned for manual assignment</option>
              </Select>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Call recording</CardTitle><CardDescription>Requires S3-compatible storage and LiveKit Egress. Customers are asked for consent on the call page; calls are only recorded when they agree.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('recordingEnabled')} /> Enable call recording (with consent)</label>
            <Field label="Retention (days)" error={errors.recordingRetentionDays?.message} hint="Recordings are deleted automatically after this period."><Input inputMode="numeric" {...register('recordingRetentionDays')} /></Field>
          </CardContent>
        </Card>
        <div className="flex justify-end"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button></div>
      </form>
    </>
  );
}
