import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { changePasswordSchema, humanize } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { DetailRow, PageHeader } from '@/components/ui/page';

const pwSchema = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type Pw = z.infer<typeof pwSchema>;

export function ProfilePage() {
  const { user, reload, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.fullName ?? '');
  const saveName = useApiMutation(() => api('/profile', { method: 'PATCH', body: { fullName: name } }), { success: 'Profile updated', onSuccess: () => void reload() });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Pw>({ resolver: zodResolver(pwSchema) });
  const changePw = useApiMutation((v: Pw) => api('/profile/password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } }), {
    success: 'Password changed. Please sign in again.',
    onSuccess: async () => {
      await logout();
      navigate('/login');
    },
  });
  if (!user) return null;
  return (
    <>
      <PageHeader title="Profile" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <dl className="divide-y"><DetailRow label="Email">{user.email}</DetailRow><DetailRow label="Role">{humanize(user.role)}</DetailRow></dl>
            <div className="flex items-end gap-2">
              <Field label="Full name" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button loading={saveName.isPending} disabled={name.trim().length < 2 || name === user.fullName} onClick={() => saveName.mutate(undefined)}>Save</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Change password</CardTitle><CardDescription>All your sessions will be signed out.</CardDescription></CardHeader>
          <CardContent>
            <form noValidate className="space-y-3" onSubmit={handleSubmit((v) => changePw.mutateAsync(v))}>
              <Field label="Current password" error={errors.currentPassword?.message}><Input type="password" autoComplete="current-password" {...register('currentPassword')} /></Field>
              <Field label="New password" error={errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...register('newPassword')} /></Field>
              <Field label="Confirm new password" error={errors.confirm?.message}><Input type="password" autoComplete="new-password" {...register('confirm')} /></Field>
              <Button type="submit" loading={isSubmitting}>Change password</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
