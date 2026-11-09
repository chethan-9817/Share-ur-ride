import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import type { Gender } from '@arriveshare/shared';
import { env } from '../config/env';
import { db, closeDb, initDb, migrateDb } from './client';
import { drivers, stations, trustedContacts, users } from './schema';
import { DEMO_ACCOUNTS } from '../services/auth';

/** Transit hubs served at launch (Bengaluru). */
export const HUBS = [
  { code: 'BLR', name: 'Kempegowda International Airport', type: 'airport', lat: 13.1989, lng: 77.7068 },
  { code: 'SBC', name: 'KSR Bengaluru City Junction', type: 'railway', lat: 12.9784, lng: 77.57 },
  { code: 'YPR', name: 'Yesvantpur Junction', type: 'railway', lat: 13.0237, lng: 77.5503 },
  { code: 'SMVB', name: 'SMVT Bengaluru (Baiyappanahalli)', type: 'railway', lat: 12.9921, lng: 77.662 },
  { code: 'KBS', name: 'Kempegowda Bus Station (Majestic)', type: 'bus', lat: 12.9767, lng: 77.5713 },
] as const;

interface SeedUser {
  email: string;
  name: string;
  gender: Gender;
  phone: string;
  role: 'rider' | 'driver' | 'admin';
  simulated?: boolean;
}

const HUMANS: SeedUser[] = [
  { email: DEMO_ACCOUNTS.rider, name: 'Priya Sharma', gender: 'female', phone: '+919876500001', role: 'rider' },
  { email: DEMO_ACCOUNTS.rider2, name: 'Arjun Mehta', gender: 'male', phone: '+919876500002', role: 'rider' },
  { email: DEMO_ACCOUNTS.driver, name: 'Ravi Kumar', gender: 'male', phone: '+919876500003', role: 'driver' },
  { email: DEMO_ACCOUNTS.admin, name: 'Safety Ops', gender: 'undisclosed', phone: '+919876500004', role: 'admin' },
];

const BOT_RIDERS: [string, Gender][] = [
  ['Ananya Rao', 'female'],
  ['Meera Iyer', 'female'],
  ['Kavya Nair', 'female'],
  ['Sneha Patil', 'female'],
  ['Divya Menon', 'female'],
  ['Rahul Verma', 'male'],
  ['Karthik Reddy', 'male'],
  ['Vikram Singh', 'male'],
];

const BOT_DRIVERS: { name: string; gender: Gender; hub: number; vehicle: [string, string, string, 'sedan' | 'suv' | 'hatchback'] }[] = [
  { name: 'Lakshmi Devi', gender: 'female', hub: 0, vehicle: ['KA05AB1234', 'Maruti Dzire', 'White', 'sedan'] },
  { name: 'Suresh Gowda', gender: 'male', hub: 0, vehicle: ['KA03MN4521', 'Toyota Etios', 'Silver', 'sedan'] },
  { name: 'Fathima Begum', gender: 'female', hub: 1, vehicle: ['KA01EF7788', 'Hyundai Aura', 'Blue', 'sedan'] },
  { name: 'Manjunath S', gender: 'male', hub: 2, vehicle: ['KA04GH3390', 'Maruti Ertiga', 'Grey', 'suv'] },
  { name: 'Ramesh Babu', gender: 'male', hub: 3, vehicle: ['KA51JK6612', 'Honda Amaze', 'Red', 'sedan'] },
  { name: 'Shalini K', gender: 'female', hub: 4, vehicle: ['KA02LM9081', 'Tata Tigor EV', 'Teal', 'sedan'] },
];

const jitter = (v: number, d = 0.01) => v + (Math.random() - 0.5) * d;

async function upsertUser(u: SeedUser) {
  await db
    .insert(users)
    .values({
      ...u,
      emailVerified: true,
      onboarded: true,
      simulated: u.simulated ?? false,
      safety: { autoShareTrips: true, nightCheckIns: true, womenOnlyDefault: false, preferFemaleDriver: u.gender === 'female' },
      ratingSum: u.simulated ? 4 * 9 + 5 * 3 : 0,
      ratingCount: u.simulated ? 12 : 0,
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(users).where(eq(users.email, u.email));
  return row!;
}

export async function seed({ quiet = false } = {}) {
  const log = (m: string) => !quiet && console.log(m);

  await db
    .insert(stations)
    .values(HUBS.map((h) => ({ ...h, city: 'Bengaluru' })))
    .onConflictDoNothing();
  const hubRows = await db.select().from(stations);
  const hubByCode = new Map(hubRows.map((h) => [h.code, h]));
  log(`✔ ${hubRows.length} hubs`);

  if (!env.DEMO_MODE) return;

  const created = await Promise.all(HUMANS.map(upsertUser));
  const priya = created[0]!;
  const ravi = created[2]!;

  const [hasContact] = await db.select().from(trustedContacts).where(eq(trustedContacts.userId, priya.id));
  if (!hasContact) {
    await db.insert(trustedContacts).values({
      userId: priya.id,
      name: 'Asha Sharma',
      phone: '+919876511111',
      email: 'asha.family@example.com',
      relation: 'Mother',
    });
  }

  const blr = hubByCode.get('BLR')!;
  await db
    .insert(drivers)
    .values({
      userId: ravi.id,
      verified: true,
      status: 'offline',
      licenseNumber: 'KA0120190001234',
      vehicleNumber: 'KA01AB4321',
      vehicleModel: 'Toyota Innova Crysta',
      vehicleColor: 'Pearl White',
      vehicleType: 'suv',
      seats: 4,
      luggageCapacity: 6,
      lat: blr.lat + 0.004,
      lng: blr.lng - 0.003,
      locationUpdatedAt: new Date(),
    })
    .onConflictDoNothing();

  for (const [i, [name, gender]] of BOT_RIDERS.entries()) {
    await upsertUser({
      email: `bot.rider${i + 1}@sim.arriveshare.app`,
      name,
      gender,
      phone: `+91900000${String(1000 + i)}`,
      role: 'rider',
      simulated: true,
    });
  }

  for (const [i, b] of BOT_DRIVERS.entries()) {
    const u = await upsertUser({
      email: `bot.driver${i + 1}@sim.arriveshare.app`,
      name: b.name,
      gender: b.gender,
      phone: `+91910000${String(1000 + i)}`,
      role: 'driver',
      simulated: true,
    });
    const hub = hubRows.find((h) => h.code === HUBS[b.hub]!.code)!;
    await db
      .insert(drivers)
      .values({
        userId: u.id,
        verified: true,
        status: env.SIMULATOR_ENABLED ? 'online' : 'offline',
        licenseNumber: `KA0${i}2020${String(100000 + i)}`,
        vehicleNumber: b.vehicle[0],
        vehicleModel: b.vehicle[1],
        vehicleColor: b.vehicle[2],
        vehicleType: b.vehicle[3],
        seats: b.vehicle[3] === 'suv' ? 6 : 4,
        luggageCapacity: b.vehicle[3] === 'suv' ? 6 : 4,
        // Bots wait a few km out so a nearby human driver gets offers first.
        lat: jitter(hub.lat + 0.03, 0.02),
        lng: jitter(hub.lng + 0.03, 0.02),
        locationUpdatedAt: new Date(),
      })
      .onConflictDoNothing();
  }
  log(`✔ demo accounts: ${Object.values(DEMO_ACCOUNTS).join(', ')}`);
  log(`✔ ${BOT_RIDERS.length} simulated riders, ${BOT_DRIVERS.length} simulated drivers`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    await initDb(env.DATABASE_URL);
    await migrateDb();
    await seed();
    await closeDb();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
