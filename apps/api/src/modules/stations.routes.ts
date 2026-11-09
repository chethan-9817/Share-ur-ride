import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { stations } from '../db/schema';
import { must } from '../lib/errors';
import { reverseGeocode, searchPlaces } from '../services/geocode';
import { stationDto } from '../services/views';

const stationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/stations', { schema: { tags: ['places'] } }, async () => {
    const rows = await db.select().from(stations).where(eq(stations.active, true)).orderBy(asc(stations.name));
    return rows.map(stationDto);
  });

  app.get(
    '/stations/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), tags: ['places'] } },
    async (req) => {
      const [s] = await db.select().from(stations).where(eq(stations.id, req.params.id));
      return stationDto(must(s, 'Station'));
    },
  );

  app.get(
    '/places',
    {
      schema: {
        querystring: z.object({ q: z.string().max(120).default(''), stationId: z.string().uuid().optional() }),
        tags: ['places'],
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      let near: { lat: number; lng: number } | undefined;
      if (req.query.stationId) {
        const [s] = await db.select().from(stations).where(eq(stations.id, req.query.stationId));
        if (s) near = { lat: s.lat, lng: s.lng };
      }
      return searchPlaces(req.query.q, near);
    },
  );

  app.get(
    '/places/reverse',
    {
      schema: {
        querystring: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
        tags: ['places'],
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => ({ label: await reverseGeocode(req.query.lat, req.query.lng) }),
  );
};

export default stationRoutes;
