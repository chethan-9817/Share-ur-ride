import {
  DEFAULT_SAFETY_THRESHOLDS,
  evaluatePings,
  firstName,
  isNightTime,
  SOCKET_EVENTS,
  type LatLng,
  type RaiseSosInput,
  type SafetyEventDto,
  type ShareViewDto,
  type SosDto,
} from '@arriveshare/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { env } from '../config/env';
import { db } from '../db/client';
import {
  drivers,
  locationPings,
  rideGroups,
  rideRequests,
  safetyEvents,
  sosIncidents,
  stations,
  trustedContacts,
  tripShares,
  users,
  type SafetyEvent,
  type SosIncident,
} from '../db/schema';
import { opaqueToken } from '../lib/crypto';
import { conflict, forbidden, notFound } from '../lib/errors';
import { addMs, HOUR, MINUTE, SECOND } from '../lib/time';
import { realtime } from '../realtime/hub';
import { sendMail, templates } from './mailer';
import { notify } from './notifications';
import { driverPublicDto, loadDriverWithUser, stationDto } from './views';

/**
 * Safety layer.
 *
 * Design principles:
 *  • SOS is SILENT to the driver — alerting a potential aggressor can escalate danger.
 *    It goes to the rider's trusted contacts and the ops team only.
 *  • Anomalies (route deviation, long unexpected stop, speeding) never accuse anyone.
 *    They ask the rider "Are you okay?" and only escalate if the rider says no or
 *    doesn't answer within CHECK_IN_TIMEOUT_SEC.
 *  • Live trip links expose first name, vehicle and live position only — no phone
 *    numbers, no exact home address of co-riders.
 */

const mapsLink = (p: LatLng) => `https://maps.google.com/?q=${p.lat},${p.lng}`;
const shareLink = (token: string) => `${env.PUBLIC_WEB_URL}/share/${token}`;

export function safetyEventDto(e: SafetyEvent): SafetyEventDto {
  return {
    id: e.id,
    type: e.type,
    groupId: e.groupId,
    rideId: e.rideId,
    severity: e.severity,
    message: e.message,
    location: e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng } : null,
    createdAt: e.createdAt.toISOString(),
  };
}

// ── Trip sharing ─────────────────────────────────────────

export async function ensureShare(rideId: string, userId: string) {
  const [ride] = await db.select().from(rideRequests).where(eq(rideRequests.id, rideId));
  if (!ride) throw notFound('Ride');
  if (ride.userId !== userId) throw forbidden();
  const [existing] = await db
    .select()
    .from(tripShares)
    .where(and(eq(tripShares.rideId, rideId), isNull(tripShares.revokedAt), gte(tripShares.expiresAt, new Date())));
  if (existing) return { token: existing.token, url: shareLink(existing.token), created: false };
  const [share] = await db
    .insert(tripShares)
    .values({
      token: opaqueToken(18),
      rideId,
      userId,
      expiresAt: addMs(new Date(), env.SHARE_LINK_TTL_HOURS * HOUR),
    })
    .returning();
  await logEvent({
    type: 'trip_shared',
    severity: 'info',
    rideId,
    userId,
    groupId: ride.groupId,
    message: 'Live trip link created',
  });
  return { token: share!.token, url: shareLink(share!.token), created: true };
}

export async function revokeShare(rideId: string, userId: string) {
  await db
    .update(tripShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(tripShares.rideId, rideId), eq(tripShares.userId, userId)));
}

/** Emails the live link to every trusted contact (used on trip start when auto-share is on). */
export async function shareWithContacts(rideId: string, userId: string) {
  const { url } = await ensureShare(rideId, userId);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const contacts = await db.select().from(trustedContacts).where(eq(trustedContacts.userId, userId));
  const vehicle = await vehicleForRide(rideId);
  let sent = 0;
  for (const c of contacts) {
    if (!c.email) continue;
    const t = templates.tripShared(firstName(user?.name), url, vehicle);
    await sendMail({ to: c.email, ...t });
    sent++;
  }
  return { url, contacts: contacts.length, emailed: sent };
}

