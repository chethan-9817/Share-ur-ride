import {
  driverPayout,
  haversineKm,
  SOCKET_EVENTS,
  type EarningsDto,
  type LocationPingInput,
} from '@arriveshare/shared';
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { env, fareParams } from '../config/env';
import { db } from '../db/client';
import { drivers, locationPings, rideGroups, rideRequests, stations, users, type Driver } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { dateKeyIST, DAY, MINUTE, startOfDayIST } from '../lib/time';
import { realtime } from '../realtime/hub';
import { replanGroup } from './matching';
import { notify } from './notifications';
import { broadcastLocation, evaluateTrip, shareWithContacts } from './safety';
import { groupRiderUserIds } from './views';

/** Driver-side trip lifecycle: assigned → arrived → (PINs) → on_trip → drops → completed. */

const MAX_PIN_ATTEMPTS = 5;
const ARRIVAL_RADIUS_KM = 0.25;

export async function driverForUser(userId: string): Promise<Driver> {
  const [d] = await db.select().from(drivers).where(eq(drivers.userId, userId));
  if (!d) throw forbidden('Complete driver onboarding first');
  return d;
}

export async function activeGroupFor(driverId: string) {
  const [g] = await db
    .select()
    .from(rideGroups)
    .where(and(eq(rideGroups.driverId, driverId), inArray(rideGroups.status, ['assigned', 'arrived', 'on_trip'])))
    .orderBy(desc(rideGroups.assignedAt))
    .limit(1);
  return g ?? null;
}

async function requireTrip(driverUserId: string) {
  const driver = await driverForUser(driverUserId);
  const group = await activeGroupFor(driver.id);
  if (!group) throw notFound('Active trip');
  return { driver, group };
}

async function rideInGroup(rideId: string, groupId: string) {
  const [ride] = await db.select().from(rideRequests).where(eq(rideRequests.id, rideId));
  if (!ride || ride.groupId !== groupId) throw notFound('Rider in this trip');
  return ride;
}

async function pushGroup(groupId: string) {
  realtime.toGroup(groupId, SOCKET_EVENTS.groupUpdated, { groupId });
  realtime.toUsers(await groupRiderUserIds(groupId), SOCKET_EVENTS.rideUpdated, { groupId });
}

export async function setOnline(userId: string, online: boolean) {
  const driver = await driverForUser(userId);
  if (online && !driver.verified) throw forbidden('Your documents are still being verified');
  if (driver.status === 'busy' && !online) throw conflict('ON_TRIP', 'Finish the current trip before going offline');
  if (driver.status === 'busy') return driver;
  const [d] = await db
    .update(drivers)
    .set({ status: online ? 'online' : 'offline' })
    .where(eq(drivers.id, driver.id))
    .returning();
  return d!;
}

export async function markArrived(driverUserId: string) {
  const { group } = await requireTrip(driverUserId);
  if (group.status !== 'assigned') return group;
  const [g] = await db
    .update(rideGroups)
    .set({ status: 'arrived', arrivedAt: new Date() })
    .where(and(eq(rideGroups.id, group.id), eq(rideGroups.status, 'assigned')))
    .returning();
  for (const uid of await groupRiderUserIds(group.id)) {
    await notify(uid, {
      kind: 'driver_arrived',
      title: 'Your cab is at the pickup point',
      body: 'Share your 4-digit PIN with the driver only after checking the number plate.',
      link: '/rides',
    });
  }
  await pushGroup(group.id);
  return g ?? group;
}

/** PIN check proves the right rider entered the right cab. */
export async function verifyPin(driverUserId: string, rideId: string, pin: string) {
  const { group } = await requireTrip(driverUserId);
  if (group.status === 'assigned') await markArrived(driverUserId);
  const ride = await rideInGroup(rideId, group.id);
  if (ride.status === 'picked_up') return ride;
  if (ride.status !== 'confirmed') throw conflict('NOT_CONFIRMED', 'This rider is not waiting for pickup');
  if (ride.pinAttempts >= MAX_PIN_ATTEMPTS) throw forbidden('Too many wrong PINs — ask the rider to contact support');

  if (ride.pickupPin !== pin) {
    const [r] = await db
      .update(rideRequests)
      .set({ pinAttempts: sql`${rideRequests.pinAttempts} + 1` })
      .where(eq(rideRequests.id, rideId))
      .returning();
    throw badRequest('WRONG_PIN', 'That PIN does not match', {
      attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - r!.pinAttempts),
    });
  }
  const [r] = await db
    .update(rideRequests)
    .set({ status: 'picked_up', pickedUpAt: new Date() })
    .where(and(eq(rideRequests.id, rideId), eq(rideRequests.status, 'confirmed')))
    .returning();
  realtime.toUser(ride.userId, SOCKET_EVENTS.rideUpdated, { rideId, groupId: group.id });
  await pushGroup(group.id);
  return r ?? ride;
}

