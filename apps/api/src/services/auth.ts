import { nameFromEmail } from '@arriveshare/shared';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { env } from '../config/env';
import { db } from '../db/client';
import { otpCodes, refreshTokens, users, type User } from '../db/schema';
import { hashOtp, numericCode, opaqueToken, safeEqual, sha256 } from '../lib/crypto';
import { AppError, badRequest, forbidden, unauthorized } from '../lib/errors';
import { addMs, DAY, HOUR, MINUTE } from '../lib/time';
import { sendMail, templates } from './mailer';

/**
 * Passwordless email OTP.
 *  • codes are HMAC-hashed at rest, single-use, expire in OTP_TTL_MIN
 *  • max OTP_MAX_ATTEMPTS guesses per code, max 5 codes per email per hour
 *  • refresh tokens are opaque, stored as SHA-256, and rotated on every use
 *    (reuse of a rotated token revokes the whole family → stolen-cookie defence)
 */

const MAX_CODES_PER_HOUR = 5;
/** Window in which a just-rotated refresh token is still accepted (multi-tab, retries). */
const ROTATION_GRACE_MS = 30_000;

export async function requestOtp(email: string) {
  const [{ recent } = { recent: 0 }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), gte(otpCodes.createdAt, addMs(new Date(), -HOUR))));
  if (recent >= MAX_CODES_PER_HOUR) {
    throw new AppError(429, 'OTP_LIMIT', 'Too many codes requested. Try again in a little while.');
  }

  const code = numericCode(6);
  await db.insert(otpCodes).values({
    email,
    codeHash: hashOtp(email, code),
    expiresAt: addMs(new Date(), env.OTP_TTL_MIN * MINUTE),
  });
  const { delivered } = await sendMail({ to: email, ...templates.otp(code) });
  // In demo mode without SMTP we hand the code back so the flow is testable end-to-end.
  return { delivered, devCode: !delivered && env.DEMO_MODE ? code : undefined };
}

export async function verifyOtp(email: string, code: string): Promise<User> {
  const [otp] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (!otp || otp.expiresAt < new Date()) throw badRequest('OTP_EXPIRED', 'This code has expired — request a new one');
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw badRequest('OTP_LOCKED', 'Too many wrong attempts — request a new code');

  if (!safeEqual(otp.codeHash, hashOtp(email, code))) {
    await db.update(otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
    throw badRequest('OTP_INVALID', 'Incorrect code', {
      attemptsLeft: Math.max(0, env.OTP_MAX_ATTEMPTS - otp.attempts - 1),
    });
  }
  await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, otp.id));
  return upsertUser(email);
}

export async function upsertUser(email: string): Promise<User> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    if (existing.suspended) throw forbidden('This account is suspended. Contact support.');
    if (!existing.emailVerified) {
      const [u] = await db.update(users).set({ emailVerified: true }).where(eq(users.id, existing.id)).returning();
      return u!;
    }
    return existing;
  }
  const [created] = await db
    .insert(users)
    .values({ email, name: nameFromEmail(email), emailVerified: true })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.select().from(users).where(eq(users.email, email)))[0]!;
}

export async function createRefreshToken(userId: string, userAgent?: string) {
  const token = opaqueToken(48);
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(token),
    userAgent: userAgent?.slice(0, 200),
    expiresAt: addMs(new Date(), env.REFRESH_TOKEN_TTL_DAYS * DAY),
  });
  return token;
}

export async function rotateRefreshToken(token: string, userAgent?: string) {
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token)));
  if (!row) throw unauthorized('Session not found');
  if (row.revokedAt) {
    // Two tabs (or a flaky network retry) can present the same token within moments of
    // each other. Allow that briefly; anything later is treated as a stolen token.
    const justRotated =
      row.rotatedAt != null &&
      row.revokedAt.getTime() === row.rotatedAt.getTime() &&
      Date.now() - row.rotatedAt.getTime() < ROTATION_GRACE_MS;
    if (!justRotated) {
      // A rotated token came back → assume theft and kill every session for this user.
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, row.userId));
      throw unauthorized('Session was revoked — please sign in again');
    }
  }
  if (row.expiresAt < new Date()) throw unauthorized('Session expired');
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user || user.suspended) throw unauthorized('Account unavailable');
  if (!row.revokedAt) {
    const now = new Date();
    await db.update(refreshTokens).set({ revokedAt: now, rotatedAt: now }).where(eq(refreshTokens.id, row.id));
  }
  const next = await createRefreshToken(user.id, userAgent);
  return { user, refreshToken: next };
}

export async function revokeRefreshToken(token: string) {
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(token)));
}

export const DEMO_ACCOUNTS = {
  rider: 'priya.demo@arriveshare.app',
  rider2: 'arjun.demo@arriveshare.app',
  driver: 'ravi.driver@arriveshare.app',
  admin: 'ops@arriveshare.app',
} as const;
export type DemoAccount = keyof typeof DEMO_ACCOUNTS;
