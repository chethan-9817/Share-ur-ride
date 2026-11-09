import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client';
import { outbox } from '../src/services/mailer';
import { client, createTestApp, demoLogin, otpLogin } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('auth', () => {
  it('signs in a brand-new email with an OTP and auto-creates the profile', async () => {
    const email = 'neha.kapoor@example.com';
    const r = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email } });
    expect(r.statusCode).toBe(200);
    const { devCode } = r.json();
    expect(devCode).toMatch(/^\d{6}$/);
    expect(outbox.at(-1)?.to).toBe(email);
    expect(outbox.at(-1)?.text).toContain(devCode);

    const v = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { email, code: devCode } });
    expect(v.statusCode).toBe(200);
    expect(v.json().user.name).toBe('Neha Kapoor');
    expect(v.json().user.onboarded).toBe(false);
    expect(String(v.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('rejects a wrong code and reports attempts left', async () => {
    const email = 'wrong.code@example.com';
    await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email } });
    const v = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { email, code: '000000' } });
    // 1-in-a-million chance the random code really was 000000
    if (v.statusCode === 200) return;
    expect(v.statusCode).toBe(400);
    expect(v.json().error.code).toBe('OTP_INVALID');
    expect(v.json().error.details.attemptsLeft).toBe(4);
  });

  it('validates input with a consistent error shape', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email: 'nope' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('lets two tabs refresh with the same token at the same moment', async () => {
    const { cookie } = await otpLogin(app, 'two.tabs@example.com');
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } }),
      app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
  });

  it('revokes the whole session family when a rotated token is replayed later', async () => {
    const { cookie } = await otpLogin(app, 'rotate.me@example.com');
    const first = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const nextCookie = String(first.headers['set-cookie']).split(';')[0]!;

    // Pretend the old token was rotated a minute ago (outside the grace window).
    const { refreshTokens } = await import('../src/db/schema');
    const { sha256 } = await import('../src/lib/crypto');
    const { db } = await import('../src/db/client');
    const { eq } = await import('drizzle-orm');
    const old = new Date(Date.now() - 60_000);
    await db
      .update(refreshTokens)
      .set({ rotatedAt: old, revokedAt: old })
      .where(eq(refreshTokens.tokenHash, sha256(decodeURIComponent(cookie.split('=')[1]!))));

    const reuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } });
    expect(reuse.statusCode).toBe(401);
    // The legitimately rotated token is now revoked too.
    const after = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: nextCookie } });
    expect(after.statusCode).toBe(401);
  });

  it('does not accept a token after logout, even within the grace window', async () => {
    const { cookie } = await otpLogin(app, 'logout.me@example.com');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const r = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } });
    expect(r.statusCode).toBe(401);
  });

  it('protects routes and enforces roles', async () => {
    expect((await client(app, null).get('/me')).status).toBe(401);
    const rider = await demoLogin(app, 'rider');
    expect((await client(app, rider).get('/me')).body.email).toBe('priya.demo@arriveshare.app');
    expect((await client(app, rider).get('/admin/overview')).status).toBe(403);
    const admin = await demoLogin(app, 'admin');
    expect((await client(app, admin).get('/admin/overview')).status).toBe(200);
  });

  it('completes onboarding once name, phone and gender are set', async () => {
    const u = await otpLogin(app, 'onboard.me@example.com');
    const res = await client(app, u).patch('/me', { name: 'Riya Das', phone: '9876543210', gender: 'female' });
    expect(res.status).toBe(200);
    expect(res.body.onboarded).toBe(true);
    expect(res.body.phone).toBe('+919876543210');
  });
});
