import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma CLI configuration (JS schema engine via the pg driver adapter).
 * Shim: @prisma/adapter-pg 6.19 does not map some Postgres catalog types
 * (`name`, `char`, ...) read during migrations; report them as text.
 */
const CATALOG_TYPE_REMAP: Record<number, number> = { 18: 25, 19: 25, 194: 25, 1002: 1009, 1003: 1009 };
type ResultProto = { addFields(fields: Array<{ dataTypeID: number }>): void };
const ResultCtor = (pg as unknown as { Result?: { prototype: ResultProto } }).Result;
if (ResultCtor) {
  const original = ResultCtor.prototype.addFields;
  ResultCtor.prototype.addFields = function patched(fields) {
    for (const f of fields) {
      const mapped = CATALOG_TYPE_REMAP[f.dataTypeID];
      if (mapped !== undefined) f.dataTypeID = mapped;
    }
    return original.call(this, fields);
  };
}

// Prisma skips .env loading when a config file exists, so load the repo-root .env here.
// Values already set in the environment (e.g. Docker) are kept.
const rootEnv = path.join(__dirname, '../../.env');
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
}

export default defineConfig({
  experimental: { adapter: true },
  engine: 'js',
  schema: path.join(__dirname, '../../prisma/schema.prisma'),
  migrations: {
    path: path.join(__dirname, '../../prisma/migrations'),
    seed: 'tsx --env-file-if-exists=../../.env ../../prisma/seed.ts',
  },
  async adapter() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    return new PrismaPg({ connectionString: url });
  },
});