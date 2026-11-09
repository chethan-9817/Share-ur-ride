import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/** Cryptographically secure numeric code of `digits` length (leading zeros allowed). */
export function numericCode(digits: number): string {
  return Array.from({ length: digits }, () => randomInt(0, 10)).join('');
}

/** OTPs are stored as keyed HMACs so a DB leak doesn't expose live codes. */
export function hashOtp(email: string, code: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(`${email}:${code}`).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