async function vehicleForRide(rideId: string): Promise<string | null> {
  const [row] = await db
    .select({ d: drivers })
    .from(rideRequests)
    .innerJoin(rideGroups, eq(rideGroups.id, rideRequests.groupId))
    .innerJoin(drivers, eq(drivers.id, rideGroups.driverId))
    .where(eq(rideRequests.id, rideId));
  return row ? `${row.d.vehicleColor} ${row.d.vehicleModel} · ${row.d.vehicleNumber}` : null;
}

export async function shareView(token: string): Promise<ShareViewDto> {
  const [row] = await db
    .select({ share: tripShares, ride: rideRequests, user: users })
    .from(tripShares)
    .innerJoin(rideRequests, eq(rideRequests.id, tripShares.rideId))
    .innerJoin(users, eq(users.id, tripShares.userId))
    .where(eq(tripShares.token, token));
  if (!row || row.share.revokedAt || row.share.expiresAt < new Date()) throw notFound('Shared trip');

  const [station] = await db.select().from(stations).where(eq(stations.id, row.ride.stationId));
  const group = row.ride.groupId
    ? (await db.select().from(rideGroups).where(eq(rideGroups.id, row.ride.groupId)))[0]
    : undefined;
  const driver = group?.driverId ? await loadDriverWithUser(group.driverId) : null;
  const [last] = row.ride.groupId
    ? await db
        .select()
        .from(safetyEvents)
        .where(and(eq(safetyEvents.rideId, row.ride.id), inArray(safetyEvents.severity, ['warning', 'critical'])))
        .orderBy(desc(safetyEvents.createdAt))
        .limit(1)
    : [];

  return {
    token,
    riderFirstName: firstName(row.user.name),
    status: group?.status ?? 'accepting',
    station: stationDto(station!),
    destinationLabel: row.ride.destinationLabel,
    destination: { lat: row.ride.destLat, lng: row.ride.destLng },
    route: group?.route ?? [],
    driver: driver ? driverPublicDto(driver.driver, driver.user) : null,
    expiresAt: row.share.expiresAt.toISOString(),
    lastSafetyEvent: last ? safetyEventDto(last) : null,
  };
}

async function activeShareTokens(groupId: string) {
  const rows = await db
    .select({ token: tripShares.token })
    .from(tripShares)
    .innerJoin(rideRequests, eq(rideRequests.id, tripShares.rideId))
    .where(and(eq(rideRequests.groupId, groupId), isNull(tripShares.revokedAt), gte(tripShares.expiresAt, new Date())));
  return rows.map((r) => r.token);
}

/** Fan-out of the cab's position to the group room and every live share viewer. */
export async function broadcastLocation(groupId: string, payload: unknown) {
  realtime.toGroup(groupId, SOCKET_EVENTS.driverLocation, payload);
  for (const t of await activeShareTokens(groupId)) realtime.toShare(t, SOCKET_EVENTS.driverLocation, payload);
}

// ── Events & check-ins ───────────────────────────────────

async function logEvent(e: typeof safetyEvents.$inferInsert) {
  const [row] = await db.insert(safetyEvents).values(e).returning();
  return row!;
}

const signalMessage = {
  route_deviation: (km: number) => `The cab is ${km} km off the planned route`,
  unexpected_stop: (min: number) => `The cab has been stopped for ${min} minutes away from any planned stop`,
  speeding: (kmh: number) => `The cab is travelling at ${kmh} km/h`,
};

/** Prompts every on-board rider to confirm they're safe. */
async function promptCheckIns(groupId: string, type: SafetyEvent['type'], message: string, at: LatLng | null, severity: 'info' | 'warning') {
  const onboard = await db
    .select({ ride: rideRequests })
    .from(rideRequests)
    .where(and(eq(rideRequests.groupId, groupId), eq(rideRequests.status, 'picked_up')));
  const deadline = addMs(new Date(), env.CHECK_IN_TIMEOUT_SEC * SECOND);
  const created: SafetyEvent[] = [];
  for (const { ride } of onboard) {
    const ev = await logEvent({
      type,
      severity,
      groupId,
      rideId: ride.id,
      userId: ride.userId,
      message,
      lat: at?.lat,
      lng: at?.lng,
      checkInDeadline: deadline,
    });
    created.push(ev);
    realtime.toUser(ride.userId, SOCKET_EVENTS.safetyCheckIn, {
      eventId: ev.id,
      rideId: ride.id,
      message,
      deadline: deadline.toISOString(),
    });
  }
  if (severity === 'warning') {
    realtime.toAdmins(SOCKET_EVENTS.safetyAlert, { groupId, type, message, location: at });
    for (const t of await activeShareTokens(groupId)) {
      realtime.toShare(t, SOCKET_EVENTS.safetyAlert, { type, message });
    }
  }
  return created;
}

