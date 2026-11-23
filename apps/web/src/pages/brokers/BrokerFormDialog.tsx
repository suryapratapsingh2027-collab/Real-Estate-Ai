import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BROKER_AVAILABILITY, PROPERTY_TYPES, brokerCreateSchema, humanize } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import type { Broker } from '@/types/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';

const formSchema = brokerCreateSchema.omit({ areas: true, specialization: true, password: true }).extend({
  areas: z.string().max(2000),
  specialization: z.array(z.enum(PROPERTY_TYPES)).default([]),
});
type In = z.input<typeof formSchema>;
type Out = z.output<typeof formSchema>;

export function BrokerFormDialog({ open, onOpenChange, broker }: { open: boolean; onOpenChange: (o: boolean) => void; broker?: Broker | null }) {
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<In, unknown, Out>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (!open) return;
    setTempPassword(null);
    reset(
      broker
        ? { fullName: broker.user.fullName, email: broker.user.email, phone: broker.phone, whatsappNumber: broker.whatsappNumber ?? '', areas: broker.areas.join(', '), specialization: broker.specialization, experienceYears: broker.experienceYears, availability: broker.availability, maxActiveLeads: broker.maxActiveLeads, status: broker.status }
        : { fullName: '', email: '', phone: '', whatsappNumber: '', areas: '', specialization: [], experienceYears: 0, availability: 'AVAILABLE', maxActiveLeads: 20, status: 'ACTIVE' },
    );
  }, [open, broker, reset]);

  const save = useApiMutation(
    (v: Out) => {
      const body = { ...v, whatsappNumber: v.whatsappNumber || null, areas: v.areas.split(',').map((s) => s.trim()).filter(Boolean) };
      return broker ? api<Broker>(`/brokers/${broker.id}`, { method: 'PATCH', body }) : api<Broker & { temporaryPassword: string | null }>('/brokers', { method: 'POST', body });
    },
    {
      success: broker ? 'Broker updated' : 'Broker created',
      invalidate: [['brokers'], ['broker', broker?.id]],
      onSuccess: (r) => {
        const t = (r as { temporaryPassword?: string | null }).temporaryPassword;
        if (t) setTempPassword(t);
        else onOpenChange(false);
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={broker ? 'Edit broker' : 'Add broker'} className="max-w-2xl">
      {tempPassword ? (
        <div className="space-y-3">
          <p className="text-sm">Broker account created. Share this one-time temporary password securely; it will not be shown again.</p>
          <code className="block rounded bg-secondary px-3 py-2 font-mono text-sm">{tempPassword}</code>
          <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Done</Button></div>
        </div>
      ) : (
        <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={handleSubmit((v) => save.mutateAsync(v))}>
          <Field label="Full name" error={errors.fullName?.message}><Input {...register('fullName')} /></Field>
          <Field label="Email" error={errors.email?.message}><Input type="email" {...register('email')} /></Field>
          <Field label="Phone" error={errors.phone?.message}><Input {...register('phone')} placeholder="+91…" /></Field>
          <Field label="WhatsApp number" hint="Defaults to phone" error={errors.whatsappNumber?.message}><Input {...register('whatsappNumber')} /></Field>
          <Field label="Assigned areas" hint="Comma-separated cities/localities used for lead matching" error={errors.areas?.message} className="sm:col-span-2"><Input {...register('areas')} placeholder="Bhopal, Arera Colony, Kolar Road" /></Field>
          <Field label="Specialization" className="sm:col-span-2">
            <div className="flex flex-wrap gap-3">
              {PROPERTY_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm"><input type="checkbox" value={t} {...register('specialization')} /> {humanize(t)}</label>
              ))}
            </div>
          </Field>
          <Field label="Experience (years)" error={errors.experienceYears?.message}><Input inputMode="numeric" {...register('experienceYears')} /></Field>
          <Field label="Max active leads" error={errors.maxActiveLeads?.message}><Input inputMode="numeric" {...register('maxActiveLeads')} /></Field>
          <Field label="Availability"><Select {...register('availability')}>{BROKER_AVAILABILITY.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</Select></Field>
          <Field label="Account status"><Select {...register('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>{broker ? 'Save' : 'Create broker'}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
