import { resolveSosSchema, ROLES, type AdminOverviewDto } from '@arriveshare/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { drivers, rideGroups, rideRequests, safetyEvents, sosIncidents, users } from '../db/schema';
import { must } from '../lib/errors';
import { startOfDayIST } from '../lib/time';
import { listSos, safetyEventDto, updateSos } from '../services/safety';
import { userDto } from '../services/views';

const count = sql<number>`count(*)::int`;

const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireRole('admin'));

  app.get('/overview', { schema: { tags: ['admin'] } }, async (): Promise<AdminOverviewDto> => {
    const today = startOfDayIST();
    const [[u], [d], [online], [rides], [pooled], [active], [sos], [saved]] = await Promise.all([
      db.select({ n: count }).from(users).where(eq(users.simulated, false)),
      db.select({ n: count }).from(drivers),
      db.select({ n: count }).from(drivers).where(inArray(drivers.status, ['online', 'busy'])),
      db.select({ n: count }).from(rideRequests).where(gte(rideRequests.createdAt, today)),
      db
        .select({ n: count })
        .from(rideRequests)
        .where(and(gte(rideRequests.createdAt, today), sql`${rideRequests.groupId} is not null`)),
      db.select({ n: count }).from(rideGroups).where(inArray(rideGroups.status, ['accepting', 'dispatching', 'assigned', 'arrived', 'on_trip'])),
      db.select({ n: count }).from(sosIncidents).where(inArray(sosIncidents.status, ['open', 'acknowledged'])),
      db
        .select({
          savings: sql<number>`coalesce(sum(${rideRequests.soloFare} - ${rideRequests.finalFare}), 0)::float`,
          km: sql<number>`coalesce(sum(${rideRequests.soloKm}), 0)::float`,
        })
        .from(rideRequests)
        .where(and(eq(rideRequests.status, 'completed'), gte(rideRequests.droppedAt, today))),
    ]);
    const [routeKm] = await db
      .select({ km: sql<number>`coalesce(sum(${rideGroups.routeKm}), 0)::float` })
      .from(rideGroups)
      .where(and(eq(rideGroups.status, 'completed'), gte(rideGroups.completedAt, today)));
    return {
      users: u?.n ?? 0,
      drivers: d?.n ?? 0,
      driversOnline: online?.n ?? 0,
      ridesToday: rides?.n ?? 0,
      activeGroups: active?.n ?? 0,
      openSos: sos?.n ?? 0,
      pooledRatePct: rides?.n ? Math.round(((pooled?.n ?? 0) / rides.n) * 100) : 0,
      savingsToday: Math.round(saved?.savings ?? 0),
      co2SavedKg: Math.round(Math.max(0, (saved?.km ?? 0) - (routeKm?.km ?? 0)) * 0.12 * 10) / 10,
    };
  });

  app.get(
    '/sos',
    { schema: { querystring: z.object({ open: z.coerce.boolean().default(false) }), tags: ['admin'] } },
    async (req) => listSos(req.query.open ? { status: ['open', 'acknowledged'] } : {}),
  );

  app.patch(
    '/sos/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), body: resolveSosSchema, tags: ['admin'] } },
    async (req) => updateSos(req.params.id, req.user.sub, req.body.status, req.body.note),
  );

  app.get('/safety-events', { schema: { tags: ['admin'] } }, async () => {
    const rows = await db
      .select()
      .from(safetyEvents)
      .where(inArray(safetyEvents.severity, ['warning', 'critical']))
      .orderBy(desc(safetyEvents.createdAt))
      .limit(50);
    return rows.map(safetyEventDto);
  });

  app.get('/drivers', { schema: { tags: ['admin'] } }, async () => {
    const rows = await db
      .select({ driver: drivers, user: users })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .orderBy(desc(drivers.createdAt));
    return rows.map(({ driver, user }) => ({
      id: driver.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      gender: user.gender,
      status: driver.status,
      verified: driver.verified,
      simulated: user.simulated,
      vehicle: `${driver.vehicleColor} ${driver.vehicleModel}`,
      vehicleNumber: driver.vehicleNumber,
      licenseNumber: driver.licenseNumber,
      rating: user.ratingCount ? Math.round((user.ratingSum / user.ratingCount) * 10) / 10 : null,
      location: driver.lat != null ? { lat: driver.lat, lng: driver.lng } : null,
    }));
  });

  app.patch(
    '/drivers/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ verified: z.boolean() }), tags: ['admin'] } },
    async (req) => {
      const [d] = await db
        .update(drivers)
        .set({ verified: req.body.verified, ...(req.body.verified ? {} : { status: 'offline' as const }) })
        .where(eq(drivers.id, req.params.id))
        .returning();
      return { id: must(d, 'Driver').id, verified: d!.verified };
    },
  );

  app.get(
    '/users',
    { schema: { querystring: z.object({ q: z.string().max(80).default('') }), tags: ['admin'] } },
    async (req) => {
      const q = `%${req.query.q}%`;
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.simulated, false), req.query.q ? or(ilike(users.name, q), ilike(users.email, q)) : undefined))
        .orderBy(desc(users.createdAt))
        .limit(100);
      return rows.map((u) => ({ ...userDto(u), suspended: u.suspended }));
    },
  );

  app.patch(
    '/users/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ suspended: z.boolean().optional(), role: z.enum(ROLES).optional() }),
        tags: ['admin'],
      },
    },
    async (req) => {
      const [u] = await db.update(users).set(req.body).where(eq(users.id, req.params.id)).returning();
      return { ...userDto(must(u, 'User')), suspended: u!.suspended };
    },
  );

  /** Live operations map: every online driver plus active trips. */
  app.get('/live', { schema: { tags: ['admin'] } }, async () => {
    const ds = await db
      .select({ id: drivers.id, name: users.name, status: drivers.status, lat: drivers.lat, lng: drivers.lng, heading: drivers.heading, vehicleNumber: drivers.vehicleNumber })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(inArray(drivers.status, ['online', 'busy']));
    const groups = await db
      .select({ id: rideGroups.id, status: rideGroups.status, driverId: rideGroups.driverId, route: rideGroups.route, womenOnly: rideGroups.womenOnly })
      .from(rideGroups)
      .where(inArray(rideGroups.status, ['assigned', 'arrived', 'on_trip']));
    return { drivers: ds.filter((d) => d.lat != null), groups };
  });
};

export default adminRoutes;