/** Runs the pure detectors on the latest pings and raises de-duplicated alerts. */
export async function evaluateTrip(groupId: string) {
  const [group] = await db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
  if (!group || group.status !== 'on_trip') return [];
  const pings = await db
    .select()
    .from(locationPings)
    .where(and(eq(locationPings.groupId, groupId), gte(locationPings.createdAt, addMs(new Date(), -15 * MINUTE))))
    .orderBy(asc(locationPings.createdAt));
  const remaining = await db
    .select({ lat: rideRequests.destLat, lng: rideRequests.destLng })
    .from(rideRequests)
    .where(and(eq(rideRequests.groupId, groupId), inArray(rideRequests.status, ['picked_up', 'completed'])));

  const signals = evaluatePings(
    pings.map((p) => ({ lat: p.lat, lng: p.lng, at: p.createdAt.getTime(), speedKmh: p.speedKmh })),
    group.route,
    remaining,
    DEFAULT_SAFETY_THRESHOLDS,
  );
  if (signals.length === 0) return [];

  const recent = await db
    .select({ type: safetyEvents.type })
    .from(safetyEvents)
    .where(and(eq(safetyEvents.groupId, groupId), gte(safetyEvents.createdAt, addMs(new Date(), -10 * MINUTE))));
  const seen = new Set(recent.map((r) => r.type));
  const last = pings.at(-1);
  const raised: SafetyEvent[] = [];
  for (const s of signals) {
    if (seen.has(s.type)) continue;
    const msg =
      s.type === 'route_deviation'
        ? signalMessage.route_deviation(s.offRouteKm)
        : s.type === 'unexpected_stop'
          ? signalMessage.unexpected_stop(s.minutes)
          : signalMessage.speeding(s.speedKmh);
    raised.push(...(await promptCheckIns(groupId, s.type, msg, last ? { lat: last.lat, lng: last.lng } : null, 'warning')));
  }
  return raised;
}

/** Gentle periodic "you okay?" prompts on night trips for riders who opted in. */
export async function nightCheckIns(now = new Date()) {
  if (!isNightTime(now)) return 0;
  const trips = await db
    .select({ id: rideGroups.id })
    .from(rideGroups)
    .where(and(eq(rideGroups.status, 'on_trip'), lte(rideGroups.startedAt, addMs(now, -10 * MINUTE))));
  let prompted = 0;
  for (const t of trips) {
    const [recent] = await db
      .select({ id: safetyEvents.id })
      .from(safetyEvents)
      .where(and(eq(safetyEvents.groupId, t.id), gte(safetyEvents.createdAt, addMs(now, -15 * MINUTE))))
      .limit(1);
    if (recent) continue;
    const riders = await db
      .select({ ride: rideRequests, user: users })
      .from(rideRequests)
      .innerJoin(users, eq(users.id, rideRequests.userId))
      .where(and(eq(rideRequests.groupId, t.id), eq(rideRequests.status, 'picked_up')));
    if (!riders.some((r) => r.user.safety.nightCheckIns)) continue;
    await promptCheckIns(t.id, 'check_in_ok', 'Night ride check-in: tap if everything is okay', null, 'info');
    prompted++;
  }
  return prompted;
}

