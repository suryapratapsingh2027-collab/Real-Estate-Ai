import { execSync } from 'node:child_process';
import path from 'node:path';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://realestate:realestate@localhost:5432/realestate_test';

/** Apply migrations to the dedicated test database once per run. */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
