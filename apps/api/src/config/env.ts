import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().default('pglite://.pglite/arriveshare'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().default(30),
  OTP_TTL_MIN: z.coerce.number().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  BASE_FARE: z.coerce.number().nonnegative().default(50),
  RATE_PER_KM: z.coerce.number().positive().default(12),
  MIN_FARE: z.coerce.number().nonnegative().default(80),
  FULL_CAB_BONUS_PCT: z.coerce.number().min(0).max(1).default(0.1),
  COMMISSION_PCT: z.coerce.number().min(0).max(1).default(0.15),

  MAX_DETOUR_PCT: z.coerce.number().min(0).max(1).default(0.3),
  MAX_DETOUR_KM: z.coerce.number().positive().default(6),
  CAB_CAPACITY: z.coerce.number().int().min(2).max(6).default(4),
  LUGGAGE_CAPACITY: z.coerce.number().int().min(1).max(8).default(4),
  MATCH_HORIZON_MIN: z.coerce.number().positive().default(180),
  ACCEPT_WINDOW_SEC: z.coerce.number().int().positive().default(120),
  OFFER_TIMEOUT_SEC: z.coerce.number().int().positive().default(30),
  FEMALE_DRIVER_PRIORITY_SEC: z.coerce.number().int().nonnegative().default(120),
  NO_SHOW_WAIT_MIN: z.coerce.number().nonnegative().default(5),
  SCHEDULER_INTERVAL_SEC: z.coerce.number().positive().default(10),

  CHECK_IN_TIMEOUT_SEC: z.coerce.number().int().positive().default(120),
  SHARE_LINK_TTL_HOURS: z.coerce.number().positive().default(12),

  OSRM_ENABLED: bool.default('true'),
  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  NOMINATIM_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('ArriveShare <no-reply@arriveshare.app>'),

  DEMO_MODE: bool.default('false'),
  SIMULATOR_ENABLED: bool.default('false'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('change-me')) {
    throw new Error('Refusing to start in production with the example JWT_SECRET');
  }
  return env;
}

export const env = load();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export const fareParams = {
  baseFare: env.BASE_FARE,
  perKm: env.RATE_PER_KM,
  minFare: env.MIN_FARE,
  fullCabBonusPct: env.FULL_CAB_BONUS_PCT,
  commissionPct: env.COMMISSION_PCT,
};

export const detourLimits = { maxDetourPct: env.MAX_DETOUR_PCT, maxDetourKm: env.MAX_DETOUR_KM };
