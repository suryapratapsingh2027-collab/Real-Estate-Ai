import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { AVAILABILITY, PROPERTY_TYPES, humanize } from '@rea/shared';
import { usePagedList, useDebounced } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import type { Property } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { DemoBadge, PageHeader } from '@/components/ui/page';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatINR } from '@/utils/format';

export function PropertiesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ location: '', propertyType: '', availability: '', bedrooms: '', minPrice: '', maxPrice: '' });
  const q = usePagedList<Property>('properties', '/properties', { ...f, search: useDebounced(search), location: useDebounced(f.location) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader
        title="Properties"
        description="Only AVAILABLE listings are ever recommended by the AI."
        actions={
          can('property:write') && (
            <Button asChild>
              <Link to="/properties/new">
                <Plus /> Add property
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="grid gap-2 border-b p-3 sm:grid-cols-3 lg:grid-cols-7">
          <Input placeholder="Search title, area, P-0001…" value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" aria-label="Search" />
          <Input placeholder="Location / city" value={f.location} onChange={set('location')} aria-label="Location" />
          <Select value={f.propertyType} onChange={set('propertyType')} aria-label="Property type">
            <option value="">All types</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>{humanize(t)}</option>
            ))}
          </Select>
          <Select value={f.availability} onChange={set('availability')} aria-label="Availability">
            <option value="">Any availability</option>
            {AVAILABILITY.map((t) => (
              <option key={t} value={t}>{humanize(t)}</option>
            ))}
          </Select>
          <Select value={f.bedrooms} onChange={set('bedrooms')} aria-label="Bedrooms">
            <option value="">Any BHK</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} BHK</option>
            ))}
          </Select>
          <div className="flex gap-1">
            <Input placeholder="Min ₹" inputMode="numeric" value={f.minPrice} onChange={set('minPrice')} aria-label="Minimum price" />
            <Input placeholder="Max ₹" inputMode="numeric" value={f.maxPrice} onChange={set('maxPrice')} aria-label="Maximum price" />
          </div>
        </div>
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Building2 className="h-5 w-5" />} title="No properties found" description="Adjust filters or add your first listing." />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Property</TH>
                  <TH>Type</TH>
                  <TH>Location</TH>
                  <TH className="text-right">Price</TH>
                  <TH>Status</TH>
                  <TH>Broker</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.items.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        {p.images?.[0] ? <img src={p.images[0].url} alt="" className="h-10 w-14 rounded object-cover" /> : <div className="flex h-10 w-14 items-center justify-center rounded bg-secondary"><Building2 className="h-4 w-4 text-muted-foreground" /></div>}
                        <div>
                          <Link to={`/properties/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                          <DemoBadge show={p.isDemo} />
                          <p className="text-xs text-muted-foreground">{p.propertyCode}{p.bedrooms != null ? ` · ${p.bedrooms} BHK` : ''}{p.area ? ` · ${p.area} ${p.areaUnit.toLowerCase()}` : ''}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>{humanize(p.propertyType)} <span className="text-xs text-muted-foreground">({humanize(p.listingType)})</span></TD>
                    <TD>{p.location}, {p.city}</TD>
                    <TD className="text-right font-medium tabular-nums">{formatINR(p.price)}{p.listingType === 'RENT' ? '/mo' : ''}</TD>
                    <TD><StatusBadge status={p.availability} /></TD>
                    <TD className="text-sm">{p.broker?.user.fullName ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.page} totalPages={q.data.totalPages} total={q.data.total} onPage={q.setPage} />
          </>
        )}
      </Card>
    </>
  );
}
