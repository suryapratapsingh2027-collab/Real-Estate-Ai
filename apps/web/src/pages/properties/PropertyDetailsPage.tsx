import { useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Pencil, Trash2, X } from 'lucide-react';
import { humanize } from '@rea/shared';
import { api } from '@/services/api';
import { useApiMutation } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Property } from '@/types/api';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DemoBadge, DetailRow, PageHeader } from '@/components/ui/page';
import { ErrorState, TableSkeleton, EmptyState } from '@/components/ui/feedback';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { formatDate, formatINR } from '@/utils/format';

export function PropertyDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['property', id], queryFn: () => api<Property>(`/properties/${id}`) });
  const upload = useApiMutation(
    (files: FileList) => {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('images', f));
      return api(`/properties/${id}/images`, { method: 'POST', form: fd });
    },
    { success: 'Images uploaded', invalidate: [['property', id], ['properties']] },
  );
  const removeImage = useApiMutation((imageId: string) => api(`/properties/${id}/images/${imageId}`, { method: 'DELETE' }), { success: 'Image removed', invalidate: [['property', id]] });

  if (q.isLoading) return <TableSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const write = can('property:write');

  return (
    <>
      <PageHeader
        back="/properties"
        title={<>{p.title}<DemoBadge show={p.isDemo} /></>}
        description={`${p.propertyCode} · ${p.location}, ${p.city}`}
        actions={
          write && (
            <>
              <Button variant="outline" asChild><Link to={`/properties/${p.id}/edit`}><Pencil /> Edit</Link></Button>
              <ConfirmButton title="Delete property?" description="This permanently removes the listing and its images." confirmLabel="Delete" onConfirm={async () => { await api(`/properties/${p.id}`, { method: 'DELETE' }); navigate('/properties'); }}>
                <Trash2 /> Delete
              </ConfirmButton>
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Images</CardTitle>
            {write && (
              <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
                <Button size="sm" variant="outline" loading={upload.isPending} onClick={() => fileRef.current?.click()}><ImagePlus /> Upload</Button>
              </>
            )}
          </CardHeader>
          <CardContent>
            {p.images?.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {p.images.map((img) => (
                  <div key={img.id} className="group relative">
                    <img src={img.url} alt={p.title} className="aspect-video w-full rounded-md object-cover" />
                    {write && (
                      <button className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 group-hover:block" onClick={() => removeImage.mutate(img.id)} aria-label="Remove image">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No images" description="JPEG, PNG or WebP up to 5 MB each." />
            )}
            {p.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{p.description}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="divide-y">
              <DetailRow label="Price">{formatINR(p.price)}{p.listingType === 'RENT' ? ' / month' : ''}{p.priceRange ? ` (${p.priceRange})` : ''}</DetailRow>
              <DetailRow label="Status"><StatusBadge status={p.availability} /></DetailRow>
              <DetailRow label="Type">{humanize(p.propertyType)} for {humanize(p.listingType)}</DetailRow>
              <DetailRow label="Bedrooms">{p.bedrooms ?? '—'}</DetailRow>
              <DetailRow label="Bathrooms">{p.bathrooms ?? '—'}</DetailRow>
              <DetailRow label="Area">{p.area ? `${p.area} ${p.areaUnit.toLowerCase()}` : '—'}</DetailRow>
              <DetailRow label="Furnishing">{p.furnishing ? humanize(p.furnishing) : '—'}</DetailRow>
              <DetailRow label="Address">{p.address ?? `${p.location}, ${p.city}, ${p.state}`}</DetailRow>
              <DetailRow label="Broker">{p.broker?.user.fullName ?? 'Unassigned'}</DetailRow>
              <DetailRow label="Amenities">{p.amenities.length ? <div className="flex flex-wrap gap-1">{p.amenities.map((a) => <Badge key={a}>{a}</Badge>)}</div> : '—'}</DetailRow>
              <DetailRow label="Updated">{formatDate(p.updatedAt)}</DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
