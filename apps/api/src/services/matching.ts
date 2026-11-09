import {
  DEFAULT_MATCH_PARAMS,
  formGroups,
  planGroup,
  splitFare,
  SOCKET_EVENTS,
  tryJoin,
  type MatchCandidate,
  type MatchParams,
} from '@arriveshare/shared';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { detourLimits, env, fareParams } from '../config/env';
import { db } from '../db/client';
import { rideGroups, rideRequests, stations, users, type RideRequest, type Station, type User } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addMs, MINUTE, SECOND } from '../lib/time';
import { realtime } from '../realtime/hub';
import { notify } from './notifications';
import { routeThrough } from './routing';
import { groupRiderUserIds } from './views';

/**
 * Matching service — owns ride/group membership.
 *
 * Every state change happens inside a transaction with a status guard in the WHERE
 * clause (`… AND status = 'pending'`), so two concurrent workers can never place the
 * same rider in two cabs. Network calls (OSRM) happen before the transaction opens.
 */

export const matchParams: MatchParams = {
  ...DEFAULT_MATCH_PARAMS,
  seatCapacity: env.CAB_CAPACITY,
  luggageCapacity: env.LUGGAGE_CAPACITY,
  limits: detourLimits,
};

const ACTIVE_MEMBER: RideRequest['status'][] = ['matched', 'confirmed', 'picked_up'];
const PRE_ASSIGNMENT = ['accepting', 'dispatching'] as const;

/** Hook used by the demo simulator to auto-accept for bot riders. */
let onMatched: ((rideId: string, user: User) => void) | null = null;
export function setOnMatched(fn: typeof onMatched) {
  onMatched = fn;
}

type Row = { ride: RideRequest; station: Station; user: User };

export function toCandidate({ ride, station, user }: Row): MatchCandidate {
  return {
    id: ride.id,
    hub: { lat: station.lat, lng: station.lng },
    hubId: station.id,
    dest: { lat: ride.destLat, lng: ride.destLng },
    arrivalAt: ride.arrivalAt.getTime(),
    toleranceMin: ride.toleranceMin,
    seats: ride.seats,
    luggage: ride.luggage,
    gender: user.gender,
    womenOnly: ride.womenOnly,
  };
}

async function loadRows(where: ReturnType<typeof and>): Promise<Row[]> {
  return db
    .select({ ride: rideRequests, station: stations, user: users })
    .from(rideRequests)
    .innerJoin(stations, eq(stations.id, rideRequests.stationId))
    .innerJoin(users, eq(users.id, rideRequests.userId))
    .where(where);
}

const activeMembersOf = (groupId: string) =>
  loadRows(and(eq(rideRequests.groupId, groupId), inArray(rideRequests.status, ACTIVE_MEMBER)));

/** Computes route geometry + fares for an ordered set of members (outside any tx). */
async function price(rows: Row[], dropOrder: string[]) {
  const byId = new Map(rows.map((r) => [r.ride.id, r]));
  const ordered = dropOrder.map((id) => byId.get(id)!);
  const hub = { lat: rows[0]!.station.lat, lng: rows[0]!.station.lng };
  const route = await routeThrough([hub, ...ordered.map((r) => ({ lat: r.ride.destLat, lng: r.ride.destLng }))]);
  const split = splitFare(
    ordered.map((r) => ({ id: r.ride.id, soloKm: r.ride.soloKm, acceptedFare: r.ride.acceptedFare })),
    route.km,
    fareParams,
  );
  return { route, split, ordered };
}

async function announce(groupId: string, rideIds: string[], userIds: string[]) {
  realtime.toGroup(groupId, SOCKET_EVENTS.groupUpdated, { groupId });
  rideIds.forEach((id, i) =>
    realtime.toUser(userIds[i]!, SOCKET_EVENTS.rideUpdated, { rideId: id, groupId }),
  );
}

// ── Group formation ──────────────────────────────────────

