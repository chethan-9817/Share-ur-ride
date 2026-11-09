import { driverPayout, haversineKm, SOCKET_EVENTS, type OfferDto } from '@arriveshare/shared';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { env, fareParams } from '../config/env';
import { db } from '../db/client';
import {
  driverOffers,
  drivers,
  rideGroups,
  rideRequests,
  stations,
  users,
  type DriverOffer,
  type RideGroup,
  type Station,
} from '../db/schema';
import { conflict, forbidden, notFound } from '../lib/errors';
import { addMs, MINUTE, SECOND } from '../lib/time';
import { realtime } from '../realtime/hub';
import { notify } from './notifications';
import { groupRiderUserIds, stationDto } from './views';

/**
 * Sequential, distance-ranked dispatch.
 *
 * A confirmed group is offered to ONE driver at a time (nearest first) for
 * OFFER_TIMEOUT_SEC. Rejections and timeouts escalate to the next driver.
 *
 * Safety: groups with a women-only or female-driver preference are offered to
 * verified female drivers first. Only after FEMALE_DRIVER_PRIORITY_SEC without a
 * taker do we widen to all verified drivers rated ≥ 4.5 (or unrated new drivers).
 */

let onOffer: ((offerId: string, driverId: string) => void) | null = null;
export function setOnOffer(fn: typeof onOffer) {
  onOffer = fn;
}

async function passengerCount(groupId: string) {
  const [row] = await db
    .select({ seats: sql<number>`coalesce(sum(${rideRequests.seats}), 0)::int` })
    .from(rideRequests)
    .where(and(eq(rideRequests.groupId, groupId), inArray(rideRequests.status, ['confirmed', 'picked_up'])));
  return row?.seats ?? 0;
}

export function offerDto(
  offer: DriverOffer,
  group: RideGroup,
  station: Station,
  passengers: number,
  capacity: number,
): OfferDto {
  return {
    id: offer.id,
    groupId: group.id,
    status: offer.status,
    expiresAt: offer.expiresAt.toISOString(),
    station: stationDto(station),
    pickupAt: group.pickupAt.toISOString(),
    passengers,
    routeKm: group.routeKm,
    distanceToHubKm: Math.round(offer.distanceToHubKm * 10) / 10,
    payout: driverPayout(group.groupFare, passengers, capacity, fareParams),
    womenOnly: group.womenOnly,
  };
}

/** Offers the group to the next best driver if nobody holds an open offer. */
export async function dispatchGroup(groupId: string, now = new Date()) {
  const [g] = await db
    .select({ group: rideGroups, station: stations })
    .from(rideGroups)
    .innerJoin(stations, eq(stations.id, rideGroups.stationId))
    .where(eq(rideGroups.id, groupId));
  if (!g || g.group.status !== 'dispatching') return null;

  const offers = await db.select().from(driverOffers).where(eq(driverOffers.groupId, groupId));
  if (offers.some((o) => o.status === 'pending' && o.expiresAt > now)) return null;
  const tried = new Set(offers.map((o) => o.driverId));
  const seatsNeeded = await passengerCount(groupId);

  const pool = await db
    .select({ driver: drivers, user: users })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(and(eq(drivers.status, 'online'), eq(drivers.verified, true), eq(users.suspended, false)));

  const hub = { lat: g.station.lat, lng: g.station.lng };
  const sinceDispatch = now.getTime() - (g.group.dispatchStartedAt ?? now).getTime();
  const femaleFirst = g.group.preferFemaleDriver && sinceDispatch < env.FEMALE_DRIVER_PRIORITY_SEC * SECOND;

  const ranked = pool
    .filter(({ driver }) => !tried.has(driver.id) && driver.seats >= seatsNeeded && driver.lat != null)
    .filter(({ user }) => {
      if (femaleFirst) return user.gender === 'female';
      if (g.group.preferFemaleDriver) {
        const avg = user.ratingCount ? user.ratingSum / user.ratingCount : 5;
        return user.gender === 'female' || avg >= 4.5;
      }
      return true;
    })
    .map((r) => ({ ...r, km: haversineKm(hub, { lat: r.driver.lat!, lng: r.driver.lng! }) }))
    .sort((a, b) => a.km - b.km);

  const pick = ranked[0];
  if (!pick) return null;

  const [offer] = await db
    .insert(driverOffers)
    .values({
      groupId,
      driverId: pick.driver.id,
      distanceToHubKm: pick.km,
      expiresAt: addMs(now, env.OFFER_TIMEOUT_SEC * SECOND),
    })
    .onConflictDoNothing()
    .returning();
  if (!offer) return null;

  realtime.toUser(
    pick.user.id,
    SOCKET_EVENTS.offerReceived,
    offerDto(offer, g.group, g.station, seatsNeeded, pick.driver.seats),
  );
  onOffer?.(offer.id, pick.driver.id);
  return offer;
}

export async function pendingOfferFor(driverId: string) {
  const [row] = await db
    .select({ offer: driverOffers, group: rideGroups, station: stations, driver: drivers })
    .from(driverOffers)
    .innerJoin(rideGroups, eq(rideGroups.id, driverOffers.groupId))
    .innerJoin(stations, eq(stations.id, rideGroups.stationId))
    .innerJoin(drivers, eq(drivers.id, driverOffers.driverId))
    .where(and(eq(driverOffers.driverId, driverId), eq(driverOffers.status, 'pending')));
  if (!row || row.offer.expiresAt < new Date()) return null;
  const pax = await passengerCount(row.group.id);
  return offerDto(row.offer, row.group, row.station, pax, row.driver.seats);
}

