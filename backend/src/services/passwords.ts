/**
 * PIN & recovery-code hashing helpers.
 *
 * Staff PINs are stored as salted SHA-256 hashes (per-staff random salt).
 * The legacy plaintext `pin` column is kept only for pre-hash installs and is
 * migrated to the hashed form on first successful login. Recovery codes are
 * stored as SHA-256 digests, never in plaintext.
 */
import * as crypto from 'crypto';

const RECOVERY_PREFIX = 'kitchen-pos-recovery:v1:';
const PIN_PREFIX = 'kitchen-pos-pin:v1:';

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPin(pin: string, salt: string): string {
  return crypto.createHash('sha256').update(`${PIN_PREFIX}${salt}:${pin}`).digest('hex');
}

export function verifyPin(pin: string, salt: string, expectedHash: string): boolean {
  const candidate = Buffer.from(hashPin(pin, salt), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/** Strong random recovery code (12 chars from a 62-char alphabet ≈ 71 bits). */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (const b of bytes) {
    code += alphabet[b % alphabet.length];
  }
  return code.slice(0, 12);
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(`${RECOVERY_PREFIX}${code.trim().toUpperCase()}`).digest('hex');
}

export function verifyRecoveryCode(code: string, expectedHash: string): boolean {
  const candidate = Buffer.from(hashRecoveryCode(code), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