async function createGroup(rows: Row[], dropOrder: string[], pickupAt: number) {
  const { route, split } = await price(rows, dropOrder);
  const now = new Date();
  const ids = rows.map((r) => r.ride.id);

  const groupId = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(rideGroups)
      .values({
        stationId: rows[0]!.station.id,
        status: 'accepting',
        pickupAt: new Date(pickupAt),
        routeKm: split.routeKm,
        groupFare: split.groupFare,
        platformSubsidy: split.platformSubsidy,
        womenOnly: rows.some((r) => r.ride.womenOnly),
        preferFemaleDriver: rows.some((r) => r.ride.preferFemaleDriver || r.ride.womenOnly),
        route: route.geometry,
        acceptExpiresAt: addMs(now, env.ACCEPT_WINDOW_SEC * SECOND),
      })
      .returning({ id: rideGroups.id });

    for (const f of split.riders) {
      const updated = await tx
        .update(rideRequests)
        .set({
          status: 'matched',
          groupId: group!.id,
          quotedFare: f.finalFare,
          platformSubsidy: f.subsidy,
          dropIndex: dropOrder.indexOf(f.id),
          version: sql`${rideRequests.version} + 1`,
        })
        .where(and(eq(rideRequests.id, f.id), eq(rideRequests.status, 'pending')))
        .returning({ id: rideRequests.id });
      // Someone cancelled while we were routing — abort the whole group.
      if (updated.length === 0) tx.rollback();
    }
    return group!.id;
  }).catch((err) => {
    if (String(err?.message ?? err).includes('Rollback')) return null;
    throw err;
  });

  if (!groupId) return null;
  await Promise.all(
    rows.map((r) =>
      notify(r.user.id, {
        kind: 'match_found',
        title: 'Co-riders found! 🎉',
        body: `You're pooled with ${rows.length - 1} other${rows.length > 2 ? 's' : ''}. Accept within ${Math.round(env.ACCEPT_WINDOW_SEC / 60)} min to lock your fare.`,
        link: `/rides/${r.ride.id}`,
      }),
    ),
  );
  await announce(groupId, ids, rows.map((r) => r.user.id));
  rows.forEach((r) => onMatched?.(r.ride.id, r.user));
  return groupId;
}

/** Adds a late joiner into a group that is still collecting acceptances. */
async function joinGroup(groupId: string, joiner: Row, members: Row[], dropOrder: string[]) {
  const all = [...members, joiner];
  const { route, split } = await price(all, dropOrder);

  const ok = await db.transaction(async (tx) => {
    const [g] = await tx
      .update(rideGroups)
      .set({
        routeKm: split.routeKm,
        groupFare: split.groupFare,
        platformSubsidy: split.platformSubsidy,
        route: route.geometry,
        womenOnly: all.some((r) => r.ride.womenOnly),
        preferFemaleDriver: all.some((r) => r.ride.preferFemaleDriver || r.ride.womenOnly),
        pickupAt: new Date(Math.max(...all.map((r) => r.ride.arrivalAt.getTime()))),
        version: sql`${rideGroups.version} + 1`,
      })
      .where(and(eq(rideGroups.id, groupId), eq(rideGroups.status, 'accepting')))
      .returning({ id: rideGroups.id });
    if (!g) return false;

    for (const f of split.riders) {
      const isJoiner = f.id === joiner.ride.id;
      const res = await tx
        .update(rideRequests)
        .set({
          ...(isJoiner ? { status: 'matched' as const, groupId } : {}),
          quotedFare: f.finalFare,
          platformSubsidy: f.subsidy,
          dropIndex: dropOrder.indexOf(f.id),
          version: sql`${rideRequests.version} + 1`,
        })
        .where(
          and(
            eq(rideRequests.id, f.id),
            isJoiner ? eq(rideRequests.status, 'pending') : inArray(rideRequests.status, ACTIVE_MEMBER),
          ),
        )
        .returning({ id: rideRequests.id });
      if (res.length === 0) tx.rollback();
    }
    return true;
  }).catch((err) => {
    if (String(err?.message ?? err).includes('Rollback')) return false;
    throw err;
  });

  if (!ok) return false;
  await notify(joiner.user.id, {
    kind: 'match_found',
    title: 'You joined a shared cab 🎉',
    body: `${members.length} co-rider${members.length > 1 ? 's are' : ' is'} heading your way. Accept to lock your fare.`,
    link: `/rides/${joiner.ride.id}`,
  });
  await announce(groupId, all.map((r) => r.ride.id), all.map((r) => r.user.id));
  onMatched?.(joiner.ride.id, joiner.user);
  return true;
}

