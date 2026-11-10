import { bearingDeg, haversineKm, interpolatePolyline, roadEstimateKm, soloFare, type LatLng } from '@arriveshare/shared';
import type { FastifyBaseLogger } from 'fastify';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { env, fareParams } from '../config/env';
import { db } from '../db/client';
import { drivers, rideGroups, rideRequests, stations, users, type RideRequest } from '../db/schema';
import { numericCode } from '../lib/crypto';
import { MINUTE } from '../lib/time';
import { respondToOffer, setOnOffer } from './dispatch';
import { acceptRide, setOnMatched } from './matching';
import { notify } from './notifications';
import { dropRider, ingestLocation, markArrived, startTrip, verifyPin } from './trips';

/**
 * Demo simulator (DEMO_MODE + SIMULATOR_ENABLED only).
 *
 * Makes a single person able to experience the whole product:
 *  • spawns bot co-riders heading the same way when you book
 *  • bot riders auto-accept their match
 *  • bot drivers accept offers, drive to the hub, verify PINs, follow the
 *    route and drop everyone — through the SAME service calls a real driver app
 *    uses, so live tracking and safety checks run for real.
 */

const STEP_MS = 2000;
const DRIVE_TO_HUB_MS = 20_000;
const TRIP_MS = 100_000;
const drives = new Map<string, NodeJS.Timeout>();
let log: FastifyBaseLogger | null = null;

const enabled = () => env.DEMO_MODE && env.SIMULATOR_ENABLED;
const later = (ms: number, fn: () => Promise<unknown>) =>
  setTimeout(() => fn().catch((err) => log?.warn({ err }, 'simulator step failed')), ms).unref();

export function initSimulator(logger: FastifyBaseLogger) {
  if (!enabled()) return;
  log = logger;
  setOnMatched((rideId, user) => {
    if (user.simulated) later(1500 + Math.random() * 2500, () => acceptRide(rideId, user.id));
  });
  setOnOffer((offerId, driverId) => {
    later(2500, async () => {
      const [row] = await db
        .select({ user: users })
        .from(drivers)
        .innerJoin(users, eq(users.id, drivers.userId))
        .where(eq(drivers.id, driverId));
      if (!row?.user.simulated) return;
      const res = await respondToOffer(offerId, row.user.id, true);
      if (res.accepted) startDrive(res.groupId);
    });
  });
  // Resume drives interrupted by a restart.
  later(3000, async () => {
    const active = await db
      .select({ id: rideGroups.id, simulated: users.simulated })
      .from(rideGroups)
      .innerJoin(drivers, eq(drivers.id, rideGroups.driverId))
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(inArray(rideGroups.status, ['assigned', 'arrived', 'on_trip']));
    active.filter((a) => a.simulated).forEach((a) => startDrive(a.id));
  });
  log.info('🤖 demo simulator enabled');
}

