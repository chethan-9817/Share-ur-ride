import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '../src/db/client';
import { rideGroups, safetyEvents } from '../src/db/schema';
import { bus, type EmittedEvent } from '../src/realtime/hub';
import { outbox } from '../src/services/mailer';
import { escalateMissedCheckIns, evaluateTrip } from '../src/services/safety';
import { client, createTestApp, demoLogin, inMinutes, INDIRANAGAR, NEAR_INDIRANAGAR, otpLogin, stationId, type As } from './helpers';

let app: FastifyInstance;
let blr: string;
const events: EmittedEvent[] = [];

beforeAll(async () => {
  app = await createTestApp();
  bus.on('emit', (e: EmittedEvent) => events.push(e));
  blr = await stationId(app);
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

async function rider(email: string, gender: 'female' | 'male', name: string) {
  const u = await otpLogin(app, email);
  await client(app, u).patch('/me', { name, phone: `98${Math.floor(10000000 + Math.random() * 89999999)}`, gender });
  return u;
}

const book = (who: As, dest: { lat: number; lng: number }, extra: Record<string, unknown> = {}) =>
  client(app, who).post('/rides', {
    stationId: blr,
    destination: dest,
    destinationLabel: 'Indiranagar',
    arrivalAt: inMinutes(30),
    toleranceMin: 20,
    ...extra,
  });

describe('women safety', () => {
  it('only offers women-only pooling to women', async () => {
    const m = await rider('mohan@example.com', 'male', 'Mohan Das');
    const r = await book(m, INDIRANAGAR, { womenOnly: true });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('WOMEN_ONLY_GENDER');
  });

  it('never pools a women-only rider with a man', async () => {
    const w = await rider('sana@example.com', 'female', 'Sana Khan');
    const m = await rider('dev@example.com', 'male', 'Dev Patel');
    const rw = await book(w, INDIRANAGAR, { womenOnly: true });
    const rm = await book(m, NEAR_INDIRANAGAR);
    expect(rw.body.status).toBe('pending');
    expect(rm.body.status).toBe('pending');

    const w2 = await rider('isha@example.com', 'female', 'Isha Roy');
    const r2 = await book(w2, NEAR_INDIRANAGAR);
    expect(r2.body.status).toBe('matched');
    const g = await client(app, w2).get(`/rides/${r2.body.id}/group`);
    expect(g.body.womenOnly).toBe(true);
    expect(g.body.members.map((x: { firstName: string }) => x.firstName).sort()).toEqual(['Sana', 'You']);
  });

  it('offers women-only groups to female drivers first', async () => {
    const admin = await demoLogin(app, 'admin');
    // Make one male and one female bot driver available right at the hub.
    const drivers = (await client(app, admin).get('/admin/drivers')).body as { id: string; name: string; gender: string }[];
    expect(drivers.some((d) => d.gender === 'female')).toBe(true);

    const w = await rider('tara@example.com', 'female', 'Tara Bose');
    const w2 = await rider('nila@example.com', 'female', 'Nila Sen');
    // Arrive much later than earlier riders so only these two can pool.
    const late = { arrivalAt: inMinutes(160), toleranceMin: 10, destinationLabel: 'Hebbal' };
    const a = await book(w, { lat: 13.0358, lng: 77.597 }, { womenOnly: true, ...late });
    const b = await book(w2, { lat: 13.04, lng: 77.592 }, late);
    expect(b.body.status).toBe('matched');

    // Bring Ravi (male, nearest) and Lakshmi (female bot) online.
    const ravi = await demoLogin(app, 'driver');
    await client(app, ravi).post('/driver/status', { online: true });
    const { users, drivers: driversT } = await import('../src/db/schema');
    const [lakshmi] = await db.select().from(users).where(eq(users.name, 'Lakshmi Devi'));
    await db.update(driversT).set({ status: 'online' }).where(eq(driversT.userId, lakshmi!.id));

    await client(app, w).post(`/rides/${a.body.id}/accept`);
    await client(app, w2).post(`/rides/${b.body.id}/accept`);
    expect((await client(app, ravi).get('/driver/offer')).body).toBeNull();
    const offerEvt = events.filter((e) => e.event === 'offer:received').at(-1)!;
    expect(offerEvt.room).toBe(`user:${lakshmi!.id}`);
  });
});

describe('SOS and check-ins', () => {
  let priya: As;
  let rideId: string;
  let groupId: string;

  beforeAll(async () => {
    priya = await demoLogin(app, 'rider');
    const r = await book(priya, { lat: 12.9352, lng: 77.6245 }, { destinationLabel: 'Koramangala', arrivalAt: inMinutes(120) });
    rideId = r.body.id;
    await client(app, priya).post(`/rides/${rideId}/solo`);
    const ride = (await client(app, priya).get(`/rides/${rideId}`)).body;
    groupId = ride.groupId;
  });

  it('manages trusted contacts (max 5)', async () => {
    const list = await client(app, priya).get('/me/contacts');
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    const add = await client(app, priya).post('/me/contacts', { name: 'Rohan', phone: '9123456780', email: 'rohan@example.com', relation: 'Brother' });
    expect(add.status).toBe(201);
    expect(add.body.phone).toBe('+919123456780');
  });

  it('raises a silent SOS: contacts and ops are alerted, the driver is not', async () => {
    const before = outbox.length;
    const sos = await client(app, priya).post('/safety/sos', { location: { lat: 13.0, lng: 77.6 }, message: 'Feeling unsafe' });
    expect(sos.status).toBe(201);
    expect(sos.body.status).toBe('open');
    expect(sos.body.contactsNotified).toBe(2);
    const mails = outbox.slice(before);
    expect(mails.every((m) => m.subject.includes('SOS'))).toBe(true);
    expect(mails[0]!.text).toContain('/share/');

    const sosEvents = events.filter((e) => e.event === 'sos:raised');
    expect(sosEvents.every((e) => e.room === 'admins')).toBe(true);
    expect(events.some((e) => e.room === `group:${groupId}` && e.event.startsWith('sos'))).toBe(false);

    // A second press updates the same incident rather than spamming.
    const again = await client(app, priya).post('/safety/sos', { location: { lat: 13.01, lng: 77.61 } });
    expect(again.body.id).toBe(sos.body.id);
  });

  it('lets ops acknowledge and resolve the incident', async () => {
    const admin = await demoLogin(app, 'admin');
    const open = await client(app, admin).get('/admin/sos?open=true');
    const id = open.body[0].id;
    expect((await client(app, admin).patch(`/admin/sos/${id}`, { status: 'acknowledged' })).body.status).toBe('acknowledged');
    expect((await client(app, admin).patch(`/admin/sos/${id}`, { status: 'resolved', note: 'Called rider, all fine' })).body.status).toBe('resolved');
    expect((await client(app, admin).get('/admin/overview')).body.openSos).toBe(0);
  });

  it('detects a route deviation on a live trip and escalates a missed check-in', async () => {
    // Fast-forward this group to on_trip with Priya on board.
    const { rideRequests } = await import('../src/db/schema');
    await db.update(rideRequests).set({ status: 'picked_up' }).where(eq(rideRequests.id, rideId));
    await db
      .update(rideGroups)
      .set({ status: 'on_trip', startedAt: new Date(), route: [{ lat: 13.1989, lng: 77.7068 }, { lat: 12.9352, lng: 77.6245 }] })
      .where(eq(rideGroups.id, groupId));
    const { locationPings, drivers } = await import('../src/db/schema');
    const [anyDriver] = await db.select().from(drivers).limit(1);
    for (let i = 0; i < 3; i++) {
      await db.insert(locationPings).values({ driverId: anyDriver!.id, groupId, lat: 13.05 + i * 0.002, lng: 77.5 });
    }
    const raised = await evaluateTrip(groupId);
    expect(raised[0]?.type).toBe('route_deviation');
    expect(events.some((e) => e.room === `user:${priya.userId}` && e.event === 'safety:check_in')).toBe(true);

    await db.update(safetyEvents).set({ checkInDeadline: new Date(Date.now() - 1000) }).where(and(eq(safetyEvents.groupId, groupId), isNotNull(safetyEvents.checkInDeadline)));
    const before = outbox.length;
    expect(await escalateMissedCheckIns()).toBe(1);
    expect(outbox.slice(before).some((m) => m.subject.includes("hasn't responded"))).toBe(true);
  });

  it('turns an "I need help" check-in answer into an SOS', async () => {
    const res = await client(app, priya).post('/safety/check-in', { rideId, safe: false });
    expect(res.body.escalated).toBe(true);
  });

  it('keeps share links private to their owner and expires revoked ones', async () => {
    const other = await otpLogin(app, 'snoop@example.com');
    expect((await client(app, other).post(`/rides/${rideId}/share`)).status).toBe(403);
    const s = await client(app, priya).post(`/rides/${rideId}/share`);
    await client(app, priya).del(`/rides/${rideId}/share`);
    expect((await client(app, null).get(`/share/${s.body.token}`)).status).toBe(404);
  });
});
