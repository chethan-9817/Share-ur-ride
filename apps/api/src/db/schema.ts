import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  DRIVER_STATUSES,
  GENDERS,
  GROUP_STATUSES,
  HUB_TYPES,
  OFFER_STATUSES,
  RIDE_STATUSES,
  ROLES,
  SAFETY_EVENT_TYPES,
  SOS_STATUSES,
  VEHICLE_TYPES,
  type LatLng,
  type SafetyPrefs,
} from '@arriveshare/shared';

// ── Enums ────────────────────────────────────────────────
export const roleEnum = pgEnum('role', ROLES);
export const genderEnum = pgEnum('gender', GENDERS);
export const hubTypeEnum = pgEnum('hub_type', HUB_TYPES);
export const rideStatusEnum = pgEnum('ride_status', RIDE_STATUSES);
export const groupStatusEnum = pgEnum('group_status', GROUP_STATUSES);
export const offerStatusEnum = pgEnum('offer_status', OFFER_STATUSES);
export const driverStatusEnum = pgEnum('driver_status', DRIVER_STATUSES);
export const sosStatusEnum = pgEnum('sos_status', SOS_STATUSES);
export const safetyEventEnum = pgEnum('safety_event_type', SAFETY_EVENT_TYPES);
export const vehicleTypeEnum = pgEnum('vehicle_type', VEHICLE_TYPES);
export const severityEnum = pgEnum('severity', ['info', 'warning', 'critical']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const DEFAULT_SAFETY: SafetyPrefs = {
  autoShareTrips: true,
  nightCheckIns: true,
  womenOnlyDefault: false,
  preferFemaleDriver: false,
};

// ── Identity ─────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    gender: genderEnum('gender').notNull().default('undisclosed'),
    role: roleEnum('role').notNull().default('rider'),
    avatarUrl: text('avatar_url'),
    emailVerified: boolean('email_verified').notNull().default(false),
    onboarded: boolean('onboarded').notNull().default(false),
    ratingSum: integer('rating_sum').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    safety: jsonb('safety').$type<SafetyPrefs>().notNull().default(DEFAULT_SAFETY),
    simulated: boolean('simulated').notNull().default(false),
    suspended: boolean('suspended').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('otp_email_idx').on(t.email, t.createdAt)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('refresh_hash_uq').on(t.tokenHash), index('refresh_user_idx').on(t.userId)],
);

export const trustedContacts = pgTable(
  'trusted_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    relation: text('relation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contacts_user_idx').on(t.userId)],
);

// ── Places & fleet ───────────────────────────────────────
export const stations = pgTable(
  'stations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: hubTypeEnum('type').notNull(),
    city: text('city').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('stations_code_uq').on(t.code)],
);

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: driverStatusEnum('status').notNull().default('offline'),
    verified: boolean('verified').notNull().default(false),
    licenseNumber: text('license_number').notNull(),
    vehicleNumber: text('vehicle_number').notNull(),
    vehicleModel: text('vehicle_model').notNull(),
    vehicleColor: text('vehicle_color').notNull(),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull().default('sedan'),
    seats: integer('seats').notNull().default(4),
    luggageCapacity: integer('luggage_capacity').notNull().default(4),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    heading: doublePrecision('heading'),
    locationUpdatedAt: timestamp('location_updated_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('drivers_user_uq').on(t.userId),
    uniqueIndex('drivers_vehicle_uq').on(t.vehicleNumber),
    index('drivers_status_idx').on(t.status),
  ],
);