/** One matching pass over the pending pool. Safe to run concurrently. */
export async function runMatching(now = new Date()) {
  const pool = await loadRows(
    and(
      eq(rideRequests.status, 'pending'),
      gte(rideRequests.arrivalAt, addMs(now, -60 * MINUTE)),
      lte(rideRequests.arrivalAt, addMs(now, env.MATCH_HORIZON_MIN * MINUTE)),
      eq(users.suspended, false),
    ),
  );
  if (pool.length === 0) return { joined: 0, formed: 0 };

  // 1) Late joiners fill seats in groups still collecting acceptances.
  const stationIds = [...new Set(pool.map((p) => p.station.id))];
  const open = await db
    .select({ id: rideGroups.id, stationId: rideGroups.stationId })
    .from(rideGroups)
    .where(and(eq(rideGroups.status, 'accepting'), inArray(rideGroups.stationId, stationIds)));

  let joined = 0;
  const placed = new Set<string>();
  for (const g of open) {
    let members = await activeMembersOf(g.id);
    if (members.length === 0) continue;
    for (const cand of pool) {
      if (placed.has(cand.ride.id) || cand.station.id !== g.stationId) continue;
      if (cand.ride.declinedGroupIds.includes(g.id)) continue;
      const plan = tryJoin(members.map(toCandidate), toCandidate(cand), matchParams);
      if (!plan) continue;
      if (await joinGroup(g.id, cand, members, plan.dropOrder)) {
        placed.add(cand.ride.id);
        joined++;
        members = await activeMembersOf(g.id);
      }
    }
  }

  // 2) Cluster everyone else into new groups.
  const rest = pool.filter((p) => !placed.has(p.ride.id));
  const formed = formGroups(rest.map(toCandidate), matchParams);
  const byId = new Map(rest.map((r) => [r.ride.id, r]));
  let created = 0;
  for (const f of formed) {
    const rows = f.memberIds.map((id) => byId.get(id)!);
    if (await createGroup(rows, f.dropOrder, f.pickupAt)) created++;
  }
  return { joined, formed: created };
}

// ── Membership changes ───────────────────────────────────

/**
 * Re-plans a group after someone leaves. Fares are re-split under the price
 * guarantee: anyone who already accepted never pays more than they accepted.
 */
