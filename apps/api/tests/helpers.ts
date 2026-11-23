import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '@rea/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { invalidateUserCache } from '../src/services/authService';
import { integrationService } from '../src/services/integrationService';
import { settingsService } from '../src/services/settingsService';
import { registerAllHandlers } from '../src/workers/handlers';
import { hmacSha256Hex } from '../src/services/crypto';

registerAllHandlers();
export const app = createApp();
export const PASSWORD = 'Passw0rd!Test';

export async function resetDb() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  invalidateUserCache();
  integrationService.clearCache();
  settingsService.clearCache();
}

export async function seedBase() {
  await resetDb();
  for (const key of PERMISSIONS) await prisma.permission.create({ data: { key } });
  const perms = await prisma.permission.findMany();
  const roleIds: Record<string, string> = {};
  for (const name of ROLES) {
    const r = await prisma.role.create({
      data: { name, permissions: { create: ROLE_PERMISSIONS[name].map((k) => ({ permissionId: perms.find((p) => p.key === k)!.id })) } },
    });
    roleIds[name] = r.id;
  }
  const hash = await bcrypt.hash(PASSWORD, 4);
  const superAdmin = await prisma.user.create({ data: { email: 'super@test.local', fullName: 'Super', passwordHash: hash, roleId: roleIds.SUPER_ADMIN! } });
  const admin = await prisma.user.create({ data: { email: 'admin@test.local', fullName: 'Admin', passwordHash: hash, roleId: roleIds.ADMIN! } });
  const mk = async (email: string, name: string, phone: string, areas: string[], extra: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({ data: { email, fullName: name, passwordHash: hash, roleId: roleIds.BROKER! } });
    return prisma.brokerProfile.create({ data: { userId: u.id, phone, whatsappNumber: phone, areas, specialization: ['APARTMENT'], maxActiveLeads: 5, ...extra } });
  };
  const brokerA = await mk('a@test.local', 'Broker A', '+919000000001', ['bhopal', 'arera colony']);
  const brokerB = await mk('b@test.local', 'Broker B', '+919000000002', ['indore']);
  await prisma.property.createMany({
    data: [
      { title: '2 BHK in Arera Colony', propertyType: 'APARTMENT', listingType: 'SALE', location: 'Arera Colony', city: 'Bhopal', state: 'MP', bedrooms: 2, price: 6_000_000 },
      { title: 'Sold flat Arera Colony', propertyType: 'APARTMENT', listingType: 'SALE', location: 'Arera Colony', city: 'Bhopal', state: 'MP', bedrooms: 2, price: 5_500_000, availability: 'SOLD' },
      { title: 'Villa in Indore', propertyType: 'VILLA', listingType: 'SALE', location: 'Vijay Nagar', city: 'Indore', state: 'MP', bedrooms: 4, price: 20_000_000 },
    ],
  });
  return { superAdmin, admin, brokerA, brokerB };
}

export async function tokenFor(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export function waSignature(body: string) {
  return 'sha256=' + hmacSha256Hex('wa-app-secret', body);
}

export function waTextPayload(from: string, id: string, text: string, name = 'Test User') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: '1234567890' },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

export async function postWhatsApp(payload: unknown) {
  const body = JSON.stringify(payload);
  return request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', waSignature(body)).send(body);
}
export { sentWhatsApp } from './setup';
