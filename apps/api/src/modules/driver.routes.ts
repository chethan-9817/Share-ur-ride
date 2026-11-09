import { driverOnboardSchema, locationPingSchema, verifyPinSchema, type DriverProfileDto } from '@arriveshare/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../config/env';
import { db } from '../db/client';
import { drivers, users, type Driver, type User } from '../db/schema';
import { conflict } from '../lib/errors';
import { pendingOfferFor, respondToOffer } from '../services/dispatch';
import {
  activeGroupFor,
  driverForUser,
  dropRider,
  earnings,
  ingestLocation,
  markArrived,
  markNoShow,
  recentTrips,
  setOnline,
  startTrip,
  verifyPin,
} from '../services/trips';
import { groupView } from '../services/views';

function profileDto(d: Driver, u: User): DriverProfileDto {
  return {
    id: d.id,
    status: d.status,
    verified: d.verified,
    licenseNumber: d.licenseNumber,
    vehicle: { number: d.vehicleNumber, model: d.vehicleModel, color: d.vehicleColor, type: d.vehicleType, seats: d.seats },
    location: d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null,
    ratingAvg: u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 10) / 10 : null,
    ratingCount: u.ratingCount,
  };
}

const rideIdBody = z.object({ rideId: z.string().uuid() });

const driverRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** Any signed-in user can apply to drive; admins verify documents before they can go online. */
  app.post('/onboard', { schema: { body: driverOnboardSchema, tags: ['driver'] } }, async (req, reply) => {
    const [existing] = await db.select().from(drivers).where(eq(drivers.userId, req.user.sub));
    if (existing) throw conflict('ALREADY_DRIVER', 'You are already registered as a driver');
    const [taken] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.vehicleNumber, req.body.vehicleNumber));
    if (taken) throw conflict('VEHICLE_TAKEN', 'This vehicle is already registered');
    const [d] = await db
      .insert(drivers)
      .values({
        userId: req.user.sub,
        ...req.body,
        luggageCapacity: req.body.vehicleType === 'suv' ? 6 : req.body.vehicleType === 'hatchback' ? 2 : 4,
        // Demo deployments auto-verify so the flow can be tried end to end.
        verified: env.DEMO_MODE,
      })
      .returning();
    const [u] = await db.update(users).set({ role: 'driver' }).where(eq(users.id, req.user.sub)).returning();
    reply.status(201);
    return { profile: profileDto(d!, u!), accessToken: app.jwt.sign({ sub: u!.id, role: 'driver' }) };
  });

  app.register(async (scoped) => {
    scoped.addHook('preHandler', app.requireRole('driver'));

    scoped.get('/me', { schema: { tags: ['driver'] } }, async (req) => {
      const d = await driverForUser(req.user.sub);
      const [u] = await db.select().from(users).where(eq(users.id, req.user.sub));
      return profileDto(d, u!);
    });

    scoped.post('/status', { schema: { body: z.object({ online: z.boolean() }), tags: ['driver'] } }, async (req) => {
      const d = await setOnline(req.user.sub, req.body.online);
      return { status: d.status };
    });

    scoped.post(
      '/location',
      { schema: { body: locationPingSchema, tags: ['driver'] }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
      async (req) => ingestLocation(req.user.sub, req.body),
    );

    scoped.get('/offer', { schema: { tags: ['driver'] } }, async (req) => {
      const d = await driverForUser(req.user.sub);
      return pendingOfferFor(d.id);
    });

    scoped.post(
      '/offers/:id/:action',
      { schema: { params: z.object({ id: z.string().uuid(), action: z.enum(['accept', 'reject']) }), tags: ['driver'] } },
      async (req) => respondToOffer(req.params.id, req.user.sub, req.params.action === 'accept'),
    );

    scoped.get('/trip', { schema: { tags: ['driver'] } }, async (req) => {
      const d = await driverForUser(req.user.sub);
      const g = await activeGroupFor(d.id);
      if (!g) return null;
      return {
        ...(await groupView(g.id, { userId: req.user.sub, role: 'driver' })),
        arrivedAt: g.arrivedAt?.toISOString() ?? null,
        noShowWaitMin: env.NO_SHOW_WAIT_MIN,
      };
    });

    scoped.post('/trip/arrive', { schema: { tags: ['driver'] } }, async (req) => {
      await markArrived(req.user.sub);
      return { ok: true };
    });
    scoped.post('/trip/verify-pin', { schema: { body: verifyPinSchema, tags: ['driver'] } }, async (req) => {
      const r = await verifyPin(req.user.sub, req.body.rideId, req.body.pin);
      return { ok: true, status: r.status };
    });
    scoped.post('/trip/no-show', { schema: { body: rideIdBody, tags: ['driver'] } }, async (req) => {
      await markNoShow(req.user.sub, req.body.rideId);
      return { ok: true };
    });
    scoped.post('/trip/start', { schema: { tags: ['driver'] } }, async (req) => {
      await startTrip(req.user.sub);
      return { ok: true };
    });
    scoped.post('/trip/drop', { schema: { body: rideIdBody, tags: ['driver'] } }, async (req) => {
      await dropRider(req.user.sub, req.body.rideId);
      return { ok: true };
    });

    scoped.get('/earnings', { schema: { tags: ['driver'] } }, async (req) => {
      const d = await driverForUser(req.user.sub);
      return { summary: await earnings(d.id), trips: await recentTrips(d.id) };
    });
  });
};

export default driverRoutes;