export async function replanGroup(groupId: string) {
  const [group] = await db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
  if (!group || group.status === 'completed' || group.status === 'cancelled') return;
  const members = await activeMembersOf(groupId);
  const preAssignment = (PRE_ASSIGNMENT as readonly string[]).includes(group.status);

  // Nobody left → cancel the cab (and free the driver if one was assigned).
  if (members.length === 0) {
    await cancelGroup(groupId, 'All riders left the group');
    return;
  }

  // Too small to pool and no driver yet → return the remaining rider(s) to the pool.
  if (members.length < matchParams.minGroupSize && preAssignment) {
    await db.transaction(async (tx) => {
      await tx
        .update(rideRequests)
        .set({
          status: 'pending',
          groupId: null,
          quotedFare: null,
          acceptedFare: null,
          acceptedAt: null,
          dropIndex: null,
          platformSubsidy: 0,
          declinedGroupIds: sql`${rideRequests.declinedGroupIds} || ${JSON.stringify([groupId])}::jsonb`,
        })
        .where(and(eq(rideRequests.groupId, groupId), inArray(rideRequests.status, ACTIVE_MEMBER)));
      await tx
        .update(rideGroups)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(rideGroups.id, groupId));
    });
    for (const m of members) {
      await notify(m.user.id, {
        kind: 'match_dissolved',
        title: 'Your co-rider dropped out',
        body: "No worries — we've put you back in the pool and are finding new co-riders.",
        link: `/rides/${m.ride.id}`,
      });
      realtime.toUser(m.user.id, SOCKET_EVENTS.rideUpdated, { rideId: m.ride.id, groupId: null });
    }
    realtime.toGroup(groupId, SOCKET_EVENTS.groupUpdated, { groupId });
    return;
  }

  const planned = planGroup(members.map(toCandidate), matchParams);
  const order =
    planned?.dropOrder ??
    [...members].sort((a, b) => (a.ride.dropIndex ?? 0) - (b.ride.dropIndex ?? 0)).map((m) => m.ride.id);
  const { route, split } = await price(members, order);
  const allAccepted = members.every((m) => m.ride.status !== 'matched');

  await db.transaction(async (tx) => {
    for (const f of split.riders) {
      await tx
        .update(rideRequests)
        .set({
          quotedFare: f.finalFare,
          ...(members.find((m) => m.ride.id === f.id)!.ride.acceptedFare != null
            ? { acceptedFare: f.finalFare }
            : {}),
          platformSubsidy: f.subsidy,
          dropIndex: order.indexOf(f.id),
        })
        .where(eq(rideRequests.id, f.id));
    }
    await tx
      .update(rideGroups)
      .set({
        routeKm: split.routeKm,
        groupFare: split.groupFare,
        platformSubsidy: split.platformSubsidy,
        route: route.geometry,
        womenOnly: members.some((m) => m.ride.womenOnly),
        version: sql`${rideGroups.version} + 1`,
        ...(group.status === 'accepting' && allAccepted
          ? { status: 'dispatching' as const, dispatchStartedAt: new Date() }
          : {}),
      })
      .where(eq(rideGroups.id, groupId));
  });
  await announce(groupId, members.map((m) => m.ride.id), members.map((m) => m.user.id));
  return { becameDispatching: group.status === 'accepting' && allAccepted };
}

/** Cancels a group entirely; riders still in it go back to the pool. */
export async function cancelGroup(groupId: string, reason: string) {
  const [group] = await db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
  if (!group) return;
  const userIds = await groupRiderUserIds(groupId);
  await db.transaction(async (tx) => {
    await tx
      .update(rideGroups)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(rideGroups.id, groupId));
    await tx
      .update(rideRequests)
      .set({ status: 'pending', groupId: null, quotedFare: null, acceptedFare: null, acceptedAt: null, dropIndex: null })
      .where(and(eq(rideRequests.groupId, groupId), inArray(rideRequests.status, ['matched', 'confirmed'])));
  });
  if (group.driverId) {
    const { releaseDriver } = await import('./dispatch');
    await releaseDriver(group.driverId, groupId, reason);
  }
  realtime.toGroup(groupId, SOCKET_EVENTS.groupUpdated, { groupId });
  realtime.toUsers(userIds, SOCKET_EVENTS.rideUpdated, { groupId });
}

async function ownRide(rideId: string, userId: string) {
  const [ride] = await db.select().from(rideRequests).where(eq(rideRequests.id, rideId));
  if (!ride) throw notFound('Ride');
  if (ride.userId !== userId) throw forbidden();
  return ride;
}

