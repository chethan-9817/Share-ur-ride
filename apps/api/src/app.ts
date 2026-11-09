import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { env, isProd, isTest } from './config/env';
import { db } from './db/client';
import adminRoutes from './modules/admin.routes';
import authRoutes from './modules/auth.routes';
import driverRoutes from './modules/driver.routes';
import meRoutes from './modules/me.routes';
import ratingRoutes from './modules/ratings.routes';
import rideRoutes from './modules/rides.routes';
import safetyRoutes from './modules/safety.routes';
import stationRoutes from './modules/stations.routes';
import authPlugin from './plugins/auth';
import errorsPlugin from './plugins/errors';

export async function buildApp() {
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: env.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
        },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

  await app.register(errorsPlugin);
  await app.register(helmet, {
    // The SPA is served from the same origin in production; map tiles come from CARTO/OSM.
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://*.basemaps.cartocdn.com', 'https://*.tile.openstreetmap.org'],
            connectSrc: ["'self'", 'wss:', 'https:'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          },
        }
      : false,
  });
  await app.register(cors, { origin: origins, credentials: true });
  // Integration tests fire many requests from one IP; limits are exercised in production config.
  if (!isTest) await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin);

  await app.register(swagger, {
    openapi: {
      info: { title: 'ArriveShare API', version: '2.0.0', description: 'Safe, fair ride-pooling for hub arrivals' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/api/health', { schema: { tags: ['health'] } }, async () => {
    await db.execute(sql`select 1`);
    return { ok: true, time: new Date().toISOString(), demo: env.DEMO_MODE };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(meRoutes, { prefix: '/me' });
      await api.register(stationRoutes);
      await api.register(rideRoutes, { prefix: '/rides' });
      await api.register(driverRoutes, { prefix: '/driver' });
      await api.register(safetyRoutes);
      await api.register(ratingRoutes, { prefix: '/ratings' });
      await api.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api' },
  );

  // Production: serve the built SPA from the same origin (cookies + sockets just work).
  const webDist = path.resolve(process.cwd(), '../web/dist');
  if (isProd && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, origins };
}