/** Offset a point by (km north, km east). */
function offset(p: LatLng, northKm: number, eastKm: number): LatLng {
  return {
    lat: p.lat + northKm / 110.574,
    lng: p.lng + eastKm / (111.32 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

/** When a real user books, make sure there are 1–2 compatible bot co-riders. */
export async function spawnCoRiders(ride: RideRequest) {
  if (!enabled()) return 0;
  const [station] = await db.select().from(stations).where(eq(stations.id, ride.stationId));
  const [owner] = await db.select().from(users).where(eq(users.id, ride.userId));
  if (!station || !owner || owner.simulated) return 0;

  const busy = db
    .select({ id: rideRequests.userId })
    .from(rideRequests)
    .where(inArray(rideRequests.status, ['pending', 'matched', 'confirmed', 'picked_up']));
  const wantFemale = ride.womenOnly || owner.gender === 'female';
  const bots = await db
    .select()
    .from(users)
    .where(and(eq(users.simulated, true), eq(users.role, 'rider'), notInArray(users.id, busy)))
    .orderBy(asc(users.createdAt));
  const pick = bots.filter((b) => !ride.womenOnly || b.gender === 'female');
  const chosen = (wantFemale ? [...pick].sort((a, b) => Number(a.gender !== 'female') - Number(b.gender !== 'female')) : pick).slice(
    0,
    1 + Math.round(Math.random()),
  );

  const dest = { lat: ride.destLat, lng: ride.destLng };
  const hub = { lat: station.lat, lng: station.lng };
  const dir = bearingDeg(hub, dest);
  let n = 0;
  for (const bot of chosen) {
    // Place bot destinations 0.4–2 km from yours, slightly closer to the hub (on corridor).
    const back = 0.4 + Math.random() * 1.6;
    const rad = (dir * Math.PI) / 180;
    const side = (Math.random() - 0.5) * 1.2;
    const p = offset(dest, -Math.cos(rad) * back + side * Math.sin(rad), -Math.sin(rad) * back - side * Math.cos(rad));
    const km = roadEstimateKm(hub, p);
    await db.insert(rideRequests).values({
      userId: bot.id,
      stationId: station.id,
      destLat: p.lat,
      destLng: p.lng,
      destinationLabel: `Near ${ride.destinationLabel.split(',')[0]}`,
      arrivalAt: new Date(ride.arrivalAt.getTime() + (Math.random() - 0.5) * 8 * MINUTE),
      toleranceMin: 20,
      luggage: 1,
      womenOnly: ride.womenOnly,
      soloKm: Math.round(km * 100) / 100,
      soloFare: soloFare(km, fareParams),
      pickupPin: numericCode(4),
    });
    n++;
  }
  return n;
}

function stopDrive(groupId: string) {
  const t = drives.get(groupId);
  if (t) clearInterval(t);
  drives.delete(groupId);
}

/** Moves a bot driver: to the hub → pickups → along the route, dropping riders. */
export function startDrive(groupId: string) {
  if (!enabled() || drives.has(groupId)) return;
  let phase: 'to_hub' | 'boarding' | 'trip' = 'to_hub';
  let started = Date.now();
  let from: LatLng | null = null;
  let busyStep = false;

  const timer = setInterval(async () => {
    if (busyStep) return;
    busyStep = true;
    try {
      const [row] = await db
        .select({ group: rideGroups, station: stations, driver: drivers })
        .from(rideGroups)
        .innerJoin(stations, eq(stations.id, rideGroups.stationId))
        .innerJoin(drivers, eq(drivers.id, rideGroups.driverId))
        .where(eq(rideGroups.id, groupId));
      if (!row || !['assigned', 'arrived', 'on_trip'].includes(row.group.status)) return stopDrive(groupId);
      const { group, station, driver } = row;
      const hub = { lat: station.lat, lng: station.lng };
      const driverUserId = driver.userId;

      if (group.status === 'on_trip') phase = 'trip';
      else if (group.status === 'arrived') phase = 'boarding';

      if (phase === 'to_hub') {
        from ??= driver.lat != null ? { lat: driver.lat, lng: driver.lng! } : offset(hub, 1.5, 1.5);
        const t = Math.min(1, (Date.now() - started) / DRIVE_TO_HUB_MS);
        const p = interpolatePolyline([from, hub], t);
        await ingestLocation(driverUserId, { lat: p.lat, lng: p.lng, heading: bearingDeg(p, hub), speedKmh: 30 });
        if (t >= 1) {
          await markArrived(driverUserId);
          phase = 'boarding';
          started = Date.now();
        }
        return;
      }

      if (phase === 'boarding') {
        await ingestLocation(driverUserId, { ...hub, heading: 0, speedKmh: 0 });
        if (Date.now() - started < 6000) return;
        const riders = await db
          .select({ ride: rideRequests, user: users })
          .from(rideRequests)
          .innerJoin(users, eq(users.id, rideRequests.userId))
          .where(and(eq(rideRequests.groupId, groupId), eq(rideRequests.status, 'confirmed')));
        for (const r of riders) {
          await verifyPin(driverUserId, r.ride.id, r.ride.pickupPin);
          if (!r.user.simulated) {
            await notify(r.user.id, {
              kind: 'demo',
              title: 'Demo: PIN verified',
              body: 'In a real trip you would read your 4-digit PIN to the driver after checking the number plate.',
            });
          }
        }
        await startTrip(driverUserId);
        phase = 'trip';
        started = Date.now();
        return;
      }

      // Trip: follow the planned route polyline.
      const route = group.route.length >= 2 ? group.route : [hub, hub];
      // Longer (intercity) trips take proportionally longer to drive in the demo.
      const tripMs = Math.min(240_000, Math.max(TRIP_MS, group.routeKm * 600));
      const t = Math.min(1, (Date.now() - started) / tripMs);
      const p = interpolatePolyline(route, t);
      const ahead = interpolatePolyline(route, Math.min(1, t + 0.01));
      await ingestLocation(driverUserId, { lat: p.lat, lng: p.lng, heading: bearingDeg(p, ahead), speedKmh: 38 + Math.random() * 12 });

      const onboard = await db
        .select()
        .from(rideRequests)
        .where(and(eq(rideRequests.groupId, groupId), eq(rideRequests.status, 'picked_up')))
        .orderBy(asc(rideRequests.dropIndex));
      for (const r of onboard) {
        if (haversineKm(p, { lat: r.destLat, lng: r.destLng }) < 0.35 || t >= 1) {
          await dropRider(driverUserId, r.id);
        }
      }
      if (t >= 1 && onboard.length === 0) stopDrive(groupId);
    } catch (err) {
      log?.warn({ err, groupId }, 'simulated drive step failed');
    } finally {
      busyStep = false;
    }
  }, STEP_MS);
  timer.unref();
  drives.set(groupId, timer);
}

export function stopAllDrives() {
  for (const id of [...drives.keys()]) stopDrive(id);
}
