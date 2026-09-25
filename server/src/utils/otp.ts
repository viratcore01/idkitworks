import { randomInt, timingSafeEqual } from 'crypto';

/**
 * One source of truth for one-time codes.
 *
 * Two things matter here and both are easy to get quietly wrong:
 *
 * 1. GENERATION uses `crypto.randomInt`, not `Math.random`. V8's PRNG is fast
 *    but not cryptographic: a few observed outputs are enough to reconstruct
 *    its internal state (xorshift128+), which would let an attacker who can
 *    request codes predict the next one. Codes are short-lived and attempt
 *    capped, but the fix costs nothing.
 * 2. COMPARISON is constant-time. `timingSafeEqual` never early-returns on the
 *    first mismatching digit, so response timing can't be used to recover a
 *    code digit by digit.
 */

export const OTP_LENGTH = 6;
export const OTP_PATTERN = /^\d{6}$/;

/** A fresh 6-digit code: 100000–999999 (no leading-zero ambiguity). */
export function generateOtpCode(): string {
  return randomInt(100_000, 1_000_000).toString();
}

/**
 * Constant-time equality. Lengths are compared first because timingSafeEqual
 * throws on mismatched buffer sizes — and an obviously wrong-length guess
 * leaks nothing.
 */
export function codesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
