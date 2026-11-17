import { hash, verify } from '@node-rs/argon2';
import { AppError } from '../../lib/errors.js';

/** argon2id (library default algorithm) with OWASP 2024 parameters: m=19 MiB, t=2, p=1. */
const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(hashed: string | null | undefined, password: string) {
  if (!hashed) return false;
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Burns the same time as a real verification (unknown account: no user enumeration by timing). */
export async function verifyDummy(password: string): Promise<void> {
  dummy ??= hashPassword('dummy-password-for-timing-equalization');
  await verifyPassword(await dummy, password);
}

export interface PasswordRules {
  minLength: number;
  /** Number of character classes required among lower, upper, digit, symbol. */
  requireClasses: number;
}

/**
 * Excerpt of the most common leaked passwords (doc 05 §1 asks for a top-100k check: the full
 * list is to be provided as a data file, see the mission report). Compared case-insensitively.
 */
const COMMON_PASSWORDS = new Set([
  '123456',
  '123456789',
  '12345678',
  '1234567890',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword1',
  'qwerty',
  'qwerty123',
  'azerty',
  'azerty123',
  'azertyuiop',
  'motdepasse',
  'motdepasse1',
  'abc123',
  'abcd1234',
  'iloveyou',
  'admin',
  'admin123',
  'administrator',
  'welcome',
  'welcome1',
  'welcome123',
  'letmein',
  'football',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  '111111',
  '000000',
  'changeme',
  'bonjour',
  'bonjour123',
  'soleil',
  'hotel123',
  'hotel2024',
  'hotel2025',
  'hotel2026',
  'password2024',
  'password2025',
  'password2026',
]);

export function passwordClasses(pw: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
}

export interface PasswordContext {
  email?: string | undefined;
  name?: string | undefined;
}

/** Returns the list of violated rules (empty = valid). */
export function checkPasswordRules(
  password: string,
  rules: PasswordRules,
  ctx: PasswordContext = {},
): string[] {
  const issues: string[] = [];
  if (password.length < rules.minLength) issues.push('PASSWORD_TOO_SHORT');
  if (password.length > 256) issues.push('PASSWORD_TOO_LONG');
  if (passwordClasses(password) < Math.min(rules.requireClasses, 4))
    issues.push('PASSWORD_CLASSES');
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) issues.push('PASSWORD_COMMON');
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) issues.push('PASSWORD_CONTAINS_EMAIL');
  return issues;
}

const MESSAGES: Record<string, string> = {
  PASSWORD_TOO_SHORT: 'Password is too short',
  PASSWORD_TOO_LONG: 'Password is too long',
  PASSWORD_CLASSES: 'Password does not mix enough character classes',
  PASSWORD_COMMON: 'Password is too common',
  PASSWORD_CONTAINS_EMAIL: 'Password must not contain your e-mail',
  PASSWORD_REUSED: 'Password was used recently',
};

/** Throws VALIDATION_ERROR listing the violated rules (path `newPassword`). */
export function assertPasswordIssues(issues: string[], field = 'newPassword'): void {
  if (!issues.length) return;
  throw new AppError('VALIDATION_ERROR', 'Password does not meet the security policy', {
    errors: issues.map((code) => ({ path: field, code, message: MESSAGES[code] ?? code })),
    meta: { rules: issues },
  });
}

/** True when `password` matches one of the previous hashes. */
export async function isReused(password: string, hashes: readonly string[]): Promise<boolean> {
  for (const h of hashes) if (await verifyPassword(h, password)) return true;
  return false;
}
