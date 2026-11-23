import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, PASSWORD, seedBase, tokenFor } from './helpers';

describe('authentication', () => {
  beforeAll(seedBase);

  it('logs in and returns an access token + httpOnly refresh cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/rea_rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('rejects wrong password with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@test.local', password: 'nope' });
    expect(unknown.body.error.message).toBe('Invalid email or password');
  });

  it('locks the account after 5 failed attempts (brute-force protection)', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: 'b@test.local', password: 'bad' });
    const res = await request(app).post('/api/auth/login').send({ email: 'b@test.local', password: PASSWORD });
    expect(res.status).toBe(423);
    await prisma.user.update({ where: { email: 'b@test.local' }, data: { lockedUntil: null, failedLoginCount: 0 } });
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: PASSWORD });
    const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;

    const noHeader = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(noHeader.status).toBe(403); // CSRF guard

    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(r1.status).toBe(200);
    const cookie2 = r1.headers['set-cookie']![0]!.split(';')[0]!;
    expect(cookie2).not.toBe(cookie);

    // Reusing the old token revokes the whole family.
    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(reuse.status).toBe(401);
    const afterReuse = await request(app).post('/api/auth/refresh').set('Cookie', cookie2).set('X-Requested-With', 'XMLHttpRequest');
    expect(afterReuse.status).toBe(401);
  });

  it('GET /me requires a valid token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const token = await tokenFor('super@test.local');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain('user:manage');
  });

  it('disabled users cannot use existing tokens', async () => {
    const token = await tokenFor('a@test.local');
    await prisma.user.update({ where: { email: 'a@test.local' }, data: { isActive: false } });
    const { invalidateUserCache } = await import('../src/services/authService');
    invalidateUserCache();
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    await prisma.user.update({ where: { email: 'a@test.local' }, data: { isActive: true } });
    invalidateUserCache();
  });
});
