import {
  firstName,
  maskPhone,
  type DriverPublicDto,
  type GroupDto,
  type RideDto,
  type StationDto,
  type UserDto,
} from '@arriveshare/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { env } from '../config/env';
import { db, type DbOrTx } from '../db/client';
import {
  drivers,
  ratings,
  rideGroups,
  rideRequests,
  stations,
  tripShares,
  users,
  type Driver,
  type RideRequest,
  type Station,
  type User,
} from '../db/schema';
import { notFound } from '../lib/errors';

/** DTO mappers. Privacy rules for co-riders live here — and only here. */

const avg = (sum: number, count: number) => (count ? Math.round((sum / count) * 10) / 10 : null);

export function userDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    gender: u.gender,
    role: u.role,
    avatarUrl: u.avatarUrl,
    ratingAvg: avg(u.ratingSum, u.ratingCount),
    ratingCount: u.ratingCount,
    safety: u.safety,
    onboarded: u.onboarded,
    createdAt: u.createdAt.toISOString(),
  };
}

export function stationDto(s: Station): StationDto {
  return { id: s.id, code: s.code, name: s.name, type: s.type, city: s.city, lat: s.lat, lng: s.lng };
}

export function rideDto(r: RideRequest, s: Station, rated = false): RideDto {
  return {
    id: r.id,
    status: r.status,
    station: stationDto(s),
    destination: { lat: r.destLat, lng: r.destLng },
    destinationLabel: r.destinationLabel,
    arrivalAt: r.arrivalAt.toISOString(),
    toleranceMin: r.toleranceMin,
    seats: r.seats,
    luggage: r.luggage,
    flightOrTrain: r.flightOrTrain,
    womenOnly: r.womenOnly,
    preferFemaleDriver: r.preferFemaleDriver,
    soloKm: r.soloKm,
    soloFare: r.soloFare,
    quotedFare: r.quotedFare,
    acceptedFare: r.acceptedFare,
    finalFare: r.finalFare,
    savings:
      r.finalFare != null
        ? Math.round((r.soloFare - r.finalFare) * 100) / 100
        : r.quotedFare != null
          ? Math.round((r.soloFare - (r.acceptedFare ?? r.quotedFare)) * 100) / 100
          : null,
    pickupPin: ['matched', 'confirmed'].includes(r.status) ? r.pickupPin : null,
    dropIndex: r.dropIndex,
    groupId: r.groupId,
    rated,
    createdAt: r.createdAt.toISOString(),
  };
}

export function driverPublicDto(d: Driver, u: User): DriverPublicDto {
  return {
    id: d.id,
    name: u.name,
    gender: u.gender,
    phoneMasked: maskPhone(u.phone),
    ratingAvg: avg(u.ratingSum, u.ratingCount),
    ratingCount: u.ratingCount,
    verified: d.verified,
    vehicle: {
      number: d.vehicleNumber,
      model: d.vehicleModel,
      color: d.vehicleColor,
      type: d.vehicleType,
      seats: d.seats,
    },
    location:
      d.lat != null && d.lng != null
        ? {
            lat: d.lat,
            lng: d.lng,
            heading: d.heading,
            updatedAt: (d.locationUpdatedAt ?? d.updatedAt).toISOString(),
          }
        : null,
  };
}

export async function loadRide(rideId: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select({ ride: rideRequests, station: stations })
    .from(rideRequests)
    .innerJoin(stations, eq(stations.id, rideRequests.stationId))
    .where(eq(rideRequests.id, rideId));
  return row ?? null;
}

export async function rideView(rideId: string, raterId?: string) {
  const row = await loadRide(rideId);
  if (!row) throw notFound('Ride');
  let rated = false;
  if (raterId) {
    const [r] = await db
      .select({ id: ratings.id })
      .from(ratings)
      .where(and(eq(ratings.rideId, rideId), eq(ratings.raterId, raterId)));
    rated = !!r;
  }
  return rideDto(row.ride, row.station, rated);
}

export async function loadDriverWithUser(driverId: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select({ driver: drivers, user: users })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(eq(drivers.id, driverId));
  return row ?? null;
}

export interface Viewer {
  userId: string;
  role: 'rider' | 'driver' | 'admin';
}

/** Group as seen by a specific viewer — riders get first names only, drivers get stops. */
export async function groupView(groupId: string, viewer: Viewer): Promise<GroupDto> {
  const [g] = await db
    .select({ group: rideGroups, station: stations })
    .from(rideGroups)
    .innerJoin(stations, eq(stations.id, rideGroups.stationId))
    .where(eq(rideGroups.id, groupId));
  if (!g) throw notFound('Group');

  const members = await db
    .select({ ride: rideRequests, user: users })
    .from(rideRequests)
    .innerJoin(users, eq(users.id, rideRequests.userId))
    .where(eq(rideRequests.groupId, groupId))
    .orderBy(asc(rideRequests.dropIndex));

  const driverRow = g.group.driverId ? await loadDriverWithUser(g.group.driverId) : null;
  const isDriver = !!driverRow && driverRow.user.id === viewer.userId;
  const isAdmin = viewer.role === 'admin';

  let shareToken: string | null = null;
  const mine = members.find((m) => m.user.id === viewer.userId);
  if (mine) {
    const [share] = await db
      .select({ token: tripShares.token })
      .from(tripShares)
      .where(eq(tripShares.rideId, mine.ride.id))
      .limit(1);
    shareToken = share?.token ?? null;
  }

  return {
    id: g.group.id,
    status: g.group.status,
    station: stationDto(g.station),
    pickupAt: g.group.pickupAt.toISOString(),
    routeKm: g.group.routeKm,
    groupFare: g.group.groupFare,
    acceptExpiresAt: g.group.acceptExpiresAt?.toISOString() ?? null,
    womenOnly: g.group.womenOnly,
    route: g.group.route,
    shareToken,
    members: members
      .filter((m) => !['cancelled', 'expired'].includes(m.ride.status))
      .map(({ ride, user }) => {
        const isMe = user.id === viewer.userId;
        const seeDetails = isMe || isDriver || isAdmin;
        const demoPin = isDriver && env.DEMO_MODE && user.simulated;
        return {
          rideId: ride.id,
          firstName: isMe ? 'You' : firstName(user.name),
          verified: user.emailVerified,
          ratingAvg: avg(user.ratingSum, user.ratingCount),
          dropIndex: ride.dropIndex,
          status: ride.status,
          accepted: ride.acceptedAt != null,
          isMe,
          ...(seeDetails
            ? {
                destinationLabel: ride.destinationLabel,
                destination: { lat: ride.destLat, lng: ride.destLng },
              }
            : {}),
          ...(isMe || demoPin ? { pickupPin: ride.pickupPin } : {}),
        };
      }),
    driver: driverRow ? driverPublicDto(driverRow.driver, driverRow.user) : null,
  };
}

/** User ids of every active rider in a group. */
export async function groupRiderUserIds(groupId: string, tx: DbOrTx = db): Promise<string[]> {
  const rows = await tx
    .select({ userId: rideRequests.userId })
    .from(rideRequests)
    .where(
      and(
        eq(rideRequests.groupId, groupId),
        inArray(rideRequests.status, ['matched', 'confirmed', 'picked_up', 'completed']),
      ),
    );
  return rows.map((r) => r.userId);
}
