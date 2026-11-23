import type { Prisma } from '@prisma/client';
import { leadNo } from '../services/leadService';

const num = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));

export function serializeProperty<T extends { price: Prisma.Decimal; area: Prisma.Decimal | null; code: number }>(p: T) {
  return { ...p, price: Number(p.price), area: num(p.area), propertyCode: `P-${String(p.code).padStart(4, '0')}` };
}

export function serializeLead<T extends { number: number; budgetMin: Prisma.Decimal | null; budgetMax: Prisma.Decimal | null }>(l: T) {
  return { ...l, leadNumber: leadNo(l.number), budgetMin: num(l.budgetMin), budgetMax: num(l.budgetMax) };
}
