import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { AREA_UNITS, AVAILABILITY, FURNISHING, LISTING_TYPES, PROPERTY_TYPES, humanize, propertyBaseSchema } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import type { Property } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { ErrorState, TableSkeleton } from '@/components/ui/feedback';

/** Form schema: same rules as the API, with amenities typed as comma-separated text. */
export const propertyFormSchema = propertyBaseSchema.extend({
  amenities: z.string().max(1000).default(''),
  brokerId: z.string().optional().nullable().transform((v) => (v ? v : null)),
  furnishing: z.enum(FURNISHING).or(z.literal('')).optional().nullable().transform((v) => (v ? v : null)),
  bedrooms: z.union([z.literal(''), z.coerce.number().int().min(0).max(50)]).optional().nullable().transform((v) => (v === '' || v == null ? null : v)),
  bathrooms: z.union([z.literal(''), z.coerce.number().int().min(0).max(50)]).optional().nullable().transform((v) => (v === '' || v == null ? null : v)),
  area: z.union([z.literal(''), z.coerce.number().positive()]).optional().nullable().transform((v) => (v === '' || v == null ? null : v)),
});
type FormIn = z.input<typeof propertyFormSchema>;
type FormOut = z.output<typeof propertyFormSchema>;

export function PropertyFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const existing = useQuery({ queryKey: ['property', id], queryFn: () => api<Property>(`/properties/${id}`), enabled: editing });
  const brokers = useQuery({ queryKey: ['brokers', 'options'], queryFn: () => api<Array<{ id: string; fullName: string }>>('/brokers/options') });
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: { propertyType: 'APARTMENT', listingType: 'SALE', areaUnit: 'SQFT', availability: 'AVAILABLE', amenities: '', state: '' },
  });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form;

  useEffect(() => {
    if (existing.data) {
      const p = existing.data;
      reset({ ...p, areaUnit: p.areaUnit as FormIn['areaUnit'], amenities: p.amenities.join(', '), price: p.price, area: p.area ?? '', bedrooms: p.bedrooms ?? '', bathrooms: p.bathrooms ?? '', brokerId: p.brokerId ?? '', furnishing: (p.furnishing as FormIn['furnishing']) ?? '', description: p.description ?? '', address: p.address ?? '', priceRange: p.priceRange ?? '' });
    }
  }, [existing.data, reset]);

  const save = useApiMutation(
    (v: FormOut) => {
      const body = { ...v, amenities: v.amenities.split(',').map((s) => s.trim()).filter(Boolean) };
      return editing ? api<Property>(`/properties/${id}`, { method: 'PATCH', body }) : api<Property>('/properties', { method: 'POST', body });
    },
    { success: editing ? 'Property updated' : 'Property created', invalidate: [['properties'], ['property', id]], onSuccess: (p) => navigate(`/properties/${p.id}`) },
  );

  if (editing && existing.isLoading) return <TableSkeleton />;
  if (editing && existing.isError) return <ErrorState error={existing.error} />;

  return (
    <>
      <PageHeader title={editing ? 'Edit property' : 'Add property'} back={editing ? `/properties/${id}` : '/properties'} />
      <form onSubmit={handleSubmit((v) => save.mutateAsync(v))} noValidate className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Listing</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" error={errors.title?.message} className="sm:col-span-2"><Input {...register('title')} /></Field>
            <Field label="Description" error={errors.description?.message} className="sm:col-span-2"><Textarea rows={3} {...register('description')} /></Field>
            <Field label="Property type" error={errors.propertyType?.message}>
              <Select {...register('propertyType')}>{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
            </Field>
            <Field label="Listing type" error={errors.listingType?.message}>
              <Select {...register('listingType')}>{LISTING_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
            </Field>
            <Field label="Price (₹)" error={errors.price?.message} hint="Monthly rent for rentals"><Input inputMode="numeric" {...register('price')} /></Field>
            <Field label="Price range label (optional)" error={errors.priceRange?.message}><Input placeholder="e.g. 55–60 L" {...register('priceRange')} /></Field>
            <Field label="Availability" error={errors.availability?.message}>
              <Select {...register('availability')}>{AVAILABILITY.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
            </Field>
            <Field label="Assigned broker" error={errors.brokerId?.message}>
              <Select {...register('brokerId')}>
                <option value="">Unassigned</option>
                {brokers.data?.map((b) => <option key={b.id} value={b.id}>{b.fullName}</option>)}
              </Select>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Location</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Locality / area" error={errors.location?.message}><Input {...register('location')} /></Field>
            <Field label="City" error={errors.city?.message}><Input {...register('city')} /></Field>
            <Field label="State" error={errors.state?.message}><Input {...register('state')} /></Field>
            <Field label="Address" error={errors.address?.message} className="sm:col-span-3"><Input {...register('address')} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Bedrooms" error={errors.bedrooms?.message}><Input inputMode="numeric" {...register('bedrooms')} /></Field>
            <Field label="Bathrooms" error={errors.bathrooms?.message}><Input inputMode="numeric" {...register('bathrooms')} /></Field>
            <Field label="Furnishing" error={errors.furnishing?.message}>
              <Select {...register('furnishing')}><option value="">Not specified</option>{FURNISHING.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
            </Field>
            <Field label="Area" error={errors.area?.message}><Input inputMode="decimal" {...register('area')} /></Field>
            <Field label="Area unit" error={errors.areaUnit?.message}>
              <Select {...register('areaUnit')}>{AREA_UNITS.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}</Select>
            </Field>
            <Field label="Amenities" hint="Comma-separated" error={errors.amenities?.message}><Input placeholder="Lift, Parking, Gym" {...register('amenities')} /></Field>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{editing ? 'Save changes' : 'Create property'}</Button>
        </div>
      </form>
    </>
  );
}