export async function respondCheckIn(userId: string, rideId: string, safe: boolean) {
  const [ride] = await db.select().from(rideRequests).where(eq(rideRequests.id, rideId));
  if (!ride) throw notFound('Ride');
  if (ride.userId !== userId) throw forbidden();
  await db
    .update(safetyEvents)
    .set({ checkInResolvedAt: new Date() })
    .where(and(eq(safetyEvents.rideId, rideId), isNull(safetyEvents.checkInResolvedAt)));
  if (safe) {
    await logEvent({ type: 'check_in_ok', severity: 'info', rideId, userId, groupId: ride.groupId, message: 'Rider confirmed they are safe' });
    return { escalated: false };
  }
  const sos = await raiseSos(userId, { rideId, message: 'Rider answered "I need help" to a safety check-in' });
  return { escalated: true, sosId: sos.id };
}

/** Check-ins nobody answered → tell trusted contacts and the ops team. */
export async function escalateMissedCheckIns(now = new Date()) {
  const missed = await db
    .update(safetyEvents)
    .set({ checkInResolvedAt: now })
    .where(and(isNull(safetyEvents.checkInResolvedAt), lte(safetyEvents.checkInDeadline, now)))
    .returning();
  for (const ev of missed) {
    if (!ev.userId || !ev.rideId) continue;
    // Night "all good?" pings only escalate in-app; anomaly prompts escalate to humans.
    if (ev.severity === 'info') continue;
    const [user] = await db.select().from(users).where(eq(users.id, ev.userId));
    const { url } = await ensureShare(ev.rideId, ev.userId);
    await logEvent({
      type: 'check_in_missed',
      severity: 'critical',
      groupId: ev.groupId,
      rideId: ev.rideId,
      userId: ev.userId,
      message: `No response to: ${ev.message}`,
      lat: ev.lat,
      lng: ev.lng,
    });
    const contacts = await db.select().from(trustedContacts).where(eq(trustedContacts.userId, ev.userId));
    for (const c of contacts) {
      if (c.email) await sendMail({ to: c.email, ...templates.checkInMissed(firstName(user?.name), url, ev.message) });
    }
    realtime.toAdmins(SOCKET_EVENTS.safetyAlert, {
      groupId: ev.groupId,
      type: 'check_in_missed',
      message: `${firstName(user?.name)} did not respond: ${ev.message}`,
      location: ev.lat != null ? { lat: ev.lat, lng: ev.lng } : null,
    });
  }
  return missed.filter((m) => m.severity !== 'info').length;
}

// ── SOS ──────────────────────────────────────────────────

async function sosDto(s: SosIncident): Promise<SosDto> {
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  const d = s.driverId ? await loadDriverWithUser(s.driverId) : null;
  return {
    id: s.id,
    status: s.status,
    user: { id: u!.id, name: u!.name, phone: u!.phone, gender: u!.gender },
    rideId: s.rideId,
    groupId: s.groupId,
    location: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null,
    message: s.message,
    driver: d ? { name: d.user.name, phone: d.user.phone, vehicleNumber: d.driver.vehicleNumber } : null,
    createdAt: s.createdAt.toISOString(),
    resolvedAt: s.resolvedAt?.toISOString() ?? null,
    note: s.note,
  };
}