export async function markNoShow(driverUserId: string, rideId: string) {
  const { group } = await requireTrip(driverUserId);
  if (group.status !== 'arrived' || !group.arrivedAt) throw conflict('NOT_ARRIVED', 'Mark arrival at the hub first');
  const waitedMin = (Date.now() - group.arrivedAt.getTime()) / MINUTE;
  if (waitedMin < env.NO_SHOW_WAIT_MIN) {
    throw conflict('TOO_EARLY', `Please wait ${Math.ceil(env.NO_SHOW_WAIT_MIN - waitedMin)} more minute(s)`);
  }
  const ride = await rideInGroup(rideId, group.id);
  if (ride.status !== 'confirmed') throw conflict('NOT_WAITING', 'Only riders awaiting pickup can be marked no-show');
  await db.update(rideRequests).set({ status: 'no_show' }).where(eq(rideRequests.id, rideId));
  await notify(ride.userId, {
    kind: 'no_show',
    title: 'Marked as no-show',
    body: 'Your driver waited but could not find you. Contact support if this is a mistake.',
    link: `/rides/${rideId}`,
  });
  await replanGroup(group.id);
  await pushGroup(group.id);
}

export async function startTrip(driverUserId: string) {
  const { group } = await requireTrip(driverUserId);
  if (group.status === 'on_trip') return group;
  const riders = await db.select().from(rideRequests).where(eq(rideRequests.groupId, group.id));
  const waiting = riders.filter((r) => r.status === 'confirmed');
  if (waiting.length) throw conflict('RIDERS_WAITING', `${waiting.length} rider(s) still need PIN verification or no-show`);
  if (!riders.some((r) => r.status === 'picked_up')) throw conflict('EMPTY_CAB', 'No riders on board');

  const [g] = await db
    .update(rideGroups)
    .set({ status: 'on_trip', startedAt: new Date() })
    .where(and(eq(rideGroups.id, group.id), inArray(rideGroups.status, ['assigned', 'arrived'])))
    .returning();

  // Auto-share the live trip with trusted contacts for riders who opted in.
  const onboard = await db
    .select({ ride: rideRequests, user: users })
    .from(rideRequests)
    .innerJoin(users, eq(users.id, rideRequests.userId))
    .where(and(eq(rideRequests.groupId, group.id), eq(rideRequests.status, 'picked_up')));
  for (const { ride, user } of onboard) {
    if (user.safety.autoShareTrips) await shareWithContacts(ride.id, user.id).catch(() => undefined);
  }
  await pushGroup(group.id);
  return g ?? group;
}

export async function dropRider(driverUserId: string, rideId: string) {
  const { driver, group } = await requireTrip(driverUserId);
  if (group.status !== 'on_trip') throw conflict('NOT_STARTED', 'Start the trip first');
  const ride = await rideInGroup(rideId, group.id);
  if (ride.status === 'completed') return ride;
  if (ride.status !== 'picked_up') throw conflict('NOT_ONBOARD', 'This rider is not on board');

  const final = ride.acceptedFare ?? ride.quotedFare ?? ride.soloFare;
  await db
    .update(rideRequests)
    .set({ status: 'completed', droppedAt: new Date(), finalFare: final })
    .where(eq(rideRequests.id, rideId));
  await notify(ride.userId, {
    kind: 'dropped',
    title: 'You have arrived 🏠',
    body: `Trip complete. You paid ₹${Math.round(final)} and saved ₹${Math.max(0, Math.round(ride.soloFare - final))}. Rate your ride?`,
    link: `/rides/${rideId}`,
  });

  const left = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rideRequests)
    .where(and(eq(rideRequests.groupId, group.id), eq(rideRequests.status, 'picked_up')));
  if ((left[0]?.n ?? 0) === 0) await completeTrip(group.id, driver);
  else await pushGroup(group.id);
  return ride;
}

