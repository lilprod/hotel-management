import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Shared constants and helpers for the seeds. Every seeded row gets a deterministic id derived
 * from its natural key (see seedId) and is written with upsert / skipDuplicates, so running the
 * seeds twice leaves the database unchanged.
 */

export const SEED_COUNTRY = 'TG';
export const SEED_CURRENCY = 'XOF';
export const SEED_TIMEZONE = 'Africa/Lome';
/** Fictional base domain for demo tenant subdomains (RFC 2606 reserved TLD). */
export const SEED_BASE_DOMAIN = 'hm.test';
/** Fixed reference date so that seeded dates do not drift between runs. */
export const SEED_REFERENCE_DATE = new Date('2026-11-12T00:00:00Z');

export type Logger = (message: string) => void;
export const silentLog: Logger = () => {
  /* no output */
};

/**
 * Deterministic UUID (name-based, version-5 layout) derived from a natural key. Stable across
 * runs and environments, so rows can be upserted by id.
 */
export function seedId(key: string): string {
  const digest = createHash('sha1').update(`hm-seed/v1:${key}`).digest();
  const bytes = [...digest.subarray(0, 16)];
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Applies a discount expressed in basis points (500 = 5 %) to an integer amount. XOF has no
 * decimals, so the result must be exact: a non-integer result is a configuration error.
 */
export function applyDiscountBp(amount: bigint, discountBp: number): bigint {
  const gross = amount * (10_000n - BigInt(discountBp));
  if (gross % 10_000n !== 0n) {
    throw new Error(`Non-integer XOF amount for ${amount} with ${discountBp} bp discount`);
  }
  return gross / 10_000n;
}

/** Returns the stored hash if it still matches `password`, otherwise a fresh argon2id hash. */
export async function ensurePasswordHash(
  stored: string | null | undefined,
  password: string,
): Promise<string> {
  if (stored) {
    const matches = await verify(stored, password).catch(() => false);
    if (matches) return stored;
  }
  return hash(password);
}
