import type { Prisma } from '@prisma/client';
import {
  normalizeListingType,
  normalizePropertyType,
  propertySearchArgsSchema,
  type PropertySearchArgs,
} from '@rea/shared';
import { prisma } from '../lib/prisma';

export type PropertyHit = {
  id: string;
  code: string;
  title: string;
  type: string;
  listing: string;
  location: string;
  city: string;
  bedrooms: number | null;
  bathrooms: number | null;
  area: string | null;
  price: number;
  priceText: string;
  furnishing: string | null;
  amenities: string[];
};

export function formatINR(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2).replace(/\.?0+$/, '')} Lakh`;
  return `₹${n.toLocaleString('en-IN')}`;
}

/**
 * Read-only property search used by the AI tool and the voice agent.
 * Always restricted to AVAILABLE properties; arguments are validated and
 * mapped to a parameterised Prisma query (the model never supplies SQL or ids to write).
 */
export async function searchAvailableProperties(rawArgs: unknown): Promise<PropertyHit[]> {
  const parsed = propertySearchArgsSchema.safeParse(rawArgs ?? {});
  const args: PropertySearchArgs = parsed.success ? parsed.data : {};
  const where: Prisma.PropertyWhereInput = { availability: 'AVAILABLE' };
  const and: Prisma.PropertyWhereInput[] = [];
  const loc = args.location?.trim();
  if (loc) {
    and.push({
      OR: [
        { location: { contains: loc, mode: 'insensitive' } },
        { city: { contains: loc, mode: 'insensitive' } },
        { address: { contains: loc, mode: 'insensitive' } },
      ],
    });
  }
  if (args.city?.trim()) and.push({ city: { contains: args.city.trim(), mode: 'insensitive' } });
  const type = normalizePropertyType(args.property_type);
  if (type) and.push({ propertyType: type });
  const listing = normalizeListingType(args.listing_type);
  if (listing) and.push({ listingType: listing });
  if (args.min_price != null) and.push({ price: { gte: args.min_price } });
  if (args.max_price != null) and.push({ price: { lte: args.max_price } });
  if (args.bedrooms != null) and.push({ bedrooms: args.bedrooms });
  if (and.length) where.AND = and;

  const rows = await prisma.property.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    take: args.limit ?? 5,
  });
  return rows.map((p) => {
    const price = Number(p.price);
    return {
      id: p.id,
      code: `P-${String(p.code).padStart(4, '0')}`,
      title: p.title,
      type: p.propertyType,
      listing: p.listingType,
      location: p.location,
      city: p.city,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      area: p.area ? `${Number(p.area)} ${p.areaUnit.toLowerCase()}` : null,
      price,
      priceText: formatINR(price) + (p.listingType === 'RENT' ? '/month' : ''),
      furnishing: p.furnishing,
      amenities: p.amenities.slice(0, 8),
    };
  });
}

/** Distinct known locations — used by the mock AI to recognise place names. */
export async function knownLocations(): Promise<string[]> {
  const [props, brokers] = await Promise.all([
    prisma.property.findMany({ select: { location: true, city: true }, distinct: ['location', 'city'], take: 500 }),
    prisma.brokerProfile.findMany({ select: { areas: true }, take: 500 }),
  ]);
  const set = new Set<string>();
  for (const p of props) {
    set.add(p.location);
    set.add(p.city);
  }
  for (const b of brokers) for (const a of b.areas) set.add(a);
  return [...set].filter((s) => s.length >= 3).sort((a, b) => b.length - a.length);
}
