import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Plus } from 'lucide-react';
import { userCreateSchema, humanize } from '@rea/shared';
import { api } from '@/services/api';
import { usePagedList, useDebounced, useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRow } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { DemoBadge, PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/utils/format';

export function UsersPage() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const q = usePagedList<UserRow>('users', '/users', { search: useDebounced(search) });
  const update = useApiMutation((v: { id: string; body: Record<string, unknown> }) => api(`/users/${v.id}`, { method: 'PATCH', body: v.body }), { success: 'User updated', invalidate: [['users']] });
  return (
    <>
      <PageHeader title="Users" description="Admins and Super Admins. Broker accounts are created from the Brokers page." actions={<Button onClick={() => setOpen(true)}><Plus /> Add user</Button>} />
      <Card>
        <div className="border-b p-3"><Input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" aria-label="Search users" /></div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.items.length ? <EmptyState title="No users" /> : (
          <>
            <Table>
              <THead><TR><TH>User</TH><TH>Role</TH><TH>Status</TH><TH>Last login</TH><TH /></TR></THead>
              <TBody>
                {q.data.items.map((u) => (
                  <TR key={u.id}>
                    <TD><p className="font-medium">{u.fullName}<DemoBadge show={u.isDemo} /></p><p className="text-xs text-muted-foreground">{u.email}</p></TD>
                    <TD>
                      {u.role.name === 'BROKER' || u.id === me?.id ? <Badge>{humanize(u.role.name)}</Badge> : (
                        <Select className="h-8 w-36" value={u.role.name} onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value } })} aria-label="Role">
                          <option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option>
                        </Select>
                      )}
                    </TD>
                    <TD>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</TD>
                    <TD className="text-sm">{formatDate(u.lastLoginAt)}</TD>
                    <TD className="text-right">{u.id !== me?.id && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: u.id, body: { isActive: !u.isActive } })}>{u.isActive ? 'Disable' : 'Enable'}</Button>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.page} totalPages={q.data.totalPages} total={q.data.total} onPage={q.setPage} />
          </>
        )}
      </Card>
      <NewUserDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

type In = z.input<typeof userCreateSchema>;
type Out = z.output<typeof userCreateSchema>;
function NewUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<In, unknown, Out>({ resolver: zodResolver(userCreateSchema), defaultValues: { role: 'ADMIN' } });
  const create = useApiMutation((v: Out) => api('/users', { method: 'POST', body: v }), { success: 'User created', invalidate: [['users']], onSuccess: () => { reset(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add user">
      <form noValidate className="space-y-3" onSubmit={handleSubmit((v) => create.mutateAsync(v))}>
        <Field label="Full name" error={errors.fullName?.message}><Input {...register('fullName')} /></Field>
        <Field label="Email" error={errors.email?.message}><Input type="email" {...register('email')} /></Field>
        <Field label="Initial password" error={errors.password?.message} hint="10+ chars with upper, lower and a number"><Input type="password" autoComplete="new-password" {...register('password')} /></Field>
        <Field label="Role"><Select {...register('role')}><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option></Select></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={isSubmitting}>Create</Button></div>
      </form>
    </Dialog>
  );
}