export async function acceptRide(rideId: string, userId: string) {
  const ride = await ownRide(rideId, userId);
  if (ride.status === 'confirmed') return ride;
  if (ride.status !== 'matched' || !ride.groupId) throw conflict('NOT_MATCHED', 'This ride is not waiting for acceptance');
  const groupId = ride.groupId;

  const result = await db.transaction(async (tx) => {
    const [group] = await tx.select().from(rideGroups).where(eq(rideGroups.id, groupId));
    if (!group || group.status !== 'accepting') throw conflict('GROUP_CLOSED', 'This group is no longer accepting');
    if (group.acceptExpiresAt && group.acceptExpiresAt < new Date()) {
      throw conflict('ACCEPT_EXPIRED', 'The acceptance window has closed');
    }
    const [updated] = await tx
      .update(rideRequests)
      .set({
        status: 'confirmed',
        acceptedFare: ride.quotedFare,
        acceptedAt: new Date(),
        version: sql`${rideRequests.version} + 1`,
      })
      .where(and(eq(rideRequests.id, rideId), eq(rideRequests.status, 'matched')))
      .returning();
    if (!updated) throw conflict('STALE', 'Ride changed — please refresh');

    const [{ waiting } = { waiting: 0 }] = await tx
      .select({ waiting: sql<number>`count(*)::int` })
      .from(rideRequests)
      .where(and(eq(rideRequests.groupId, groupId), eq(rideRequests.status, 'matched')));

    let dispatching = false;
    if (waiting === 0) {
      const moved = await tx
        .update(rideGroups)
        .set({ status: 'dispatching', dispatchStartedAt: new Date(), version: sql`${rideGroups.version} + 1` })
        .where(and(eq(rideGroups.id, groupId), eq(rideGroups.status, 'accepting')))
        .returning({ id: rideGroups.id });
      dispatching = moved.length > 0;
    }
    return { updated, dispatching };
  });

  realtime.toGroup(groupId, SOCKET_EVENTS.groupUpdated, { groupId });
  realtime.toUser(userId, SOCKET_EVENTS.rideUpdated, { rideId, groupId });
  if (result.dispatching) {
    const userIds = await groupRiderUserIds(groupId);
    for (const uid of userIds) {
      await notify(uid, {
        kind: 'group_confirmed',
        title: 'Everyone accepted ✅',
        body: 'Your fare is locked. We are assigning the nearest verified driver now.',
        link: '/rides',
      });
    }
    const { dispatchGroup } = await import('./dispatch');
    await dispatchGroup(groupId);
  }
  return result.updated;
}

export async function leaveGroup(rideId: string, userId: string | null, reason: 'declined' | 'expired') {
  const ride = userId ? await ownRide(rideId, userId) : (await db.select().from(rideRequests).where(eq(rideRequests.id, rideId)))[0];
  if (!ride) throw notFound('Ride');
  if (!ride.groupId || !['matched', 'confirmed'].includes(ride.status)) {
    throw conflict('NOT_IN_GROUP', 'This ride is not part of a forming group');
  }
  const groupId = ride.groupId;
  const [group] = await db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
  if (!group || !(PRE_ASSIGNMENT as readonly string[]).includes(group.status)) {
    throw conflict('DRIVER_ASSIGNED', 'A driver is already assigned — cancel the ride instead');
  }
  await db
    .update(rideRequests)
    .set({
      status: 'pending',
      groupId: null,
      quotedFare: null,
      acceptedFare: null,
      acceptedAt: null,
      dropIndex: null,
      platformSubsidy: 0,
      declineCount: sql`${rideRequests.declineCount} + 1`,
      declinedGroupIds: sql`${rideRequests.declinedGroupIds} || ${JSON.stringify([groupId])}::jsonb`,
    })
    .where(eq(rideRequests.id, rideId));
  realtime.toUser(ride.userId, SOCKET_EVENTS.rideUpdated, { rideId, groupId: null });
  if (reason === 'expired') {
    await notify(ride.userId, {
      kind: 'accept_expired',
      title: 'Acceptance window closed',
      body: "You didn't accept in time, so we've returned you to the pool to find another cab.",
      link: `/rides/${rideId}`,
    });
  }
  const res = await replanGroup(groupId);
  if (res?.becameDispatching) {
    const { dispatchGroup } = await import('./dispatch');
    await dispatchGroup(groupId);
  }
}

