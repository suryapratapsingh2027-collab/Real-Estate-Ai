/**
 * Seed: roles + permissions (always), and — outside production only — a demo Super Admin,
 * demo brokers, properties, customers and leads. All demo rows have isDemo = true.
 *
 *   npm run db:seed
 */
import { PrismaClient, type PropertyType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '@rea/shared';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const isProd = process.env.NODE_ENV === 'production';

async function seedRbac() {
  for (const key of PERMISSIONS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  const perms = await prisma.permission.findMany();
  for (const name of ROLES) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name, description: name.replace('_', ' ') } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: ROLE_PERMISSIONS[name].map((k) => ({ roleId: role.id, permissionId: perms.find((p) => p.key === k)!.id })),
    });
  }
  const integrations: Array<[string, string]> = [
    ['whatsapp', 'WhatsApp Cloud API'],
    ['groq', 'Groq (LLM + Whisper)'],
    ['livekit', 'LiveKit'],
    ['tts', 'Text-to-Speech (Cartesia / ElevenLabs)'],
    ['storage', 'Object Storage'],
  ];
  for (const [key, name] of integrations) await prisma.integration.upsert({ where: { key }, update: {}, create: { key, name } });
}

async function seedDemo() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const hash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, fullName: 'Demo Super Admin', passwordHash: hash, roleId: roles.SUPER_ADMIN!, isDemo: true },
  });
  await prisma.user.upsert({
    where: { email: 'manager@demo.local' },
    update: {},
    create: { email: 'manager@demo.local', fullName: 'Demo Admin', passwordHash: hash, roleId: roles.ADMIN!, isDemo: true },
  });

  const brokerDefs = [
    { email: 'ravi.broker@demo.local', name: 'Ravi Sharma', phone: '+919800000001', areas: ['bhopal', 'arera colony', 'kolar road', 'mp nagar'], spec: ['APARTMENT', 'VILLA'] },
    { email: 'neha.broker@demo.local', name: 'Neha Verma', phone: '+919800000002', areas: ['indore', 'vijay nagar', 'palasia'], spec: ['APARTMENT', 'COMMERCIAL'] },
    { email: 'arjun.broker@demo.local', name: 'Arjun Mehta', phone: '+919800000003', areas: ['bhopal', 'hoshangabad road', 'bairagarh'], spec: ['PLOT', 'INDEPENDENT_HOUSE'] },
  ] as const;
  const brokers = [];
  for (const b of brokerDefs) {
    const user = await prisma.user.upsert({
      where: { email: b.email },
      update: {},
      create: { email: b.email, fullName: b.name, passwordHash: hash, roleId: roles.BROKER!, isDemo: true },
    });
    brokers.push(
      await prisma.brokerProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, phone: b.phone, whatsappNumber: b.phone, areas: [...b.areas], specialization: [...b.spec] as PropertyType[], experienceYears: 5, maxActiveLeads: 15 },
      }),
    );
  }

  if ((await prisma.property.count({ where: { isDemo: true } })) === 0) {
    const props: Array<{ t: string; type: PropertyType; listing: 'SALE' | 'RENT'; loc: string; city: string; bed: number | null; price: number; area: number; furn?: 'SEMI_FURNISHED' | 'FULLY_FURNISHED' | 'UNFURNISHED'; b: number }> = [
      { t: '2 BHK Apartment near DB Mall', type: 'APARTMENT', listing: 'SALE', loc: 'Arera Colony', city: 'Bhopal', bed: 2, price: 5_800_000, area: 1150, furn: 'SEMI_FURNISHED', b: 0 },
      { t: '3 BHK Premium Apartment', type: 'APARTMENT', listing: 'SALE', loc: 'Kolar Road', city: 'Bhopal', bed: 3, price: 7_200_000, area: 1650, furn: 'UNFURNISHED', b: 0 },
      { t: '2 BHK Budget Flat', type: 'APARTMENT', listing: 'SALE', loc: 'Bairagarh', city: 'Bhopal', bed: 2, price: 3_400_000, area: 950, b: 2 },
      { t: '4 BHK Independent Villa with Garden', type: 'VILLA', listing: 'SALE', loc: 'Hoshangabad Road', city: 'Bhopal', bed: 4, price: 15_500_000, area: 3200, furn: 'FULLY_FURNISHED', b: 2 },
      { t: '1 BHK Furnished Flat for Rent', type: 'APARTMENT', listing: 'RENT', loc: 'MP Nagar', city: 'Bhopal', bed: 1, price: 14_000, area: 600, furn: 'FULLY_FURNISHED', b: 0 },
      { t: 'Residential Plot 1500 sq ft', type: 'PLOT', listing: 'SALE', loc: 'Bairagarh', city: 'Bhopal', bed: null, price: 2_700_000, area: 1500, b: 2 },
      { t: '2 BHK Apartment Vijay Nagar', type: 'APARTMENT', listing: 'SALE', loc: 'Vijay Nagar', city: 'Indore', bed: 2, price: 6_300_000, area: 1200, furn: 'SEMI_FURNISHED', b: 1 },
      { t: 'Office Space 800 sq ft', type: 'OFFICE', listing: 'RENT', loc: 'Palasia', city: 'Indore', bed: null, price: 45_000, area: 800, b: 1 },
      { t: '3 BHK Apartment with Clubhouse', type: 'APARTMENT', listing: 'SALE', loc: 'Vijay Nagar', city: 'Indore', bed: 3, price: 8_900_000, area: 1750, b: 1 },
      { t: 'Retail Shop Ground Floor', type: 'SHOP', listing: 'SALE', loc: 'MP Nagar', city: 'Bhopal', bed: null, price: 9_500_000, area: 450, b: 0 },
      { t: '2 BHK Apartment (Sold)', type: 'APARTMENT', listing: 'SALE', loc: 'Arera Colony', city: 'Bhopal', bed: 2, price: 5_100_000, area: 1100, b: 0 },
    ];
    for (const [i, p] of props.entries()) {
      await prisma.property.create({
        data: {
          title: p.t,
          description: `${p.t} in ${p.loc}, ${p.city}. Demo listing for local testing.`,
          propertyType: p.type,
          listingType: p.listing,
          location: p.loc,
          city: p.city,
          state: 'Madhya Pradesh',
          bedrooms: p.bed,
          bathrooms: p.bed ? Math.max(1, p.bed - 1) : null,
          area: p.area,
          areaUnit: 'SQFT',
          price: p.price,
          furnishing: p.furn ?? null,
          amenities: p.type === 'APARTMENT' ? ['Lift', 'Parking', 'Power Backup', 'Security'] : ['Parking'],
          availability: i === props.length - 1 ? 'SOLD' : 'AVAILABLE',
          brokerId: brokers[p.b]!.id,
          isDemo: true,
        },
      });
    }
  }

  if ((await prisma.customer.count({ where: { isDemo: true } })) === 0) {
    const demoCustomers = [
      { name: 'Rahul Gupta', phone: '+919811111111', loc: 'Arera Colony', type: 'APARTMENT' as PropertyType, budget: '50-70 Lakhs', status: 'CONTACTED' as const, b: 0 },
      { name: 'Priya Singh', phone: '+919822222222', loc: 'Vijay Nagar', type: 'APARTMENT' as PropertyType, budget: '60-90 Lakhs', status: 'SITE_VISIT_SCHEDULED' as const, b: 1 },
      { name: 'Amit Patel', phone: '+919833333333', loc: 'Bairagarh', type: 'PLOT' as PropertyType, budget: '25-30 Lakhs', status: 'CONVERTED' as const, b: 2 },
      { name: 'Sneha Joshi', phone: '+919844444444', loc: 'Kolar Road', type: 'APARTMENT' as PropertyType, budget: '70-75 Lakhs', status: 'LOST' as const, b: 0 },
    ];
    for (const [i, c] of demoCustomers.entries()) {
      const created = new Date(Date.now() - (i + 1) * 3 * 86_400_000);
      const customer = await prisma.customer.create({
        data: { fullName: c.name, phone: c.phone, whatsappNumber: c.phone, preferredLocation: c.loc, preferredPropertyType: c.type, budgetRange: c.budget, preferredLanguage: 'en', whatsappConsent: true, whatsappConsentAt: created, isDemo: true, createdAt: created },
      });
      const convo = await prisma.conversation.create({ data: { customerId: customer.id, lastMessageAt: created, lastInboundAt: created, lastMessageText: `Looking for ${c.type.toLowerCase()} in ${c.loc}` } });
      await prisma.message.createMany({
        data: [
          { conversationId: convo.id, direction: 'INBOUND', sender: 'CUSTOMER', body: `Hi, I am looking for a ${c.type.toLowerCase()} in ${c.loc}, budget ${c.budget}`, status: 'RECEIVED', createdAt: created },
          { conversationId: convo.id, direction: 'OUTBOUND', sender: 'AI', body: 'Thanks! Our consultant will contact you shortly. (demo message)', status: 'DELIVERED', createdAt: new Date(created.getTime() + 5000) },
        ],
      });
      await prisma.lead.create({
        data: {
          customerId: customer.id,
          conversationId: convo.id,
          originalMessage: `Looking for ${c.type.toLowerCase()} in ${c.loc}`,
          propertyType: c.type,
          listingType: 'SALE',
          budgetRange: c.budget,
          preferredLocation: c.loc,
          urgency: 'WITHIN_3_MONTHS',
          summary: `Demo: ${c.name} wants a ${c.type.toLowerCase()} in ${c.loc} within ${c.budget}`,
          source: 'WHATSAPP',
          isQualified: true,
          status: c.status,
          brokerId: brokers[c.b]!.id,
          assignedAt: created,
          assignmentReason: 'Demo seed data',
          convertedAt: c.status === 'CONVERTED' ? new Date() : null,
          lostReason: c.status === 'LOST' ? 'Bought elsewhere' : null,
          isDemo: true,
          createdAt: created,
          activities: { create: { type: 'CREATED', message: 'Demo lead seeded', createdAt: created } },
        },
      });
    }
  }

  await prisma.businessSetting.upsert({
    where: { key: 'business' },
    update: {},
    create: { key: 'business', value: { businessName: 'Demo Realty (Bhopal)', workingHours: 'Mon–Sat 10:00–19:00', timezone: 'Asia/Kolkata', fallbackPolicy: 'LEAST_LOADED_ANY_AREA', recordingEnabled: false, recordingRetentionDays: 30 } },
  });

  console.log('\nDemo data seeded (isDemo=true). Local development credentials:');
  console.log(`  Super Admin: ${email} / ${password}`);
  console.log(`  Admin:       manager@demo.local / ${password}`);
  console.log(`  Broker:      ravi.broker@demo.local / ${password}`);
}

async function main() {
  await seedRbac();
  console.log('Roles, permissions and integrations seeded.');
  if (isProd) {
    console.log('NODE_ENV=production: skipping demo users and data. Create the first Super Admin with `npm run create-admin -w @rea/api`.');
    return;
  }
  await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