async function completeTrip(groupId: string, driver: Driver) {
  const [{ pax } = { pax: 0 }] = await db
    .select({ pax: sql<number>`coalesce(sum(${rideRequests.seats}), 0)::int` })
    .from(rideRequests)
    .where(and(eq(rideRequests.groupId, groupId), eq(rideRequests.status, 'completed')));
  const [group] = await db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
  const payout = driverPayout(group!.groupFare, pax, driver.seats, fareParams);
  await db.transaction(async (tx) => {
    await tx
      .update(rideGroups)
      .set({ status: 'completed', completedAt: new Date(), driverNet: payout.net, driverBonus: payout.bonus })
      .where(eq(rideGroups.id, groupId));
    await tx.update(drivers).set({ status: 'online' }).where(eq(drivers.id, driver.id));
  });
  await notify(driver.userId, {
    kind: 'trip_completed',
    title: 'Trip completed 💰',
    body: `You earned ₹${Math.round(payout.net)}${payout.bonus ? ` including a ₹${Math.round(payout.bonus)} full-cab bonus` : ''}.`,
    link: '/driver/earnings',
  });
  await pushGroup(groupId);
}

/** Every GPS ping from the driver app lands here (REST or socket). */
export async function ingestLocation(driverUserId: string, p: LocationPingInput) {
  const driver = await driverForUser(driverUserId);
  await db
    .update(drivers)
    .set({ lat: p.lat, lng: p.lng, heading: p.heading ?? null, locationUpdatedAt: new Date() })
    .where(eq(drivers.id, driver.id));

  const group = await activeGroupFor(driver.id);
  if (!group) return { tracked: false };

  await db.insert(locationPings).values({
    driverId: driver.id,
    groupId: group.id,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading ?? null,
    speedKmh: p.speedKmh ?? null,
    accuracyM: p.accuracyM ?? null,
  });

  await broadcastLocation(group.id, {
    groupId: group.id,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading ?? null,
    speedKmh: p.speedKmh ?? null,
    at: new Date().toISOString(),
  });

  // Auto-detect arrival at the hub.
  if (group.status === 'assigned') {
    const [st] = await db.select().from(stations).where(eq(stations.id, group.stationId));
    if (st && haversineKm(st, p) <= ARRIVAL_RADIUS_KM) await markArrived(driverUserId);
  }
  if (group.status === 'on_trip') await evaluateTrip(group.id);
  return { tracked: true, groupId: group.id };
}

export async function earnings(driverId: string): Promise<EarningsDto> {
  const since = new Date(Date.now() - 30 * DAY);
  const rows = await db
    .select({
      id: rideGroups.id,
      completedAt: rideGroups.completedAt,
      net: rideGroups.driverNet,
      bonus: rideGroups.driverBonus,
      pax: sql<number>`(select coalesce(sum(r.seats),0)::int from ride_requests r where r.group_id = ${rideGroups.id} and r.status = 'completed')`,
    })
    .from(rideGroups)
    .where(and(eq(rideGroups.driverId, driverId), eq(rideGroups.status, 'completed'), isNotNull(rideGroups.completedAt)));

  const today = startOfDayIST();
  const weekAgo = new Date(today.getTime() - 6 * DAY);
  const sum = (list: typeof rows) => ({
    trips: list.length,
    net: Math.round(list.reduce((s, r) => s + (r.net ?? 0), 0)),
    passengers: list.reduce((s, r) => s + r.pax, 0),
  });
  const daily = new Map<string, { net: number; trips: number }>();
  for (let i = 13; i >= 0; i--) daily.set(dateKeyIST(new Date(today.getTime() - i * DAY)), { net: 0, trips: 0 });
  for (const r of rows) {
    if (!r.completedAt || r.completedAt < since) continue;
    const k = dateKeyIST(r.completedAt);
    const d = daily.get(k);
    if (d) {
      d.net += r.net ?? 0;
      d.trips += 1;
    }
  }
  return {
    today: sum(rows.filter((r) => r.completedAt! >= today)),
    week: sum(rows.filter((r) => r.completedAt! >= weekAgo)),
    lifetime: { ...sum(rows), bonus: Math.round(rows.reduce((s, r) => s + (r.bonus ?? 0), 0)) },
    daily: [...daily.entries()].map(([date, v]) => ({ date, net: Math.round(v.net), trips: v.trips })),
  };
}

export async function recentTrips(driverId: string, limit = 20) {
  return db
    .select({
      id: rideGroups.id,
      completedAt: rideGroups.completedAt,
      routeKm: rideGroups.routeKm,
      net: rideGroups.driverNet,
      bonus: rideGroups.driverBonus,
      station: stations.name,
    })
    .from(rideGroups)
    .innerJoin(stations, eq(stations.id, rideGroups.stationId))
    .where(and(eq(rideGroups.driverId, driverId), eq(rideGroups.status, 'completed'), gte(rideGroups.completedAt, new Date(0))))
    .orderBy(desc(rideGroups.completedAt))
    .limit(limit);
}