// ── Pooling ──────────────────────────────────────────────
export const rideGroups = pgTable(
  'ride_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    status: groupStatusEnum('status').notNull().default('accepting'),
    driverId: uuid('driver_id').references(() => drivers.id),
    pickupAt: timestamp('pickup_at', { withTimezone: true }).notNull(),
    routeKm: doublePrecision('route_km').notNull().default(0),
    groupFare: doublePrecision('group_fare').notNull().default(0),
    platformSubsidy: doublePrecision('platform_subsidy').notNull().default(0),
    womenOnly: boolean('women_only').notNull().default(false),
    preferFemaleDriver: boolean('prefer_female_driver').notNull().default(false),
    route: jsonb('route').$type<LatLng[]>().notNull().default(sql`'[]'::jsonb`),
    acceptExpiresAt: timestamp('accept_expires_at', { withTimezone: true }),
    dispatchStartedAt: timestamp('dispatch_started_at', { withTimezone: true }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    driverNet: doublePrecision('driver_net'),
    driverBonus: doublePrecision('driver_bonus'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('groups_status_idx').on(t.status, t.stationId),
    index('groups_driver_idx').on(t.driverId, t.status),
  ],
);

export const rideRequests = pgTable(
  'ride_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    groupId: uuid('group_id').references(() => rideGroups.id, { onDelete: 'set null' }),
    status: rideStatusEnum('status').notNull().default('pending'),
    destLat: doublePrecision('dest_lat').notNull(),
    destLng: doublePrecision('dest_lng').notNull(),
    destinationLabel: text('destination_label').notNull(),
    arrivalAt: timestamp('arrival_at', { withTimezone: true }).notNull(),
    toleranceMin: integer('tolerance_min').notNull().default(15),
    seats: integer('seats').notNull().default(1),
    luggage: integer('luggage').notNull().default(1),
    flightOrTrain: text('flight_or_train'),
    womenOnly: boolean('women_only').notNull().default(false),
    preferFemaleDriver: boolean('prefer_female_driver').notNull().default(false),
    soloKm: doublePrecision('solo_km').notNull(),
    soloFare: doublePrecision('solo_fare').notNull(),
    quotedFare: doublePrecision('quoted_fare'),
    acceptedFare: doublePrecision('accepted_fare'),
    finalFare: doublePrecision('final_fare'),
    platformSubsidy: doublePrecision('platform_subsidy').notNull().default(0),
    dropIndex: integer('drop_index'),
    pickupPin: text('pickup_pin').notNull(),
    pinAttempts: integer('pin_attempts').notNull().default(0),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    droppedAt: timestamp('dropped_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    declineCount: integer('decline_count').notNull().default(0),
    /** Groups this rider declined or timed out of — never re-pooled into them. */
    declinedGroupIds: jsonb('declined_group_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('rides_pool_idx').on(t.status, t.stationId, t.arrivalAt),
    index('rides_user_idx').on(t.userId, t.createdAt),
    index('rides_group_idx').on(t.groupId),
  ],
);

export const driverOffers = pgTable(
  'driver_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => rideGroups.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    status: offerStatusEnum('status').notNull().default('pending'),
    distanceToHubKm: doublePrecision('distance_to_hub_km').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('offers_group_driver_uq').on(t.groupId, t.driverId),
    index('offers_status_idx').on(t.status, t.expiresAt),
  ],
);

// ── Live tracking & safety ───────────────────────────────
export const locationPings = pgTable(
  'location_pings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => rideGroups.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    heading: doublePrecision('heading'),
    speedKmh: doublePrecision('speed_kmh'),
    accuracyM: doublePrecision('accuracy_m'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('pings_group_idx').on(t.groupId, t.createdAt)],
);

export const tripShares = pgTable(
  'trip_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shares_token_uq').on(t.token), index('shares_ride_idx').on(t.rideId)],
);

export const sosIncidents = pgTable(
  'sos_incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rideId: uuid('ride_id').references(() => rideRequests.id, { onDelete: 'set null' }),
    groupId: uuid('group_id').references(() => rideGroups.id, { onDelete: 'set null' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    status: sosStatusEnum('status').notNull().default('open'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    message: text('message'),
    note: text('note'),
    handledBy: uuid('handled_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('sos_status_idx').on(t.status, t.createdAt)],
);

export const safetyEvents = pgTable(
  'safety_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: safetyEventEnum('type').notNull(),
    severity: severityEnum('severity').notNull().default('info'),
    groupId: uuid('group_id').references(() => rideGroups.id, { onDelete: 'cascade' }),
    rideId: uuid('ride_id').references(() => rideRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** For check-in prompts: the deadline after which the alert escalates. */
    checkInDeadline: timestamp('check_in_deadline', { withTimezone: true }),
    checkInResolvedAt: timestamp('check_in_resolved_at', { withTimezone: true }),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('safety_group_idx').on(t.groupId, t.createdAt),
    index('safety_checkin_idx').on(t.checkInDeadline),
  ],
);

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rateeId: uuid('ratee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ratings_ride_rater_uq').on(t.rideId, t.raterId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Station = typeof stations.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type RideGroup = typeof rideGroups.$inferSelect;
export type RideRequest = typeof rideRequests.$inferSelect;
export type DriverOffer = typeof driverOffers.$inferSelect;
export type SosIncident = typeof sosIncidents.$inferSelect;
export type SafetyEvent = typeof safetyEvents.$inferSelect;
export type TrustedContact = typeof trustedContacts.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
