/**
 * Create the first Super Admin interactively (for production, where the seed creates no users).
 *   npm run create-admin -w @rea/api
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { passwordSchema } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../services/authService';

const rl = readline.createInterface({ input: stdin, output: stdout });
const email = (await rl.question('Email: ')).trim().toLowerCase();
const fullName = (await rl.question('Full name: ')).trim();
const password = await rl.question('Password (min 10 chars, upper/lower/digit): ');
rl.close();

const pw = passwordSchema.safeParse(password);
if (!pw.success) {
  console.error(pw.error.issues.map((i) => i.message).join(', '));
  process.exit(1);
}
const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
if (!role) {
  console.error('Roles not found. Run `npm run db:seed` first.');
  process.exit(1);
}
await prisma.user.create({ data: { email, fullName, passwordHash: await hashPassword(password), roleId: role.id } });
console.log(`Super Admin ${email} created.`);
await prisma.$disconnect();
