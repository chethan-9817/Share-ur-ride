import { ratingSchema } from '@arriveshare/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { drivers, ratings, rideGroups, rideRequests, safetyEvents, users } from '../db/schema';
import { badRequest, conflict, forbidden, must } from '../lib/errors';
import { realtime } from '../realtime/hub';

/** Two-way ratings. A low score tagged "unsafe" opens a safety review automatically. */
const ratingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.post('/', { schema: { body: ratingSchema, tags: ['ratings'] } }, async (req, reply) => {
    const [r] = await db.select().from(rideRequests).where(eq(rideRequests.id, req.body.rideId));
    const ride = must(r, 'Ride');
    if (ride.status !== 'completed') throw badRequest('NOT_COMPLETED', 'You can rate a ride once it is completed');
    const [g] = ride.groupId ? await db.select().from(rideGroups).where(eq(rideGroups.id, ride.groupId)) : [];
    const [d] = g?.driverId ? await db.select().from(drivers).where(eq(drivers.id, g.driverId)) : [];
    if (!d) throw badRequest('NO_DRIVER', 'This ride had no driver');

    // Rider rates the driver, or the driver rates the rider.
    let rateeId: string;
    if (req.user.sub === ride.userId) rateeId = d.userId;
    else if (req.user.sub === d.userId) rateeId = ride.userId;
    else throw forbidden();

    const inserted = await db
      .insert(ratings)
      .values({
        rideId: ride.id,
        raterId: req.user.sub,
        rateeId,
        score: req.body.score,
        tags: req.body.tags,
        comment: req.body.comment,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) throw conflict('ALREADY_RATED', 'You already rated this ride');

    await db
      .update(users)
      .set({ ratingSum: sql`${users.ratingSum} + ${req.body.score}`, ratingCount: sql`${users.ratingCount} + 1` })
      .where(eq(users.id, rateeId));

    if (req.body.score <= 2 && req.body.tags.some((t) => t === 'unsafe' || t === 'rash_driving')) {
      const [ev] = await db
        .insert(safetyEvents)
        .values({
          type: 'sos',
          severity: 'warning',
          groupId: ride.groupId,
          rideId: ride.id,
          userId: req.user.sub,
          message: `Post-trip safety report (${req.body.tags.join(', ')}): ${req.body.comment ?? 'no comment'}`,
        })
        .returning();
      realtime.toAdmins('safety:alert', { type: 'post_trip_report', message: ev!.message, groupId: ride.groupId });
    }
    reply.status(201);
    return { ok: true };
  });
};

export default ratingRoutes;
