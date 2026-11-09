import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client';
import { bus, type EmittedEvent } from '../src/realtime/hub';
import { tick } from '../src/services/scheduler';
import { client, createTestApp, demoLogin, HEBBAL, inMinutes, INDIRANAGAR, NEAR_INDIRANAGAR, otpLogin, stationId, type As } from './helpers';

let app: FastifyInstance;
let priya: As;
let arjun: As;
let ravi: As;
let blr: string;
const events: EmittedEvent[] = [];

beforeAll(async () => {
  app = await createTestApp();
  bus.on('emit', (e: EmittedEvent) => events.push(e));
  priya = await demoLogin(app, 'rider');
  arjun = await demoLogin(app, 'rider2');
  ravi = await demoLogin(app, 'driver');
  blr = await stationId(app);
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const book = (who: As, dest: { lat: number; lng: number }, label: string, extra: Record<string, unknown> = {}) =>
  client(app, who).post('/rides', {
    stationId: blr,
    destination: dest,
    destinationLabel: label,
    arrivalAt: inMinutes(20),
    toleranceMin: 20,
    luggage: 1,
    ...extra,
  });

describe('ride lifecycle', () => {
  let priyaRide: string;
  let arjunRide: string;
  let groupId: string;

  it('quotes a fare without creating state', async () => {
    const q = await client(app, priya).post('/rides/quote', { stationId: blr, destination: INDIRANAGAR });
    expect(q.status).toBe(200);
    expect(q.body.soloKm).toBeGreaterThan(20);
    expect(q.body.estimatedSharedFare).toBeLessThan(q.body.soloFare);
  });

  it('pools two riders on the same corridor as soon as the second books', async () => {
    const a = await book(priya, INDIRANAGAR, 'Indiranagar');
    expect(a.status).toBe(201);
    expect(a.body.status).toBe('pending');
    priyaRide = a.body.id;

    const b = await book(arjun, NEAR_INDIRANAGAR, 'HAL 2nd Stage');
    expect(b.status).toBe(201);
    expect(b.body.status).toBe('matched');
    arjunRide = b.body.id;
    groupId = b.body.groupId;

    const p = await client(app, priya).get(`/rides/${priyaRide}`);
    expect(p.body.status).toBe('matched');
    expect(p.body.groupId).toBe(groupId);
    expect(p.body.quotedFare).toBeLessThan(p.body.soloFare);
    expect(events.some((e) => e.room === `user:${priya.userId}` && e.event === 'ride:updated')).toBe(true);
  });

  it('prevents double-booking while a ride is active', async () => {
    const dup = await book(priya, HEBBAL, 'Hebbal');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ACTIVE_RIDE');
  });

  it('shows co-riders by first name only — no destinations or PINs', async () => {
    const g = await client(app, priya).get(`/rides/${priyaRide}/group`);
    const other = g.body.members.find((m: { isMe: boolean }) => !m.isMe);
    expect(other.firstName).toBe('Arjun');
    expect(other.destination).toBeUndefined();
    expect(other.pickupPin).toBeUndefined();
    const me = g.body.members.find((m: { isMe: boolean }) => m.isMe);
    expect(me.pickupPin).toMatch(/^\d{4}$/);
  });

  it('locks the fare on accept and starts dispatch when everyone accepts', async () => {
    const a1 = await client(app, priya).post(`/rides/${priyaRide}/accept`);
    expect(a1.body.status).toBe('confirmed');
    expect(a1.body.acceptedFare).toBe(a1.body.quotedFare);

    // Driver goes online before the group is complete.
    expect((await client(app, ravi).post('/driver/status', { online: true })).body.status).toBe('online');

    await client(app, arjun).post(`/rides/${arjunRide}/accept`);
    const offer = await client(app, ravi).get('/driver/offer');
    expect(offer.body?.groupId).toBe(groupId);
    expect(offer.body.passengers).toBe(2);
    expect(offer.body.payout.net).toBeGreaterThan(0);
  });

  it('assigns the driver when they accept the offer', async () => {
    const offer = await client(app, ravi).get('/driver/offer');
    const res = await client(app, ravi).post(`/driver/offers/${offer.body.id}/accept`);
    expect(res.body.accepted).toBe(true);
    const g = await client(app, priya).get(`/rides/${priyaRide}/group`);
    expect(g.body.status).toBe('assigned');
    expect(g.body.driver.name).toBe('Ravi Kumar');
    expect(g.body.driver.phoneMasked).toMatch(/^\+91 ••••• •\d{4}$/);
    // Driver cannot go offline mid-trip.
    expect((await client(app, ravi).post('/driver/status', { online: false })).status).toBe(409);
  });

  it('requires the correct PIN for every rider before starting', async () => {
    await client(app, ravi).post('/driver/trip/arrive');
    const trip = await client(app, ravi).get('/driver/trip');
    expect(trip.body.status).toBe('arrived');
    expect(trip.body.members.every((m: { destination?: unknown }) => m.destination)).toBe(true);

    const priyaPin = (await client(app, priya).get(`/rides/${priyaRide}`)).body.pickupPin as string;
    const wrong = priyaPin === '0000' ? '1111' : '0000';
    const bad = await client(app, ravi).post('/driver/trip/verify-pin', { rideId: priyaRide, pin: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('WRONG_PIN');

    expect((await client(app, ravi).post('/driver/trip/start')).body.error.code).toBe('RIDERS_WAITING');

    await client(app, ravi).post('/driver/trip/verify-pin', { rideId: priyaRide, pin: priyaPin });
    const arjunPin = (await client(app, arjun).get(`/rides/${arjunRide}`)).body.pickupPin as string;
    await client(app, ravi).post('/driver/trip/verify-pin', { rideId: arjunRide, pin: arjunPin });
    const start = await client(app, ravi).post('/driver/trip/start');
    expect(start.status).toBe(200);
  });

  it('streams live location to the group and creates a share link', async () => {
    const share = await client(app, priya).post(`/rides/${priyaRide}/share`);
    expect(share.body.url).toContain('/share/');
    const ping = await client(app, ravi).post('/driver/location', { lat: 13.15, lng: 77.68, heading: 200, speedKmh: 42 });
    expect(ping.body.tracked).toBe(true);
    expect(events.some((e) => e.room === `group:${groupId}` && e.event === 'driver:location')).toBe(true);
    expect(events.some((e) => e.room === `share:${share.body.token}` && e.event === 'driver:location')).toBe(true);

    const pub = await client(app, null).get(`/share/${share.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.riderFirstName).toBe('Priya');
    expect(pub.body.driver.vehicle.number).toBe('KA01AB4321');
    expect(JSON.stringify(pub.body)).not.toContain('+9198765');
  });

  it('drops riders, completes the trip and pays the driver', async () => {
    await client(app, ravi).post('/driver/trip/drop', { rideId: arjunRide });
    await client(app, ravi).post('/driver/trip/drop', { rideId: priyaRide });
    const r = await client(app, priya).get(`/rides/${priyaRide}`);
    expect(r.body.status).toBe('completed');
    expect(r.body.finalFare).toBe(r.body.acceptedFare);
    expect(r.body.savings).toBeGreaterThan(0);

    const e = await client(app, ravi).get('/driver/earnings');
    expect(e.body.summary.today.trips).toBe(1);
    expect(e.body.summary.today.passengers).toBe(2);
    expect((await client(app, ravi).get('/driver/me')).body.status).toBe('online');
  });

  it('collects two-way ratings once per ride', async () => {
    const rate = await client(app, priya).post('/ratings', { rideId: priyaRide, score: 5, tags: ['safe_driving'] });
    expect(rate.status).toBe(201);
    expect((await client(app, priya).post('/ratings', { rideId: priyaRide, score: 4 })).status).toBe(409);
    expect((await client(app, ravi).post('/ratings', { rideId: priyaRide, score: 5 })).status).toBe(201);
    expect((await client(app, ravi).get('/driver/me')).body.ratingAvg).toBe(5);
  });
});

describe('membership changes', () => {
  it('returns a lone rider to the pool when their co-rider declines', async () => {
    const a = await otpLogin(app, 'decline.a@example.com');
    const b = await otpLogin(app, 'decline.b@example.com');
    const ra = await book(a, HEBBAL, 'Hebbal');
    const rb = await book(b, { lat: 13.04, lng: 77.592 }, 'Hebbal Kempapura');
    expect(rb.body.status).toBe('matched');

    const d = await client(app, b).post(`/rides/${rb.body.id}/decline`);
    expect(d.body.status).toBe('pending');
    expect((await client(app, a).get(`/rides/${ra.body.id}`)).body.status).toBe('pending');

    // The scheduler must not pool them back into the cancelled group, but may form a new one.
    await tick();
    const after = (await client(app, b).get(`/rides/${rb.body.id}`)).body;
    expect(after.groupId).not.toBe(rb.body.groupId);
  });

  it('lets a rider skip pooling and book solo at the solo fare', async () => {
    const s = await otpLogin(app, 'solo.rider@example.com');
    const r = await book(s, { lat: 12.9116, lng: 77.6474 }, 'HSR Layout', { arrivalAt: inMinutes(150), toleranceMin: 10 });
    const solo = await client(app, s).post(`/rides/${r.body.id}/solo`);
    expect(solo.body.status).toBe('confirmed');
    expect(solo.body.acceptedFare).toBeLessThanOrEqual(solo.body.soloFare);
  });

  it('cancels cleanly and frees the seat', async () => {
    const c = await otpLogin(app, 'cancel.me@example.com');
    const r = await book(c, { lat: 12.8452, lng: 77.6602 }, 'Electronic City', { arrivalAt: inMinutes(170) });
    const res = await client(app, c).post(`/rides/${r.body.id}/cancel`, { reason: 'Flight delayed' });
    expect(res.body.status).toBe('cancelled');
  });
});