export async function raiseSos(userId: string, input: RaiseSosInput) {
  // Resolve the ride: explicit, else the rider's currently active trip.
  let rideId = input.rideId ?? null;
  if (!rideId) {
    const [active] = await db
      .select({ id: rideRequests.id })
      .from(rideRequests)
      .where(and(eq(rideRequests.userId, userId), inArray(rideRequests.status, ['picked_up', 'confirmed', 'matched'])))
      .orderBy(desc(rideRequests.updatedAt))
      .limit(1);
    rideId = active?.id ?? null;
  }
  const ride = rideId ? (await db.select().from(rideRequests).where(eq(rideRequests.id, rideId)))[0] : undefined;
  if (ride && ride.userId !== userId) throw forbidden();
  const group = ride?.groupId ? (await db.select().from(rideGroups).where(eq(rideGroups.id, ride.groupId)))[0] : undefined;
  const driver = group?.driverId ? (await db.select().from(drivers).where(eq(drivers.id, group.driverId)))[0] : undefined;

  const location =
    input.location ?? (driver?.lat != null && driver.lng != null ? { lat: driver.lat, lng: driver.lng } : null);

  const [open] = await db
    .select()
    .from(sosIncidents)
    .where(and(eq(sosIncidents.userId, userId), inArray(sosIncidents.status, ['open', 'acknowledged'])))
    .limit(1);
  if (open) {
    // Repeated presses update the location instead of spamming everyone.
    const [updated] = await db
      .update(sosIncidents)
      .set({ lat: location?.lat ?? open.lat, lng: location?.lng ?? open.lng })
      .where(eq(sosIncidents.id, open.id))
      .returning();
    const dto = await sosDto(updated!);
    realtime.toAdmins(SOCKET_EVENTS.sosUpdated, dto);
    return dto;
  }

  const [incident] = await db
    .insert(sosIncidents)
    .values({
      userId,
      rideId: ride?.id,
      groupId: group?.id,
      driverId: driver?.id,
      lat: location?.lat,
      lng: location?.lng,
      message: input.message,
    })
    .returning();

  await logEvent({
    type: 'sos',
    severity: 'critical',
    userId,
    rideId: ride?.id,
    groupId: group?.id,
    message: input.message ?? 'SOS triggered',
    lat: location?.lat,
    lng: location?.lng,
  });

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const share = ride ? await ensureShare(ride.id, userId) : null;
  const contacts = await db.select().from(trustedContacts).where(eq(trustedContacts.userId, userId));
  const vehicle = ride ? await vehicleForRide(ride.id) : null;
  for (const c of contacts) {
    if (!c.email) continue;
    await sendMail({
      to: c.email,
      ...templates.sos(
        firstName(user?.name),
        share?.url ?? env.PUBLIC_WEB_URL,
        location ? mapsLink(location) : 'unknown',
        vehicle,
      ),
    });
  }

  const dto = await sosDto(incident!);
  realtime.toAdmins(SOCKET_EVENTS.sosRaised, dto);
  if (share) realtime.toShare(share.token, SOCKET_EVENTS.safetyAlert, { type: 'sos', message: `${firstName(user?.name)} triggered SOS` });
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  for (const a of admins) {
    await notify(a.id, {
      kind: 'sos',
      title: `🚨 SOS — ${user?.name ?? 'rider'}`,
      body: vehicle ? `In ${vehicle}` : 'No active trip',
      link: `/admin/sos/${incident!.id}`,
    });
  }
  return { ...dto, contactsNotified: contacts.filter((c) => c.email).length };
}

export async function listSos(opts: { userId?: string; status?: SosIncident['status'][] } = {}) {
  const conds = [];
  if (opts.userId) conds.push(eq(sosIncidents.userId, opts.userId));
  if (opts.status?.length) conds.push(inArray(sosIncidents.status, opts.status));
  const rows = await db
    .select()
    .from(sosIncidents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sosIncidents.createdAt))
    .limit(100);
  return Promise.all(rows.map(sosDto));
}

export async function updateSos(id: string, adminId: string, status: 'acknowledged' | 'resolved' | 'false_alarm', note?: string) {
  const [s] = await db.select().from(sosIncidents).where(eq(sosIncidents.id, id));
  if (!s) throw notFound('SOS incident');
  if (s.status === 'resolved' || s.status === 'false_alarm') throw conflict('SOS_CLOSED', 'Incident already closed');
  const [updated] = await db
    .update(sosIncidents)
    .set({
      status,
      note: note ?? s.note,
      handledBy: adminId,
      resolvedAt: status === 'acknowledged' ? null : new Date(),
    })
    .where(eq(sosIncidents.id, id))
    .returning();
  const dto = await sosDto(updated!);
  realtime.toAdmins(SOCKET_EVENTS.sosUpdated, dto);
  await notify(s.userId, {
    kind: 'sos_update',
    title: status === 'acknowledged' ? 'Our safety team is on it' : 'SOS closed',
    body:
      status === 'acknowledged'
        ? 'A safety specialist has seen your alert and is contacting you now.'
        : note ?? 'Your SOS has been marked resolved. Stay safe!',
    link: '/safety',
  });
  return dto;
}

export async function safetyTimeline(rideId: string) {
  const rows = await db
    .select()
    .from(safetyEvents)
    .where(eq(safetyEvents.rideId, rideId))
    .orderBy(desc(safetyEvents.createdAt))
    .limit(50);
  return rows.map(safetyEventDto);
}
