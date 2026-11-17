import type { Request, Response } from 'express';
import type { Services } from '../../core/container.js';
import { AppError, unauthenticated } from '../../lib/errors.js';
import { invalidatePlatformUser } from '../../middleware/platform-guard.js';
import { auditNow, ipOf } from '../audit/service.js';
import { activateMfa, startMfaSetup, verifySecondFactor } from '../auth/mfa.js';
import {
  assertPasswordIssues,
  checkPasswordRules,
  hashPassword,
  isReused,
  verifyDummy,
  verifyPassword,
} from '../auth/passwords.js';
import {
  createRedisSession,
  revokeAllRedisSessions,
  revokeRedisSession,
  RefreshError,
  rotateRedisSession,
} from '../auth/redis-sessions.js';
import { readSecure, writeSecure, type Principal } from '../auth/secure-store.js';
import {
  accountKey,
  assertCsrf,
  clearSessionCookies,
  consumeChallenge,
  COOKIES,
  ipKey,
  issueAccessToken,
  issueChallenge,
  parseRefreshToken,
  rateLimit,
  readCookie,
  setSessionCookies,
  verifyChallenge,
} from '../auth/tokens.js';

/** Platform password policy (no tenant policy applies). */
export const PLATFORM_PASSWORD_RULES = { minLength: 12, requireClasses: 3 } as const;
export const PLATFORM_PASSWORD_HISTORY = 5;
export const PLATFORM_IDLE_MINUTES = 30;
/** Platform sessions are shorter than tenant ones (12 h). */
const PLATFORM_REFRESH_TTL_S = 12 * 3600;
const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

const principal = (id: string): Principal => ({ kind: 'platform', id });
const failKey = (email: string) => `hm:plat-fail:${accountKey(email)}`;
const lockKey = (email: string) => `hm:plat-lock:${accountKey(email)}`;

const invalidCredentials = () =>
  new AppError('UNAUTHENTICATED', 'Invalid credentials', {
    meta: { reason: 'INVALID_CREDENTIALS' },
  });

async function platformAccess(services: Services, userId: string, sid: string) {
  return issueAccessToken(services, {
    sub: userId,
    sid,
    scope: 'platform',
    mfa: true,
    idle: PLATFORM_IDLE_MINUTES,
  });
}

async function openSession(req: Request, res: Response, userId: string) {
  const { services } = req;
  const { session, token } = await createRedisSession(
    services,
    {
      scope: 'platform',
      subject: userId,
      tenantId: null,
      ip: ipOf(req),
      userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
      mfa: true,
    },
    PLATFORM_REFRESH_TTL_S,
  );
  await services.revocations.markActive(session.id, PLATFORM_IDLE_MINUTES);
  await services.admin.platformUser.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
  const csrfToken = setSessionCookies(res, COOKIES.platform, token, PLATFORM_REFRESH_TTL_S);
  return { ...(await platformAccess(services, userId, session.id)), csrfToken };
}

/**
 * Platform login (SA-40): TOTP is mandatory, so the password step never returns tokens — only an
 * `mfa` challenge (or `mfa_setup` for a first login).
 */
export async function platformLogin(req: Request, body: { email: string; password: string }) {
  const { services } = req;
  await rateLimit(services, [
    { key: `plogin:ip:${ipKey(req)}`, limit: 20, windowS: 60 },
    { key: `plogin:acct:${accountKey(body.email)}`, limit: 10, windowS: 60 },
  ]);
  const lockedTtl = await services.redis.ttl(lockKey(body.email));
  if (lockedTtl > 0)
    throw new AppError('ACCOUNT_LOCKED', undefined, {
      detail: 'Too many failed attempts',
      meta: { lockedUntil: new Date(Date.now() + lockedTtl * 1000).toISOString() },
    });
  const user = await services.admin.platformUser.findUnique({ where: { email: body.email } });
  const ok = user ? await verifyPassword(user.passwordHash, body.password) : false;
  if (!user) await verifyDummy(body.password);
  if (!user || !ok || !user.isActive) {
    if (user && !ok) {
      const n = await services.redis.incr(failKey(body.email));
      await services.redis.expire(failKey(body.email), LOCK_MINUTES * 60);
      if (n >= LOCK_THRESHOLD) {
        await services.redis.set(lockKey(body.email), '1', 'EX', LOCK_MINUTES * 60);
        await services.redis.del(failKey(body.email));
      }
    }
    await auditNow(req, {
      action: 'platform.auth.login_failed',
      entity: 'platform_user',
      entityId: user?.id ?? null,
      userId: user?.id ?? null,
    });
    throw invalidCredentials();
  }
  await services.redis.del(failKey(body.email));
  const purpose = user.totpSecretEnc ? 'mfa' : 'mfa_setup';
  const challengeToken = await issueChallenge(services, {
    sub: user.id,
    scope: 'platform',
    purpose,
  });
  return purpose === 'mfa'
    ? { mfaRequired: true, challengeToken, methods: ['totp', 'backup_code'] as const }
    : { mfaSetupRequired: true, challengeToken };
}

