import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client';
import { client, createTestApp, demoLogin, inMinutes, stationId, type As } from './helpers';

let app: FastifyInstance;
let priya: As;

const BENGALURU_MG_ROAD = { lat: 12.9756, lng: 77.6066 };
const DELHI = { lat: 28.6139, lng: 77.209 };

beforeAll(async () => {
  app = await createTestApp();
  priya = await demoLogin(app, 'rider');
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('intercity routes (Mangaluru ⇄ Bengaluru)', () => {
  it('serves hubs in Mangaluru and Mysuru as well as Bengaluru', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stations' });
    const stations = res.json() as { code: string; city: string }[];
    expect(stations.find((s) => s.code === 'IXE')?.city).toBe('Mangaluru');
    expect(stations.find((s) => s.code === 'MAQ')?.city).toBe('Mangaluru');
    expect(stations.find((s) => s.code === 'MYS')?.city).toBe('Mysuru');
    expect(stations.find((s) => s.code === 'BLR')?.city).toBe('Bengaluru');
  });

  it('quotes a ~350 km Mangaluru → Bengaluru trip with a sensible shared saving', async () => {
    const hub = await stationId(app, 'MAQ');
    const q = await client(app, priya).post('/rides/quote', { stationId: hub, destination: BENGALURU_MG_ROAD });
    expect(q.status).toBe(200);
    expect(q.body.soloKm).toBeGreaterThan(300);
    expect(q.body.soloKm).toBeLessThan(450);
    expect(q.body.estimatedSharedFare).toBeLessThan(q.body.soloFare);
  });

  it('lets a rider book Mangaluru Central → Bengaluru', async () => {
    const hub = await stationId(app, 'MAQ');
    const r = await client(app, priya).post('/rides', {
      stationId: hub,
      destination: BENGALURU_MG_ROAD,
      destinationLabel: 'MG Road, Bengaluru',
      arrivalAt: inMinutes(30),
      toleranceMin: 20,
      luggage: 1,
    });
    expect(r.status).toBe(201);
    expect(r.body.station.code).toBe('MAQ');
    expect(r.body.soloKm).toBeGreaterThan(300);
  });

  it('still rejects destinations beyond the service limit', async () => {
    const hub = await stationId(app, 'BLR');
    const admin = await demoLogin(app, 'rider2');
    const r = await client(app, admin).post('/rides', {
      stationId: hub,
      destination: DELHI,
      destinationLabel: 'New Delhi',
      arrivalAt: inMinutes(30),
      toleranceMin: 20,
      luggage: 1,
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('TOO_FAR');
  });
});