export async function cancelRide(rideId: string, userId: string, reason = 'Cancelled by rider') {
  const ride = await ownRide(rideId, userId);
  if (['cancelled', 'completed', 'no_show', 'expired'].includes(ride.status)) return ride;
  if (ride.status === 'picked_up') throw badRequest('ON_TRIP', 'You are already on the trip — use SOS if you need help');
  const [updated] = await db
    .update(rideRequests)
    .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, version: sql`${rideRequests.version} + 1` })
    .where(and(eq(rideRequests.id, rideId), eq(rideRequests.version, ride.version)))
    .returning();
  if (!updated) throw conflict('STALE', 'Ride changed while cancelling — please retry');
  realtime.toUser(userId, SOCKET_EVENTS.rideUpdated, { rideId });
  if (ride.groupId) {
    const res = await replanGroup(ride.groupId);
    if (res?.becameDispatching) {
      const { dispatchGroup } = await import('./dispatch');
      await dispatchGroup(ride.groupId);
    }
  }
  return updated;
}

/** Riders who didn't accept within the window are returned to the pool. */
export async function expireAcceptWindows(now = new Date()) {
  const stale = await db
    .select({ rideId: rideRequests.id })
    .from(rideRequests)
    .innerJoin(rideGroups, eq(rideGroups.id, rideRequests.groupId))
    .where(
      and(
        eq(rideGroups.status, 'accepting'),
        lte(rideGroups.acceptExpiresAt, now),
        eq(rideRequests.status, 'matched'),
      ),
    );
  for (const s of stale) {
    await leaveGroup(s.rideId, null, 'expired').catch(() => undefined);
  }
  return stale.length;
}

/** Pending rides whose arrival window passed long ago are closed out. */
export async function expireStaleRequests(now = new Date()) {
  const rows = await db
    .update(rideRequests)
    .set({ status: 'expired' })
    .where(and(eq(rideRequests.status, 'pending'), lte(rideRequests.arrivalAt, addMs(now, -90 * MINUTE))))
    .returning({ id: rideRequests.id, userId: rideRequests.userId });
  for (const r of rows) {
    await notify(r.userId, {
      kind: 'ride_expired',
      title: 'Ride request expired',
      body: 'We could not find co-riders in time. Book a solo cab or try again with a wider wait window.',
      link: `/rides/${r.id}`,
    });
  }
  return rows.length;
}

/** Skip pooling: book the ride as a private cab at the solo fare. */
export async function goSolo(rideId: string, userId: string) {
  const ride = await ownRide(rideId, userId);
  if (ride.status !== 'pending') throw conflict('NOT_PENDING', 'Only rides still searching can switch to solo');
  const [row] = await loadRows(eq(rideRequests.id, rideId));
  const { route, split } = await price([row!], [rideId]);
  const fare = split.riders[0]!;

  const groupId = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(rideGroups)
      .values({
        stationId: ride.stationId,
        status: 'dispatching',
        pickupAt: ride.arrivalAt,
        routeKm: split.routeKm,
        groupFare: split.groupFare,
        womenOnly: ride.womenOnly,
        preferFemaleDriver: ride.preferFemaleDriver || ride.womenOnly,
        route: route.geometry,
        dispatchStartedAt: new Date(),
      })
      .returning({ id: rideGroups.id });
    const [updated] = await tx
      .update(rideRequests)
      .set({
        status: 'confirmed',
        groupId: group!.id,
        quotedFare: fare.finalFare,
        acceptedFare: fare.finalFare,
        acceptedAt: new Date(),
        dropIndex: 0,
        version: sql`${rideRequests.version} + 1`,
      })
      .where(and(eq(rideRequests.id, rideId), eq(rideRequests.status, 'pending')))
      .returning({ id: rideRequests.id });
    if (!updated) throw conflict('STALE', 'Ride changed — please refresh');
    return group!.id;
  });

  realtime.toUser(userId, SOCKET_EVENTS.rideUpdated, { rideId, groupId });
  const { dispatchGroup } = await import('./dispatch');
  await dispatchGroup(groupId);
  return groupId;
}
