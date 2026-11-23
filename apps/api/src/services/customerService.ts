import { Prisma } from '@prisma/client';
import { normalizePhone } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { badRequest } from '../utils/errors';

/**
 * Find or create a customer by normalised phone. Safe under concurrent webhook deliveries:
 * a unique-constraint race falls back to reading the existing row.
 */
export async function findOrCreateCustomer(rawPhone: string, name?: string | null, opts: { whatsapp?: boolean } = {}) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw badRequest('Invalid phone number');
  const existing = await prisma.customer.findUnique({ where: { phone } });
  if (existing) {
    if (!existing.fullName && name) {
      return prisma.customer.update({ where: { id: existing.id }, data: { fullName: name } });
    }
    return existing;
  }
  try {
    return await prisma.customer.create({
      data: {
        phone,
        whatsappNumber: opts.whatsapp ? phone : null,
        fullName: name ?? null,
        // A customer who messages the business first has opted in to replies on WhatsApp.
        whatsappConsent: Boolean(opts.whatsapp),
        whatsappConsentAt: opts.whatsapp ? new Date() : null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return prisma.customer.findUniqueOrThrow({ where: { phone } });
    }
    throw e;
  }
}

export async function getOrCreateConversation(customerId: string) {
  return prisma.conversation.upsert({
    where: { customerId },
    update: {},
    create: { customerId },
  });
}
