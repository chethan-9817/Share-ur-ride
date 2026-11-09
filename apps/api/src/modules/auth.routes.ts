import { requestOtpSchema, verifyOtpSchema } from '@arriveshare/shared';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { env, isProd } from '../config/env';
import { db } from '../db/client';
import { users, type User } from '../db/schema';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { DAY } from '../lib/time';
import { REFRESH_COOKIE } from '../plugins/auth';
import {
  createRefreshToken,
  DEMO_ACCOUNTS,
  requestOtp,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyOtp,
} from '../services/auth';
import { userDto } from '../services/views';

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const setRefreshCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/api/auth',
      maxAge: (env.REFRESH_TOKEN_TTL_DAYS * DAY) / 1000,
    });

  const session = async (user: User, reply: FastifyReply, ua?: string) => {
    const refresh = await createRefreshToken(user.id, ua);
    setRefreshCookie(reply, refresh);
    return { accessToken: app.jwt.sign({ sub: user.id, role: user.role }), user: userDto(user) };
  };

  app.post(
    '/otp/request',
    {
      schema: { body: requestOtpSchema, tags: ['auth'], summary: 'Email a 6-digit sign-in code' },
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    },
    async (req) => {
      const res = await requestOtp(req.body.email);
      return { sent: true, delivered: res.delivered, devCode: res.devCode };
    },
  );

  app.post(
    '/otp/verify',
    {
      schema: { body: verifyOtpSchema, tags: ['auth'], summary: 'Exchange a code for a session' },
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    },
    async (req, reply) => {
      const user = await verifyOtp(req.body.email, req.body.code);
      return session(user, reply, req.headers['user-agent']);
    },
  );

  app.post('/refresh', { schema: { tags: ['auth'] } }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('No session');
    const { user, refreshToken } = await rotateRefreshToken(token, req.headers['user-agent']);
    setRefreshCookie(reply, refreshToken);
    return { accessToken: app.jwt.sign({ sub: user.id, role: user.role }), user: userDto(user) };
  });

  app.post('/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) await revokeRefreshToken(token);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.post(
    '/demo',
    {
      schema: {
        body: z.object({ as: z.enum(['rider', 'rider2', 'driver', 'admin']) }),
        tags: ['auth'],
        summary: 'One-tap login for seeded demo accounts (DEMO_MODE only)',
      },
    },
    async (req, reply) => {
      if (!env.DEMO_MODE) throw forbidden('Demo logins are disabled');
      const [user] = await db.select().from(users).where(eq(users.email, DEMO_ACCOUNTS[req.body.as]));
      if (!user) throw notFound('Demo account (run npm run db:seed)');
      return session(user, reply, req.headers['user-agent']);
    },
  );

  app.get('/config', { schema: { tags: ['auth'] } }, async () => ({
    demoMode: env.DEMO_MODE,
    simulator: env.DEMO_MODE && env.SIMULATOR_ENABLED,
    acceptWindowSec: env.ACCEPT_WINDOW_SEC,
    offerTimeoutSec: env.OFFER_TIMEOUT_SEC,
    noShowWaitMin: env.NO_SHOW_WAIT_MIN,
  }));
};

export default authRoutes;