export async function respondToOffer(offerId: string, driverUserId: string, accept: boolean) {
  const [row] = await db
    .select({ offer: driverOffers, driver: drivers })
    .from(driverOffers)
    .innerJoin(drivers, eq(drivers.id, driverOffers.driverId))
    .where(eq(driverOffers.id, offerId));
  if (!row) throw notFound('Offer');
  if (row.driver.userId !== driverUserId) throw forbidden();
  if (row.offer.status !== 'pending') throw conflict('OFFER_CLOSED', 'This offer is no longer open');
  if (row.offer.expiresAt < new Date()) throw conflict('OFFER_EXPIRED', 'This offer has expired');
  const groupId = row.offer.groupId;

  if (!accept) {
    await db
      .update(driverOffers)
      .set({ status: 'rejected', respondedAt: new Date() })
      .where(and(eq(driverOffers.id, offerId), eq(driverOffers.status, 'pending')));
    await dispatchGroup(groupId);
    return { accepted: false, groupId };
  }

  await db.transaction(async (tx) => {
    const [offer] = await tx
      .update(driverOffers)
      .set({ status: 'accepted', respondedAt: new Date() })
      .where(and(eq(driverOffers.id, offerId), eq(driverOffers.status, 'pending')))
      .returning();
    if (!offer) throw conflict('OFFER_CLOSED', 'This offer is no longer open');
    const [busy] = await tx
      .update(drivers)
      .set({ status: 'busy' })
      .where(and(eq(drivers.id, row.driver.id), eq(drivers.status, 'online')))
      .returning({ id: drivers.id });
    if (!busy) throw conflict('DRIVER_UNAVAILABLE', 'Go online to accept trips');
    const [group] = await tx
      .update(rideGroups)
      .set({
        status: 'assigned',
        driverId: row.driver.id,
        assignedAt: new Date(),
        version: sql`${rideGroups.version} + 1`,
      })
      .where(and(eq(rideGroups.id, groupId), eq(rideGroups.status, 'dispatching')))
      .returning({ id: rideGroups.id });
    if (!group) throw conflict('GROUP_UNAVAILABLE', 'This trip was cancelled');
  });

  const riderIds = await groupRiderUserIds(groupId);
  const [driverUser] = await db.select().from(users).where(eq(users.id, driverUserId));
  for (const uid of riderIds) {
    await notify(uid, {
      kind: 'driver_assigned',
      title: 'Driver assigned 🚖',
      body: `${driverUser?.name ?? 'Your driver'} · ${row.driver.vehicleColor} ${row.driver.vehicleModel} (${row.driver.vehicleNumber}) is heading to the pickup point.`,
      link: '/rides',
    });
  }
  realtime.toGroup(groupId, SOCKET_EVENTS.groupUpdated, { groupId });
  realtime.toUsers(riderIds, SOCKET_EVENTS.rideUpdated, { groupId });
  return { accepted: true, groupId };
}

/** Times out stale offers and re-offers any group that has nobody holding it. */
export async function sweepDispatch(now = new Date()) {
  const expired = await db
    .update(driverOffers)
    .set({ status: 'expired', respondedAt: now })
    .where(and(eq(driverOffers.status, 'pending'), lte(driverOffers.expiresAt, now)))
    .returning();
  for (const o of expired) {
    const [d] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, o.driverId));
    if (d) realtime.toUser(d.userId, SOCKET_EVENTS.offerCancelled, { offerId: o.id, reason: 'expired' });
  }

  const waiting = await db
    .select({ id: rideGroups.id, since: rideGroups.dispatchStartedAt })
    .from(rideGroups)
    .where(eq(rideGroups.status, 'dispatching'));
  let offered = 0;
  for (const g of waiting) {
    if (await dispatchGroup(g.id, now)) offered++;
    // Keep riders informed if it's taking a while.
    if (g.since && now.getTime() - g.since.getTime() > 5 * MINUTE && now.getTime() - g.since.getTime() < 5 * MINUTE + env.SCHEDULER_INTERVAL_SEC * SECOND) {
      const ids = await groupRiderUserIds(g.id);
      for (const uid of ids) {
        await notify(uid, {
          kind: 'dispatch_slow',
          title: 'Still finding a driver',
          body: 'Drivers near the hub are busy. Your fare stays locked while we keep looking.',
          link: '/rides',
        });
      }
    }
  }
  return { expired: expired.length, offered };
}

/** Frees a driver after a group is cancelled underneath them. */
export async function releaseDriver(driverId: string, groupId: string, reason: string) {
  const [d] = await db
    .update(drivers)
    .set({ status: 'online' })
    .where(and(eq(drivers.id, driverId), eq(drivers.status, 'busy')))
    .returning();
  const [row] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, driverId));
  if (row) {
    await notify(row.userId, {
      kind: 'trip_cancelled',
      title: 'Trip cancelled',
      body: `${reason}. You are back online for new trips.`,
      link: '/driver',
    });
    realtime.toUser(row.userId, SOCKET_EVENTS.groupUpdated, { groupId, cancelled: true });
  }
  return d;
}
