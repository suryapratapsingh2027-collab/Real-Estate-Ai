import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { propertyCreateSchema, propertyQuerySchema, propertyUpdateSchema } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/auditService';
import { sniffImage, storage } from '../services/storage';
import { badRequest, notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';
import { serializeProperty } from './serializers';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

export const propertiesRouter = Router();
propertiesRouter.use(requireAuth);

propertiesRouter.get('/', requirePermission('property:read'), async (req, res) => {
  const q = parse(propertyQuerySchema, req.query);
  const where: Prisma.PropertyWhereInput = {};
  const and: Prisma.PropertyWhereInput[] = [];
  if (q.search) {
    and.push({
      OR: [
        { title: { contains: q.search, mode: 'insensitive' } },
        { location: { contains: q.search, mode: 'insensitive' } },
        { city: { contains: q.search, mode: 'insensitive' } },
        ...(Number.isInteger(Number(q.search.replace(/^P-/i, ''))) ? [{ code: Number(q.search.replace(/^P-/i, '')) }] : []),
      ],
    });
  }
  if (q.city) and.push({ city: { contains: q.city, mode: 'insensitive' } });
  if (q.location) and.push({ OR: [{ location: { contains: q.location, mode: 'insensitive' } }, { city: { contains: q.location, mode: 'insensitive' } }] });
  if (q.propertyType) and.push({ propertyType: q.propertyType });
  if (q.listingType) and.push({ listingType: q.listingType });
  if (q.availability) and.push({ availability: q.availability });
  if (q.minPrice != null) and.push({ price: { gte: q.minPrice } });
  if (q.maxPrice != null) and.push({ price: { lte: q.maxPrice } });
  if (q.bedrooms != null) and.push({ bedrooms: q.bedrooms });
  if (and.length) where.AND = and;
  const [items, total] = await Promise.all([
    prisma.property.findMany({
      where,
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 }, broker: { include: { user: { select: { fullName: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.property.count({ where }),
  ]);
  res.json(paged(items.map(serializeProperty), total, q.page, q.pageSize));
});

propertiesRouter.get('/:id', requirePermission('property:read'), async (req, res) => {
  const p = await prisma.property.findUnique({
    where: { id: String(req.params.id) },
    include: { images: { orderBy: { sortOrder: 'asc' } }, broker: { include: { user: { select: { fullName: true, email: true } } } } },
  });
  if (!p) throw notFound('Property');
  res.json(serializeProperty(p));
});

propertiesRouter.post('/', requirePermission('property:write'), async (req, res) => {
  const data = parse(propertyCreateSchema, req.body);
  const p = await prisma.property.create({ data: { ...data, amenities: data.amenities ?? [] } });
  await audit(req, 'property.create', 'Property', p.id, { title: p.title });
  res.status(201).json(serializeProperty(p));
});

propertiesRouter.patch('/:id', requirePermission('property:write'), async (req, res) => {
  const data = parse(propertyUpdateSchema, req.body);
  const p = await prisma.property.update({ where: { id: String(req.params.id) }, data });
  await audit(req, 'property.update', 'Property', p.id, { fields: Object.keys(data) });
  res.json(serializeProperty(p));
});

propertiesRouter.delete('/:id', requirePermission('property:write'), async (req, res) => {
  const p = await prisma.property.findUnique({ where: { id: String(req.params.id) }, include: { images: true } });
  if (!p) throw notFound('Property');
  await prisma.property.delete({ where: { id: p.id } });
  await Promise.all(p.images.map((i) => storage.remove(i.storageKey).catch(() => undefined)));
  await audit(req, 'property.delete', 'Property', p.id, { title: p.title });
  res.status(204).end();
});

propertiesRouter.post('/:id/images', requirePermission('property:write'), upload.array('images', 10), async (req, res) => {
  const p = await prisma.property.findUnique({ where: { id: String(req.params.id) }, include: { images: true } });
  if (!p) throw notFound('Property');
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('No valid images uploaded (JPEG, PNG or WebP up to 5 MB)');
  if (p.images.length + files.length > 20) throw badRequest('A property can have at most 20 images');
  const created = [];
  let order = p.images.length;
  for (const f of files) {
    const kind = sniffImage(f.buffer);
    if (!kind) throw badRequest(`${f.originalname} is not a valid image`);
    const key = `properties/${p.id}/${crypto.randomUUID()}.${kind.ext}`;
    await storage.put(key, f.buffer, kind.mime);
    created.push(await prisma.propertyImage.create({ data: { propertyId: p.id, storageKey: key, url: `/api/files/${key}`, sortOrder: order++ } }));
  }
  await audit(req, 'property.images_add', 'Property', p.id, { count: created.length });
  res.status(201).json(created);
});

propertiesRouter.delete('/:id/images/:imageId', requirePermission('property:write'), async (req, res) => {
  const img = await prisma.propertyImage.findFirst({ where: { id: String(req.params.imageId), propertyId: String(req.params.id) } });
  if (!img) throw notFound('Image');
  await prisma.propertyImage.delete({ where: { id: img.id } });
  await storage.remove(img.storageKey).catch(() => undefined);
  res.status(204).end();
});
