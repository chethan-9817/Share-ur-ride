import { checkInSchema, raiseSosSchema } from '@arriveshare/shared';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listSos, raiseSos, respondCheckIn, shareView } from '../services/safety';

const safetyRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Public: what a trusted contact sees when they open a live-trip link. No auth by design. */
  app.get(
    '/share/:token',
    {
      schema: { params: z.object({ token: z.string().min(10).max(64) }), tags: ['safety'] },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => shareView(req.params.token),
  );

  app.register(async (plain) => {
    const authed = plain.withTypeProvider<ZodTypeProvider>();
    authed.addHook('preHandler', app.authenticate);

    authed.post(
      '/safety/sos',
      { schema: { body: raiseSosSchema, tags: ['safety'], summary: 'Raise an SOS (silent to the driver)' } },
      async (req, reply) => {
        reply.status(201);
        return raiseSos(req.user.sub, req.body);
      },
    );

    authed.get('/safety/sos', { schema: { tags: ['safety'] } }, async (req) => listSos({ userId: req.user.sub }));

    authed.post('/safety/check-in', { schema: { body: checkInSchema, tags: ['safety'] } }, async (req) =>
      respondCheckIn(req.user.sub, req.body.rideId, req.body.safe),
    );
  });
};

export default safetyRoutes;