async function activePlatformUser(services: Services, id: string) {
  const user = await services.admin.platformUser.findUnique({ where: { id } });
  if (!user?.isActive) throw unauthenticated('Platform user not found or inactive');
  return user;
}

export async function platformMfaVerify(
  req: Request,
  res: Response,
  body: { challengeToken: string; code: string },
) {
  const { services } = req;
  await rateLimit(services, [{ key: `pmfa:ip:${ipKey(req)}`, limit: 30, windowS: 60 }]);
  const claims = await verifyChallenge(services, body.challengeToken, {
    scope: 'platform',
    purposes: ['mfa'],
  });
  const user = await activePlatformUser(services, claims.sub);
  if (!user.totpSecretEnc) throw unauthenticated('MFA is not enabled');
  let method: string;
  try {
    method = await verifySecondFactor(services, principal(user.id), user.totpSecretEnc, body.code);
  } catch (err) {
    await auditNow(req, {
      action: 'platform.auth.mfa_failed',
      entity: 'platform_user',
      entityId: user.id,
      userId: user.id,
    });
    throw err;
  }
  await consumeChallenge(services, claims);
  const session = await openSession(req, res, user.id);
  await auditNow(req, {
    action: 'platform.auth.login',
    entity: 'platform_user',
    entityId: user.id,
    userId: user.id,
    after: { method },
  });
  return session;
}

export async function platformMfaSetup(
  req: Request,
  body: { challengeToken?: string | undefined },
) {
  const { services } = req;
  if (!body.challengeToken) throw unauthenticated('An mfa_setup challenge is required');
  const claims = await verifyChallenge(services, body.challengeToken, {
    scope: 'platform',
    purposes: ['mfa_setup'],
  });
  const user = await activePlatformUser(services, claims.sub);
  if (user.totpSecretEnc)
    throw new AppError('CONFLICT', 'MFA is already enabled', { meta: { reason: 'MFA_ENABLED' } });
  return startMfaSetup(services, principal(user.id), {
    account: user.email,
    issuer: 'Hotel Management Admin',
  });
}

export async function platformMfaActivate(
  req: Request,
  res: Response,
  body: { code: string; challengeToken?: string | undefined },
) {
  const { services } = req;
  if (!body.challengeToken) throw unauthenticated('An mfa_setup challenge is required');
  const claims = await verifyChallenge(services, body.challengeToken, {
    scope: 'platform',
    purposes: ['mfa_setup'],
  });
  const user = await activePlatformUser(services, claims.sub);
  if (user.totpSecretEnc)
    throw new AppError('CONFLICT', 'MFA is already enabled', { meta: { reason: 'MFA_ENABLED' } });
  const { secretEnc, backupCodes } = await activateMfa(services, principal(user.id), body.code);
  await services.admin.platformUser.update({
    where: { id: user.id },
    data: { totpSecretEnc: secretEnc },
  });
  await consumeChallenge(services, claims);
  await auditNow(req, {
    action: 'platform.auth.mfa_enabled',
    entity: 'platform_user',
    entityId: user.id,
    userId: user.id,
  });
  const session = await openSession(req, res, user.id);
  return { ...session, backupCodes };
}

