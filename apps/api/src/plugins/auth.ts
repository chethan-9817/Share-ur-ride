import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { Role } from '@arriveshare/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';

export interface AccessClaims {
  sub: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const REFRESH_COOKIE = 'as_rt';

/**
 * Short-lived access JWT in the Authorization header (kept in memory by the SPA),
 * long-lived opaque refresh token in an httpOnly cookie scoped to /api/auth.
 */
export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` },
  });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized('Your session has expired — please sign in again');
    }
  });

  app.decorate(
    'requireRole',
    (...roles: Role[]) =>
      async (req: FastifyRequest) => {
        try {
          await req.jwtVerify();
        } catch {
          throw unauthorized();
        }
        if (!roles.includes(req.user.role)) throw forbidden();
      },
  );
});
