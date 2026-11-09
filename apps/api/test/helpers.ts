import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { initDb, migrateDb } from '../src/db/client';
import { seed } from '../src/db/seed';

export interface TestCtx {
  app: FastifyInstance;
}

export async function createTestApp(): Promise<FastifyInstance> {
  await initDb('memory://');
  await migrateDb();
  await seed({ quiet: true });
  const { app } = await buildApp();
  await app.ready();
  return app as unknown as FastifyInstance;
}

export type As = { token: string; userId: string };

export async function demoLogin(app: FastifyInstance, as: 'rider' | 'rider2' | 'driver' | 'admin'): Promise<As> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/demo', payload: { as } });
  if (res.statusCode !== 200) throw new Error(`demo login failed: ${res.body}`);
  const body = res.json();
  return { token: body.accessToken, userId: body.user.id };
}

export async function otpLogin(app: FastifyInstance, email: string): Promise<As & { cookie: string }> {
  const req = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email } });
  const { devCode } = req.json();
  const res = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { email, code: devCode } });
  const body = res.json();
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  return { token: body.accessToken, userId: body.user.id, cookie };
}

/** Small typed wrapper around app.inject with a bearer token. */
export function client(app: FastifyInstance, who: As | null) {
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url: `/api${url}`,
      payload: payload as never,
      headers: who ? { authorization: `Bearer ${who.token}` } : {},
    });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload: unknown = {}) => call('POST', url, payload),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    del: (url: string) => call('DELETE', url),
  };
}

export const INDIRANAGAR = { lat: 12.9719, lng: 77.6412 };
export const NEAR_INDIRANAGAR = { lat: 12.9784, lng: 77.6408 };
export const HEBBAL = { lat: 13.0358, lng: 77.597 };

export async function stationId(app: FastifyInstance, code = 'BLR') {
  const res = await app.inject({ method: 'GET', url: '/api/stations' });
  return (res.json() as { id: string; code: string }[]).find((s) => s.code === code)!.id;
}

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
