import {
  co2SavedKg,
  createRideSchema,
  groupFare,
  quoteSchema,
  round2,
  soloFare,
  TOLERANCE_OPTIONS,
  updateRideSchema,
  type FareQuoteDto,
} from '@arriveshare/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { env, fareParams } from '../config/env';
import { db } from '../db/client';
import { ratings, rideRequests, stations, users } from '../db/schema';
import { numericCode } from '../lib/crypto';
import { badRequest, conflict, forbidden, must } from '../lib/errors';
import { acceptRide, cancelRide, goSolo, leaveGroup, runMatching } from '../services/matching';
import { routeThrough } from '../services/routing';
import { ensureShare, revokeShare, safetyTimeline, shareWithContacts } from '../services/safety';
import { spawnCoRiders } from '../services/simulator';
import { groupView, rideDto, rideView } from '../services/views';

const idParams = z.object({ id: z.string().uuid() });
const ACTIVE = ['pending', 'matched', 'confirmed', 'picked_up'] as const;

const rideRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  async function ownRide(id: string, userId: string) {
    const [r] = await db.select().from(rideRequests).where(eq(rideRequests.id, id));
    const ride = must(r, 'Ride');
    if (ride.userId !== userId) throw forbidden();
    return ride;
  }

  /** Price check before booking — no state is created. */
  app.post('/quote', { schema: { body: quoteSchema, tags: ['rides'] } }, async (req): Promise<FareQuoteDto> => {
    const [s] = await db.select().from(stations).where(eq(stations.id, req.body.stationId));
    const station = must(s, 'Station');
    const route = await routeThrough([{ lat: station.lat, lng: station.lng }, req.body.destination]);
    const solo = soloFare(route.km, fareParams);
    // Typical pool: ~2.8 riders sharing a route ~15 % longer than a solo trip.
    const est = Math.min(solo, round2(groupFare(route.km * 1.15, fareParams) / 2.8));
    return {
      soloKm: route.km,
      soloFare: solo,
      estimatedSharedFare: est,
      estimatedSavingsPct: Math.round(((solo - est) / solo) * 100),
      etaMin: route.durationMin,
      co2SavedKg: co2SavedKg(route.km * 2.8, route.km * 1.15),
    };
  });

  app.post(
    '/',
    { schema: { body: createRideSchema, tags: ['rides'] }, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = req.body;
      const [u] = await db.select().from(users).where(eq(users.id, req.user.sub));
      const user = must(u, 'User');
      if (user.role !== 'rider' && user.role !== 'admin') throw forbidden('Only riders can book rides');
      if ((body.womenOnly || body.preferFemaleDriver) && user.gender !== 'female') {
        throw badRequest('WOMEN_ONLY_GENDER', 'Women-only options are available to riders who identify as women');
      }
      const [active] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(rideRequests)
        .where(and(eq(rideRequests.userId, user.id), inArray(rideRequests.status, [...ACTIVE])));
      if ((active?.n ?? 0) > 0) throw conflict('ACTIVE_RIDE', 'You already have an active ride');

      const [s] = await db.select().from(stations).where(eq(stations.id, body.stationId));
      const station = must(s, 'Station');
      const route = await routeThrough([{ lat: station.lat, lng: station.lng }, body.destination]);
      if (route.km < 2) throw badRequest('TOO_CLOSE', 'Destination is too close to the hub to pool');
      if (route.km > env.MAX_TRIP_KM) {
        throw badRequest('TOO_FAR', `Destination is more than ${env.MAX_TRIP_KM} km from the hub — outside our service area`);
      }

      const [ride] = await db
        .insert(rideRequests)
        .values({
          userId: user.id,
          stationId: station.id,
          destLat: body.destination.lat,
          destLng: body.destination.lng,
          destinationLabel: body.destinationLabel,
          arrivalAt: body.arrivalAt,
          toleranceMin: body.toleranceMin,
          seats: body.seats,
          luggage: body.luggage,
          flightOrTrain: body.flightOrTrain?.toUpperCase() || null,
          womenOnly: body.womenOnly,
          preferFemaleDriver: body.preferFemaleDriver || body.womenOnly,
          soloKm: route.km,
          soloFare: soloFare(route.km, fareParams),
          pickupPin: numericCode(4),
        })
        .returning();

      // Reactive matching: try to pool immediately instead of waiting for the next tick.
      await spawnCoRiders(ride!).catch((err) => req.log.warn({ err }, 'co-rider spawn failed'));
      await runMatching().catch((err) => req.log.warn({ err }, 'inline matching failed'));
      reply.status(201);
      return rideView(ride!.id, user.id);
    },
  );

  app.get(
    '/',
    { schema: { querystring: z.object({ scope: z.enum(['active', 'history', 'all']).default('all') }), tags: ['rides'] } },
    async (req) => {
      const scope = req.query.scope;
      const statuses =
        scope === 'active' ? [...ACTIVE] : scope === 'history' ? (['completed', 'cancelled', 'no_show', 'expired'] as const) : null;
      const rows = await db
        .select({ ride: rideRequests, station: stations, rated: sql<boolean>`exists(select 1 from ${ratings} where ${ratings.rideId} = ${rideRequests.id} and ${ratings.raterId} = ${req.user.sub})` })
        .from(rideRequests)
        .innerJoin(stations, eq(stations.id, rideRequests.stationId))
        .where(
          and(eq(rideRequests.userId, req.user.sub), statuses ? inArray(rideRequests.status, [...statuses]) : undefined),
        )
        .orderBy(desc(rideRequests.createdAt))
        .limit(50);
      return rows.map((r) => rideDto(r.ride, r.station, r.rated));
    },
  );

  app.get('/:id', { schema: { params: idParams, tags: ['rides'] } }, async (req) => {
    await ownRide(req.params.id, req.user.sub);
    return rideView(req.params.id, req.user.sub);
  });

  app.patch('/:id', { schema: { params: idParams, body: updateRideSchema, tags: ['rides'] } }, async (req) => {
    const ride = await ownRide(req.params.id, req.user.sub);
    if (ride.status !== 'pending') throw conflict('NOT_PENDING', 'You can only edit a ride while we are still searching');
    if (req.body.toleranceMin != null && !(TOLERANCE_OPTIONS as readonly number[]).includes(req.body.toleranceMin)) {
      throw badRequest('BAD_TOLERANCE', 'Unsupported wait window');
    }
    await db
      .update(rideRequests)
      .set({
        ...req.body,
        flightOrTrain: req.body.flightOrTrain?.toUpperCase(),
        version: sql`${rideRequests.version} + 1`,
      })
      .where(and(eq(rideRequests.id, ride.id), eq(rideRequests.status, 'pending')));
    await runMatching().catch(() => undefined);
    return rideView(ride.id, req.user.sub);
  });

  app.post('/:id/accept', { schema: { params: idParams, tags: ['rides'] } }, async (req) => {
    await acceptRide(req.params.id, req.user.sub);
    return rideView(req.params.id, req.user.sub);
  });

  app.post('/:id/decline', { schema: { params: idParams, tags: ['rides'] } }, async (req) => {
    await leaveGroup(req.params.id, req.user.sub, 'declined');
    return rideView(req.params.id, req.user.sub);
  });

  app.post('/:id/solo', { schema: { params: idParams, tags: ['rides'] } }, async (req) => {
    await goSolo(req.params.id, req.user.sub);
    return rideView(req.params.id, req.user.sub);
  });

  app.post(
    '/:id/cancel',
    { schema: { params: idParams, body: z.object({ reason: z.string().max(200).optional() }).default({}), tags: ['rides'] } },
    async (req) => {
      await cancelRide(req.params.id, req.user.sub, req.body.reason);
      return rideView(req.params.id, req.user.sub);
    },
  );

  app.get('/:id/group', { schema: { params: idParams, tags: ['rides'] } }, async (req) => {
    const ride = await ownRide(req.params.id, req.user.sub);
    if (!ride.groupId) return null;
    return groupView(ride.groupId, { userId: req.user.sub, role: req.user.role });
  });

  // ── Safety: live sharing ──
  app.post(
    '/:id/share',
    { schema: { params: idParams, body: z.object({ notifyContacts: z.boolean().default(false) }).default({}), tags: ['safety'] } },
    async (req) => {
      await ownRide(req.params.id, req.user.sub);
      if (req.body.notifyContacts) return shareWithContacts(req.params.id, req.user.sub);
      return ensureShare(req.params.id, req.user.sub);
    },
  );

  app.delete('/:id/share', { schema: { params: idParams, tags: ['safety'] } }, async (req) => {
    await revokeShare(req.params.id, req.user.sub);
    return { ok: true };
  });

  app.get('/:id/safety', { schema: { params: idParams, tags: ['safety'] } }, async (req) => {
    await ownRide(req.params.id, req.user.sub);
    return safetyTimeline(req.params.id);
  });
};

export default rideRoutes;