export async function platformRefresh(req: Request, res: Response) {
  const { services } = req;
  await rateLimit(services, [{ key: `prefresh:ip:${ipKey(req)}`, limit: 120, windowS: 60 }]);
  assertCsrf(req);
  try {
    const rotated = await rotateRedisSession(
      services,
      'platform',
      readCookie(req, COOKIES.platform.name),
      null,
      (s) =>
        auditNow(req, {
          action: 'platform.auth.refresh_reuse_detected',
          entity: 'session',
          entityId: s.id,
          userId: s.subject,
        }),
    );
    if (!(await services.revocations.isActive(rotated.session.id))) {
      await revokeRedisSession(services, 'platform', rotated.session.id);
      throw new RefreshError('SESSION_IDLE');
    }
    await activePlatformUser(services, rotated.session.subject);
    await services.revocations.markActive(rotated.session.id, PLATFORM_IDLE_MINUTES);
    const csrfToken = setSessionCookies(res, COOKIES.platform, rotated.token, rotated.remainingS);
    return {
      ...(await platformAccess(services, rotated.session.subject, rotated.session.id)),
      csrfToken,
    };
  } catch (err) {
    clearSessionCookies(res, COOKIES.platform);
    throw err;
  }
}

export async function platformLogout(req: Request, res: Response) {
  const { services } = req;
  let sid = req.auth?.scope === 'platform' ? req.auth.sessionId : undefined;
  if (!sid) {
    const parsed = parseRefreshToken(readCookie(req, COOKIES.platform.name));
    if (parsed) {
      assertCsrf(req);
      sid = parsed.sessionId;
    }
  }
  clearSessionCookies(res, COOKIES.platform);
  if (!sid) return;
  await revokeRedisSession(services, 'platform', sid);
  await auditNow(req, { action: 'platform.auth.logout', entity: 'session', entityId: sid });
}

export async function platformMe(req: Request) {
  const user = await activePlatformUser(req.services, req.auth!.userId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mfaEnabled: !!user.totpSecretEnc,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

/** Validates a platform password (fixed policy + 5-entry history) and returns its hash. */
export async function platformPasswordHash(
  services: Services,
  user: { id: string; email: string; passwordHash: string | null } | null,
  password: string,
): Promise<string> {
  const issues = checkPasswordRules(password, PLATFORM_PASSWORD_RULES, {
    email: user?.email,
  });
  if (user && !issues.length) {
    const history = await readSecure(services, principal(user.id), 'password_history');
    const previous = [...(user.passwordHash ? [user.passwordHash] : []), ...history].slice(
      0,
      PLATFORM_PASSWORD_HISTORY,
    );
    if (await isReused(password, previous)) issues.push('PASSWORD_REUSED');
  }
  assertPasswordIssues(issues);
  if (user?.passwordHash) {
    const history = await readSecure(services, principal(user.id), 'password_history');
    await writeSecure(
      services,
      principal(user.id),
      'password_history',
      [user.passwordHash, ...history].slice(0, PLATFORM_PASSWORD_HISTORY),
    );
  }
  return hashPassword(password);
}

export async function platformChangePassword(
  req: Request,
  body: { currentPassword: string; newPassword: string },
) {
  const { services } = req;
  const user = await activePlatformUser(services, req.auth!.userId);
  await rateLimit(services, [{ key: `pconfirm:${user.id}`, limit: 10, windowS: 15 * 60 }]);
  if (!(await verifyPassword(user.passwordHash, body.currentPassword)))
    throw new AppError('VALIDATION_ERROR', 'Invalid password', {
      errors: [{ path: 'currentPassword', message: 'Invalid password', code: 'INVALID_PASSWORD' }],
    });
  const passwordHash = await platformPasswordHash(services, user, body.newPassword);
  await services.admin.platformUser.update({ where: { id: user.id }, data: { passwordHash } });
  await revokeAllRedisSessions(services, 'platform', null, user.id, req.auth!.sessionId);
  await invalidatePlatformUser(services, user.id);
  await auditNow(req, {
    action: 'platform.auth.password_changed',
    entity: 'platform_user',
    entityId: user.id,
  });
}
