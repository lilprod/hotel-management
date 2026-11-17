import type { Services } from '../../core/container.js';
import { AppError } from '../../lib/errors.js';
import { readSecure, writeSecure, type Principal } from './secure-store.js';
import {
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  looksLikeBackupCode,
  otpauthUri,
  verifyTotp,
} from './totp.js';

const PENDING_TTL_S = 10 * 60;
const pendingKey = (p: Principal) => `hm:mfa-pending:${p.kind}:${p.id}`;
const lastStepKey = (p: Principal) => `hm:totp-last:${p.kind}:${p.id}`;

export const MFA_ISSUER = 'Hotel Management';

/** Step 1: a new secret kept pending (10 min) until a first code proves the enrolment. */
export async function startMfaSetup(
  services: Services,
  p: Principal,
  opts: { account: string; issuer?: string },
) {
  const secret = generateTotpSecret();
  await services.redis.set(
    pendingKey(p),
    encryptSecret(secret, services.config.JWT_ACCESS_SECRET),
    'EX',
    PENDING_TTL_S,
  );
  const issuer = opts.issuer ?? MFA_ISSUER;
  return {
    secret,
    otpauthUri: otpauthUri({ issuer, account: opts.account, secret }),
    expiresInSeconds: PENDING_TTL_S,
  };
}

/**
 * Step 2: verifies the first code against the pending secret, stores 10 hashed backup codes and
 * returns the encrypted secret (saved by the caller on the principal row) + the plain codes
 * (shown once).
 */
export async function activateMfa(services: Services, p: Principal, code: string) {
  const pending = await services.redis.get(pendingKey(p));
  if (!pending)
    throw new AppError('PRECONDITION_FAILED', 'No MFA enrolment in progress', {
      meta: { reason: 'MFA_SETUP_NOT_STARTED' },
    });
  const secret = decryptSecret(pending, services.config.JWT_ACCESS_SECRET);
  const step = verifyTotp(secret, code.trim());
  if (step === null) throw invalidCode();
  await services.redis.set(lastStepKey(p), String(step), 'EX', 120);
  await services.redis.del(pendingKey(p));
  const backupCodes = generateBackupCodes();
  await writeSecure(services, p, 'mfa_backup_codes', backupCodes.map(hashBackupCode));
  return { secretEnc: encryptSecret(secret, services.config.JWT_ACCESS_SECRET), backupCodes };
}

export async function regenerateBackupCodes(services: Services, p: Principal): Promise<string[]> {
  const codes = generateBackupCodes();
  await writeSecure(services, p, 'mfa_backup_codes', codes.map(hashBackupCode));
  return codes;
}

export async function clearMfa(services: Services, p: Principal): Promise<void> {
  await writeSecure(services, p, 'mfa_backup_codes', []);
  await services.redis.del(pendingKey(p), lastStepKey(p));
}

export const invalidCode = () =>
  new AppError('UNAUTHENTICATED', 'Invalid verification code', {
    meta: { reason: 'MFA_CODE_INVALID' },
  });

/**
 * Checks a TOTP code (window ±1, no replay of a used step) or a single-use backup code.
 * Returns the method used, or throws.
 */
export async function verifySecondFactor(
  services: Services,
  p: Principal,
  secretEnc: string,
  code: string,
): Promise<'totp' | 'backup_code'> {
  const raw = code.trim();
  if (/^\d{6}$/.test(raw)) {
    const secret = decryptSecret(secretEnc, services.config.JWT_ACCESS_SECRET);
    const step = verifyTotp(secret, raw);
    if (step === null) throw invalidCode();
    const last = Number((await services.redis.get(lastStepKey(p))) ?? -1);
    if (step <= last) throw invalidCode();
    await services.redis.set(lastStepKey(p), String(step), 'EX', 120);
    return 'totp';
  }
  if (looksLikeBackupCode(raw)) {
    const hashes = await readSecure(services, p, 'mfa_backup_codes');
    const h = hashBackupCode(raw);
    if (!hashes.includes(h)) throw invalidCode();
    await writeSecure(
      services,
      p,
      'mfa_backup_codes',
      hashes.filter((x) => x !== h),
    );
    return 'backup_code';
  }
  throw invalidCode();
}

export async function remainingBackupCodes(services: Services, p: Principal): Promise<number> {
  return (await readSecure(services, p, 'mfa_backup_codes')).length;
}
