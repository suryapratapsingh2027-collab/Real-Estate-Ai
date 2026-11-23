import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env';
import { integrationService } from './integrationService';

async function s3(): Promise<{ client: S3Client; bucket: string } | null> {
  const r = await integrationService.resolve('storage');
  if (r.config.driver !== 's3') return null;
  if (!r.config.bucket || !r.secrets.accessKeyId || !r.secrets.secretAccessKey) {
    throw new Error('S3 storage selected but bucket/credentials are missing');
  }
  const client = new S3Client({
    region: r.config.region || 'us-east-1',
    endpoint: r.config.endpoint || undefined,
    forcePathStyle: Boolean(r.config.endpoint),
    credentials: { accessKeyId: r.secrets.accessKeyId, secretAccessKey: r.secrets.secretAccessKey },
  });
  return { client, bucket: r.config.bucket };
}

function localPath(key: string): string {
  const base = path.resolve(env.UPLOAD_DIR);
  const p = path.resolve(base, key);
  if (!p.startsWith(base + path.sep)) throw new Error('Invalid storage key');
  return p;
}

export const storage = {
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const s = await s3();
    if (s) {
      await s.client.send(new PutObjectCommand({ Bucket: s.bucket, Key: key, Body: body, ContentType: contentType }));
      return;
    }
    const p = localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  },

  async get(key: string): Promise<{ stream: Readable; contentType?: string } | null> {
    const s = await s3();
    if (s) {
      try {
        const out = await s.client.send(new GetObjectCommand({ Bucket: s.bucket, Key: key }));
        return { stream: out.Body as Readable, contentType: out.ContentType };
      } catch {
        return null;
      }
    }
    const p = localPath(key);
    try {
      await fs.access(p);
    } catch {
      return null;
    }
    return { stream: createReadStream(p) };
  },

  async remove(key: string): Promise<void> {
    const s = await s3();
    if (s) {
      await s.client.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: key }));
      return;
    }
    await fs.rm(localPath(key), { force: true });
  },

  /** Short-lived URL for private objects (recordings). Local driver streams via API instead. */
  async signedUrl(key: string, seconds = 300): Promise<string | null> {
    const s = await s3();
    if (!s) return null;
    return getSignedUrl(s.client, new GetObjectCommand({ Bucket: s.bucket, Key: key }), { expiresIn: seconds });
  },

  async isS3(): Promise<boolean> {
    return (await integrationService.resolve('storage')).config.driver === 's3';
  },

  async healthCheck(): Promise<void> {
    const s = await s3();
    if (!s) return;
    await s.client.send(new HeadBucketCommand({ Bucket: s.bucket }));
  },
};

const MAGIC: Array<{ mime: string; ext: string; check: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', check: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

/** Validate an uploaded image by content (magic bytes), not by the client-supplied mimetype. */
export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  const m = MAGIC.find((x) => x.check(buf));
  return m ? { mime: m.mime, ext: m.ext } : null;
}
