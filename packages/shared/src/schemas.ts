import { z } from 'zod';
import { GENDERS, RATING_TAGS, TOLERANCE_OPTIONS, VEHICLE_TYPES } from './constants';

/** Request validation schemas shared by the API (server-side) and forms (client-side). */

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Indian mobile numbers, with or without +91. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const requestOtpSchema = z.object({ email: emailSchema });

export const verifyOtpSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  phone: phoneSchema.optional(),
  gender: z.enum(GENDERS).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  safety: z
    .object({
      autoShareTrips: z.boolean().optional(),
      nightCheckIns: z.boolean().optional(),
      womenOnlyDefault: z.boolean().optional(),
      preferFemaleDriver: z.boolean().optional(),
    })
    .optional(),
});

export const trustedContactSchema = z.object({
  name: z.string().trim().min(2).max(60),
  phone: phoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  relation: z.string().trim().max(30).optional(),
});

export const quoteSchema = z.object({
  stationId: z.string().min(1),
  destination: latLngSchema,
});

export const createRideSchema = z
  .object({
    stationId: z.string().min(1),
    destination: latLngSchema,
    destinationLabel: z.string().trim().min(2).max(200),
    arrivalAt: z.coerce.date(),
    toleranceMin: z.coerce
      .number()
      .int()
      .refine((v) => (TOLERANCE_OPTIONS as readonly number[]).includes(v), 'Unsupported tolerance'),
    seats: z.coerce.number().int().min(1).max(2).default(1),
    luggage: z.coerce.number().int().min(0).max(3).default(1),
    flightOrTrain: z.string().trim().max(20).optional(),
    womenOnly: z.boolean().default(false),
    preferFemaleDriver: z.boolean().default(false),
  })
  .refine((v) => v.arrivalAt.getTime() > Date.now() - 60 * 60_000, {
    message: 'Arrival time cannot be more than an hour in the past',
    path: ['arrivalAt'],
  })
  .refine((v) => v.arrivalAt.getTime() < Date.now() + 7 * 24 * 60 * 60_000, {
    message: 'Arrival time must be within the next 7 days',
    path: ['arrivalAt'],
  });

export const updateRideSchema = z.object({
  arrivalAt: z.coerce.date().optional(),
  toleranceMin: z.coerce.number().int().optional(),
  flightOrTrain: z.string().trim().max(20).optional(),
  luggage: z.coerce.number().int().min(0).max(3).optional(),
});

export const driverOnboardSchema = z.object({
  vehicleNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{4}$/, 'Invalid registration number'),
  vehicleModel: z.string().trim().min(2).max(60),
  vehicleColor: z.string().trim().min(2).max(30),
  vehicleType: z.enum(VEHICLE_TYPES).default('sedan'),
  seats: z.coerce.number().int().min(3).max(6).default(4),
  licenseNumber: z.string().trim().min(6).max(20),
});

export const locationPingSchema = latLngSchema.extend({
  heading: z.number().min(0).max(360).nullable().optional(),
  speedKmh: z.number().min(0).max(300).nullable().optional(),
  accuracyM: z.number().min(0).max(10_000).nullable().optional(),
});

export const verifyPinSchema = z.object({
  rideId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/),
});

export const raiseSosSchema = z.object({
  rideId: z.string().optional(),
  location: latLngSchema.optional(),
  message: z.string().trim().max(500).optional(),
});

export const resolveSosSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'false_alarm']),
  note: z.string().trim().max(500).optional(),
});

export const checkInSchema = z.object({
  rideId: z.string().min(1),
  safe: z.boolean(),
});

export const ratingSchema = z.object({
  rideId: z.string().min(1),
  score: z.number().int().min(1).max(5),
  tags: z.array(z.enum(RATING_TAGS)).max(5).default([]),
  comment: z.string().trim().max(500).optional(),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type TrustedContactInput = z.infer<typeof trustedContactSchema>;
export type CreateRideInput = z.infer<typeof createRideSchema>;
export type UpdateRideInput = z.infer<typeof updateRideSchema>;
export type DriverOnboardInput = z.infer<typeof driverOnboardSchema>;
export type LocationPingInput = z.infer<typeof locationPingSchema>;
export type RaiseSosInput = z.infer<typeof raiseSosSchema>;
export type RatingInput = z.infer<typeof ratingSchema>;
