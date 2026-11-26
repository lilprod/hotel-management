import { randomUUID } from 'node:crypto';
import { runWithTenant } from '@hm/database';
import type { Request, Response } from 'express';
import type { Services } from '../../core/container.js';
import type { EffectivePolicy } from '../../core/security-policy.js';
import { loadGrants } from '../../http/helpers.js';
import { AppError, unauthenticated } from '../../lib/errors.js';
import { auditNow, ipOf } from '../audit/service.js';
import { legalStatus } from '../legal/service.js';
import { sendAuthMessage } from './mailer.js';
import {
  activateMfa,
  clearMfa,
  regenerateBackupCodes,
  startMfaSetup,
  verifySecondFactor,
} from './mfa.js';
import {
  assertPasswordIssues,
  checkPasswordRules,
  hashPassword,
  isReused,
  verifyDummy,
  verifyPassword,
} from './passwords.js';
import { passwordHistory, pushPasswordHistory, type Principal } from './secure-store.js';
import {
  accountKey,
  assertCsrf,
  clearSessionCookies,
  consumeChallenge,
  COOKIES,
  ipKey,
  issueAccessToken,
  issueChallenge,
  newRefreshToken,
  parseRefreshToken,
  randomToken,
  rateLimit,
  readCookie,
  REFRESH_TTL_S,
  safeEqual,
  setSessionCookies,
  sha256,
  verifyChallenge,
} from './tokens.js';

export const RESET_TTL_S = 30 * 60;
export const INVITE_TTL_S = 7 * 24 * 3600;
const MAX_LOCK_MINUTES = 24 * 60;

const staffPrincipal = (tenantId: string, id: string): Principal => ({
  kind: 'staff',
  id,
  tenantId,
});
const metaKey = (sid: string) => `hm:sess-meta:${sid}`;
const resetKey = (tenantId: string, hash: string) => `hm:pwreset:staff:${tenantId}:${hash}`;
const resetUserKey = (userId: string) => `hm:pwreset-user:staff:${userId}`;
export const inviteKey = (tenantId: string, hash: string) => `hm:invite:${tenantId}:${hash}`;
export const inviteUserKey = (userId: string) => `hm:invite-user:${userId}`;

const invalidCredentials = () =>
  new AppError('UNAUTHENTICATED', 'Invalid credentials', {
    meta: { reason: 'INVALID_CREDENTIALS' },
  });

function tenantOf(req: Request) {
  if (!req.tenant) throw new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });
  return req.tenant;
}

const inTenant = <T>(req: Request, fn: () => Promise<T>) => runWithTenant(tenantOf(req).id, fn);

// ---------------------------------------------------------------------------
// Policy helpers
// ---------------------------------------------------------------------------

export function mfaRequiredFor(policy: EffectivePolicy, roleIds: readonly string[]): boolean {
  if (policy.mfaMode === 'REQUIRED_ALL') return true;
  if (policy.mfaMode === 'REQUIRED_FOR_ROLES')
    return roleIds.some((r) => policy.mfaRoles.includes(r));
  return false;
}

export function passwordExpired(
  policy: EffectivePolicy,
  user: { passwordChangedAt: Date | null; createdAt: Date },
  now = new Date(),
): boolean {
  if (!policy.pwdExpiryDays) return false;
  const since = user.passwordChangedAt ?? user.createdAt;
  return now.getTime() - since.getTime() > policy.pwdExpiryDays * 86_400_000;
}

/**
 * Validates a new password against the tenant policy (length, classes, common list, history of
 * the last N hashes + current one), then stores it (argon2id) and updates the history.
 */
export async function setStaffPassword(
  services: Services,
  tenantId: string,
  user: { id: string; email: string; name: string; passwordHash: string | null },
  newPassword: string,
  extra: { status?: 'ACTIVE'; name?: string } = {},
): Promise<void> {
  const policy = await services.securityPolicies.get(tenantId);
  const issues = checkPasswordRules(
    newPassword,
    { minLength: policy.pwdMinLength, requireClasses: policy.pwdRequireClasses },
    { email: user.email, name: user.name },
  );
  const p = staffPrincipal(tenantId, user.id);
  const history = await passwordHistory(services, p);
  const previous = [...(user.passwordHash ? [user.passwordHash] : []), ...history].slice(
    0,
    Math.max(policy.pwdHistory, user.passwordHash ? 1 : 0),
  );
  if (!issues.length && (await isReused(newPassword, previous))) issues.push('PASSWORD_REUSED');
  assertPasswordIssues(issues);
  const passwordHash = await hashPassword(newPassword);
  await runWithTenant(tenantId, () =>
    services.db.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedAttempts: 0,
        lockedUntil: null,
        ...(extra.status ? { status: extra.status } : {}),
        ...(extra.name ? { name: extra.name } : {}),
      },
    }),
  );
  if (policy.pwdHistory > 0)
    await pushPasswordHistory(services, p, user.passwordHash, Math.min(policy.pwdHistory, 24));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionMeta {
  mfa: boolean;
}

async function staffAccess(
  services: Services,
  c: {
    userId: string;
    tenantId: string;
    sid: string;
    mfa: boolean;
    mcp: boolean;
    idle: number;
  },
) {
  const permVer = await services.permVersions.current(c.tenantId);
  return issueAccessToken(services, {
    sub: c.userId,
    tid: c.tenantId,
    sid: c.sid,
    scope: 'staff',
    perm_ver: permVer,
    mfa: c.mfa,
    mcp: c.mcp,
    idle: c.idle,
  });
}

/** Active (not revoked, not expired) staff sessions of a user, oldest first. */
export function activeSessions(services: Services, userId: string) {
  return services.db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
  });
}

/** Revokes sessions in DB and in the Redis denylist (access tokens die at once). */
export async function revokeStaffSessions(
  services: Services,
  tenantId: string,
  where: { userId: string; exceptId?: string } | { ids: string[] },
): Promise<string[]> {
  return runWithTenant(tenantId, async () => {
    const rows = await services.db.session.findMany({
      where: {
        revokedAt: null,
        ...('ids' in where
          ? { id: { in: where.ids } }
          : { userId: where.userId, ...(where.exceptId ? { id: { not: where.exceptId } } : {}) }),
      },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (!ids.length) return ids;
    await services.db.session.updateMany({
      where: { id: { in: ids } },
      data: { revokedAt: new Date() },
    });
    await services.revocations.revokeMany(ids, 30 * 60);
    return ids;
  });
}

async function openStaffSession(
  req: Request,
  res: Response,
  user: { id: string; mustChangePassword: boolean },
  opts: { mfa: boolean },
) {
  const { services } = req;
  const tenantId = tenantOf(req).id;
  const policy = await services.securityPolicies.get(tenantId);
  const sid = randomUUID();
  const { token, hash } = newRefreshToken(sid);
  const now = new Date();
  await inTenant(req, async () => {
    if (policy.maxSessions) {
      const active = (await activeSessions(services, user.id)).filter(
        (s) => s.kind !== 'IMPERSONATION',
      );
      const excess = active.length - policy.maxSessions + 1;
      if (excess > 0)
        await revokeStaffSessions(services, tenantId, {
          ids: active.slice(0, excess).map((s) => s.id),
        });
    }
    await services.db.session.create({
      data: {
        id: sid,
        tenantId,
        userId: user.id,
        refreshHash: hash,
        ip: ipOf(req),
        userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_S * 1000),
        lastSeenAt: now,
      },
    });
  });
  await services.revocations.markActive(sid, policy.sessionIdleMinutes);
  await services.cache.set(metaKey(sid), { mfa: opts.mfa } satisfies SessionMeta, REFRESH_TTL_S);
  const csrfToken = setSessionCookies(res, COOKIES.staff, token, REFRESH_TTL_S);
  const access = await staffAccess(services, {
    userId: user.id,
    tenantId,
    sid,
    mfa: opts.mfa,
    mcp: user.mustChangePassword,
    idle: policy.sessionIdleMinutes,
  });
  return { ...access, csrfToken, mustChangePassword: user.mustChangePassword };
}

// ---------------------------------------------------------------------------
// Login + MFA
// ---------------------------------------------------------------------------

const userRoleIds = (req: Request, userId: string) =>
  inTenant(req, async () =>
    (await req.services.db.userRole.findMany({ where: { userId }, select: { roleId: true } })).map(
      (r) => r.roleId,
    ),
  );

export async function login(
  req: Request,
  res: Response,
  body: { email: string; password: string },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [
    { key: `login:ip:${ipKey(req)}`, limit: 30, windowS: 60 },
    { key: `login:acct:${tenant.id}:${accountKey(body.email)}`, limit: 10, windowS: 60 },
  ]);
  const policy = await services.securityPolicies.get(tenant.id);
  const user = await inTenant(req, () =>
    services.db.user.findFirst({
      where: { email: { equals: body.email, mode: 'insensitive' }, deletedAt: null },
    }),
  );
  if (!user) {
    await verifyDummy(body.password);
    await auditNow(req, {
      action: 'auth.login_failed',
      entity: 'user',
      after: { reason: 'unknown_account' },
    });
    throw invalidCredentials();
  }
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await auditNow(req, {
      action: 'auth.login_locked',
      entity: 'user',
      entityId: user.id,
      userId: user.id,
    });
    throw new AppError('ACCOUNT_LOCKED', undefined, {
      detail: 'Too many failed attempts',
      meta: { lockedUntil: user.lockedUntil.toISOString() },
    });
  }
  const ok = await verifyPassword(user.passwordHash, body.password);
  if (!ok) {
    const attempts = user.failedAttempts + 1;
    const threshold = Math.max(policy.lockoutThreshold, 1);
    // Progressive lockout: each new series of `threshold` failures doubles the duration.
    const lockedUntil =
      attempts % threshold === 0
        ? new Date(
            now.getTime() +
              Math.min(policy.lockoutMinutes * 2 ** (attempts / threshold - 1), MAX_LOCK_MINUTES) *
                60_000,
          )
        : null;
    await inTenant(req, () =>
      services.db.user.update({
        where: { id: user.id },
        data: { failedAttempts: attempts, ...(lockedUntil ? { lockedUntil } : {}) },
      }),
    );
    await auditNow(req, {
      action: lockedUntil ? 'auth.account_locked' : 'auth.login_failed',
      entity: 'user',
      entityId: user.id,
      userId: user.id,
      after: { failedAttempts: attempts, ...(lockedUntil ? { lockedUntil } : {}) },
    });
    if (lockedUntil)
      throw new AppError('ACCOUNT_LOCKED', undefined, {
        detail: 'Too many failed attempts',
        meta: { lockedUntil: lockedUntil.toISOString() },
      });
    throw invalidCredentials();
  }
  if (user.status !== 'ACTIVE') {
    await auditNow(req, {
      action: 'auth.login_failed',
      entity: 'user',
      entityId: user.id,
      userId: user.id,
      after: { reason: `status_${user.status.toLowerCase()}` },
    });
    throw invalidCredentials();
  }

  const expired = passwordExpired(policy, user, now);
  const mustChangePassword = user.mustChangePassword || expired;
  await inTenant(req, () =>
    services.db.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, ...(expired ? { mustChangePassword } : {}) },
    }),
  );

  if (user.totpSecretEnc) {
    const challengeToken = await issueChallenge(services, {
      sub: user.id,
      scope: 'staff',
      tid: tenant.id,
      purpose: 'mfa',
    });
    return { mfaRequired: true, challengeToken, methods: ['totp', 'backup_code'] as const };
  }
  if (mfaRequiredFor(policy, await userRoleIds(req, user.id))) {
    const challengeToken = await issueChallenge(services, {
      sub: user.id,
      scope: 'staff',
      tid: tenant.id,
      purpose: 'mfa_setup',
    });
    return { mfaSetupRequired: true, challengeToken };
  }
  return completeLogin(req, res, { id: user.id, mustChangePassword }, false, 'password');
}

async function completeLogin(
  req: Request,
  res: Response,
  user: { id: string; mustChangePassword: boolean },
  mfa: boolean,
  method: string,
) {
  await inTenant(req, () =>
    req.services.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  );
  const session = await openStaffSession(req, res, user, { mfa });
  await auditNow(req, {
    action: 'auth.login',
    entity: 'user',
    entityId: user.id,
    userId: user.id,
    after: { method, mfa },
  });
  return session;
}

async function activeUser(req: Request, userId: string) {
  const user = await inTenant(req, () =>
    req.services.db.user.findFirst({ where: { id: userId, deletedAt: null } }),
  );
  if (!user || user.status !== 'ACTIVE') throw unauthenticated('User not found or inactive');
  return user;
}

export async function verifyMfa(
  req: Request,
  res: Response,
  body: { challengeToken: string; code: string },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [{ key: `mfa:ip:${ipKey(req)}`, limit: 30, windowS: 60 }]);
  const claims = await verifyChallenge(services, body.challengeToken, {
    scope: 'staff',
    tid: tenant.id,
    purposes: ['mfa'],
  });
  const user = await activeUser(req, claims.sub);
  if (!user.totpSecretEnc) throw unauthenticated('MFA is not enabled');
  let method: string;
  try {
    method = await verifySecondFactor(
      services,
      staffPrincipal(tenant.id, user.id),
      user.totpSecretEnc,
      body.code,
    );
  } catch (err) {
    await auditNow(req, {
      action: 'auth.mfa_failed',
      entity: 'user',
      entityId: user.id,
      userId: user.id,
    });
    throw err;
  }
  await consumeChallenge(services, claims);
  const policy = await services.securityPolicies.get(tenant.id);
  const mustChangePassword = user.mustChangePassword || passwordExpired(policy, user);
  return completeLogin(req, res, { id: user.id, mustChangePassword }, true, method);
}

/** Resolves who enrols: the bearer (staff session) or an `mfa_setup` challenge. */
async function enrolmentSubject(req: Request, challengeToken: string | undefined) {
  const tenant = tenantOf(req);
  if (req.auth?.scope === 'staff') return { userId: req.auth.userId, claims: null };
  if (!challengeToken) throw unauthenticated();
  const claims = await verifyChallenge(req.services, challengeToken, {
    scope: 'staff',
    tid: tenant.id,
    purposes: ['mfa_setup'],
  });
  return { userId: claims.sub, claims };
}

export async function mfaSetup(req: Request, body: { challengeToken?: string | undefined }) {
  const tenant = tenantOf(req);
  const { userId } = await enrolmentSubject(req, body.challengeToken);
  const user = await activeUser(req, userId);
  if (user.totpSecretEnc)
    throw new AppError('CONFLICT', 'MFA is already enabled', { meta: { reason: 'MFA_ENABLED' } });
  return startMfaSetup(req.services, staffPrincipal(tenant.id, user.id), {
    account: user.email,
    issuer: tenant.name,
  });
}

export async function mfaActivate(
  req: Request,
  res: Response,
  body: { code: string; challengeToken?: string | undefined },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  const { userId, claims } = await enrolmentSubject(req, body.challengeToken);
  const user = await activeUser(req, userId);
  if (user.totpSecretEnc)
    throw new AppError('CONFLICT', 'MFA is already enabled', { meta: { reason: 'MFA_ENABLED' } });
  const { secretEnc, backupCodes } = await activateMfa(
    services,
    staffPrincipal(tenant.id, user.id),
    body.code,
  );
  await inTenant(req, () =>
    services.db.user.update({ where: { id: user.id }, data: { totpSecretEnc: secretEnc } }),
  );
  await auditNow(req, {
    action: 'auth.mfa_enabled',
    entity: 'user',
    entityId: user.id,
    userId: user.id,
  });
  if (!claims) return { backupCodes };
  await consumeChallenge(services, claims);
  const policy = await services.securityPolicies.get(tenant.id);
  const mustChangePassword = user.mustChangePassword || passwordExpired(policy, user);
  const session = await completeLogin(req, res, { id: user.id, mustChangePassword }, true, 'totp');
  return { ...session, backupCodes };
}

async function confirmPassword(req: Request, password: string) {
  const user = await activeUser(req, req.auth!.userId);
  await rateLimit(req.services, [{ key: `confirm:${user.id}`, limit: 10, windowS: 15 * 60 }]);
  if (!(await verifyPassword(user.passwordHash, password)))
    throw new AppError('VALIDATION_ERROR', 'Invalid password', {
      errors: [{ path: 'password', message: 'Invalid password', code: 'INVALID_PASSWORD' }],
    });
  return user;
}

export async function mfaDisable(req: Request, body: { password: string }) {
  const { services } = req;
  const tenant = tenantOf(req);
  const user = await confirmPassword(req, body.password);
  const policy = await services.securityPolicies.get(tenant.id);
  if (mfaRequiredFor(policy, await userRoleIds(req, user.id)))
    throw new AppError('FORBIDDEN', 'MFA is mandatory for your role', {
      meta: { reason: 'MFA_MANDATORY' },
    });
  await inTenant(req, () =>
    services.db.user.update({ where: { id: user.id }, data: { totpSecretEnc: null } }),
  );
  await clearMfa(services, staffPrincipal(tenant.id, user.id));
  await auditNow(req, { action: 'auth.mfa_disabled', entity: 'user', entityId: user.id });
}

export async function mfaBackupCodes(req: Request, body: { password: string }) {
  const tenant = tenantOf(req);
  const user = await confirmPassword(req, body.password);
  if (!user.totpSecretEnc)
    throw new AppError('PRECONDITION_FAILED', 'MFA is not enabled', {
      meta: { reason: 'MFA_DISABLED' },
    });
  const backupCodes = await regenerateBackupCodes(req.services, staffPrincipal(tenant.id, user.id));
  await auditNow(req, {
    action: 'auth.mfa_backup_codes_regenerated',
    entity: 'user',
    entityId: user.id,
  });
  return { backupCodes };
}

// ---------------------------------------------------------------------------
// Refresh / logout
// ---------------------------------------------------------------------------

export async function refresh(req: Request, res: Response) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [{ key: `refresh:ip:${ipKey(req)}`, limit: 120, windowS: 60 }]);
  assertCsrf(req);
  const fail = (reason: string) => {
    clearSessionCookies(res, COOKIES.staff);
    return new AppError('UNAUTHENTICATED', 'Session expired', { meta: { reason } });
  };
  const parsed = parseRefreshToken(readCookie(req, COOKIES.staff.name));
  if (!parsed) throw fail('REFRESH_MISSING');
  const session = await inTenant(req, () =>
    services.db.session.findUnique({ where: { id: parsed.sessionId } }),
  );
  if (!session || session.revokedAt || session.expiresAt <= new Date())
    throw fail('SESSION_REVOKED');
  if (!safeEqual(sha256(parsed.token), session.refreshHash)) {
    // A rotated (already used) refresh token was replayed: revoke the whole family.
    await revokeStaffSessions(services, tenant.id, { ids: [session.id] });
    await auditNow(req, {
      action: 'auth.refresh_reuse_detected',
      entity: 'session',
      entityId: session.id,
      userId: session.userId,
    });
    throw fail('REFRESH_REUSED');
  }
  if (!(await services.revocations.isActive(session.id))) {
    await revokeStaffSessions(services, tenant.id, { ids: [session.id] });
    throw fail('SESSION_IDLE');
  }
  const user = await inTenant(req, () =>
    services.db.user.findFirst({ where: { id: session.userId, deletedAt: null } }),
  );
  if (!user || user.status !== 'ACTIVE') {
    await revokeStaffSessions(services, tenant.id, { ids: [session.id] });
    throw fail('USER_INACTIVE');
  }
  const { token, hash } = newRefreshToken(session.id);
  const rotated = await inTenant(req, () =>
    services.db.session.updateMany({
      where: { id: session.id, refreshHash: session.refreshHash, revokedAt: null },
      data: { refreshHash: hash, lastSeenAt: new Date() },
    }),
  );
  if (rotated.count !== 1) throw fail('REFRESH_REUSED');
  const policy = await services.securityPolicies.get(tenant.id);
  await services.revocations.markActive(session.id, policy.sessionIdleMinutes);
  const meta = await services.cache.get<SessionMeta>(metaKey(session.id));
  const remaining = Math.max(Math.floor((session.expiresAt.getTime() - Date.now()) / 1000), 60);
  const csrfToken = setSessionCookies(res, COOKIES.staff, token, remaining);
  const mustChangePassword = user.mustChangePassword || passwordExpired(policy, user);
  const access = await staffAccess(services, {
    userId: user.id,
    tenantId: tenant.id,
    sid: session.id,
    mfa: meta?.mfa ?? false,
    mcp: mustChangePassword,
    idle: policy.sessionIdleMinutes,
  });
  return { ...access, csrfToken, mustChangePassword };
}

export async function logout(req: Request, res: Response) {
  const tenant = tenantOf(req);
  let sid = req.auth?.scope === 'staff' ? req.auth.sessionId : undefined;
  if (!sid) {
    const parsed = parseRefreshToken(readCookie(req, COOKIES.staff.name));
    if (parsed) {
      assertCsrf(req);
      sid = parsed.sessionId;
    }
  }
  clearSessionCookies(res, COOKIES.staff);
  if (!sid) return;
  await revokeStaffSessions(req.services, tenant.id, { ids: [sid] });
  await auditNow(req, { action: 'auth.logout', entity: 'session', entityId: sid });
}

// ---------------------------------------------------------------------------
// Me / sessions
// ---------------------------------------------------------------------------

export async function me(req: Request) {
  const { services } = req;
  const tenant = tenantOf(req);
  const auth = req.auth!;
  const grants = await loadGrants(req);
  const user = await activeUser(req, auth.userId);
  const all = grants.permissions.includes('*');
  const [entitlements, status, permVer, policy, properties, legal, meta] = await Promise.all([
    services.entitlements.resolve(tenant.id),
    services.tenants.subscriptionStatus(tenant.id),
    services.permVersions.current(tenant.id),
    services.securityPolicies.get(tenant.id),
    inTenant(req, () =>
      services.db.property.findMany({
        where: all ? {} : { id: { in: grants.propertyIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ),
    legalStatus(req),
    services.cache.get<SessionMeta>(metaKey(auth.sessionId)),
  ]);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      status: user.status,
      mfaEnabled: !!user.totpSecretEnc,
      mustChangePassword: user.mustChangePassword || auth.mustChangePassword,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    properties,
    permissions: grants.permissions,
    allProperties: all,
    permVer,
    subscription: { status },
    entitlements: {
      planCode: entitlements.planCode,
      features: entitlements.features,
      quotas: entitlements.quotas,
    },
    session: {
      id: auth.sessionId,
      idleMinutes: policy.sessionIdleMinutes,
      mfa: auth.mfa || (meta?.mfa ?? false),
    },
    impersonation: auth.impersonatedBy ? { by: auth.impersonatedBy } : null,
    legal: {
      blocked: legal.blocked,
      canAccept: legal.canAccept,
      pending: legal.pending.map((d) => ({ id: d.id, type: d.type, version: d.version })),
    },
  };
}

export function serializeSession(
  s: {
    id: string;
    ip: string | null;
    userAgent: string | null;
    kind: string;
    createdAt: Date;
    lastSeenAt: Date | null;
    expiresAt: Date;
  },
  currentId?: string,
) {
  return {
    id: s.id,
    ip: s.ip,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentId,
    impersonation: s.kind === 'IMPERSONATION',
  };
}

export async function listSessions(req: Request) {
  const auth = req.auth!;
  const rows = await inTenant(req, () => activeSessions(req.services, auth.userId));
  return { items: rows.reverse().map((s) => serializeSession(s, auth.sessionId)) };
}

export async function revokeSession(req: Request, id: string) {
  const auth = req.auth!;
  const tenant = tenantOf(req);
  const row = await inTenant(req, () =>
    req.services.db.session.findFirst({ where: { id, userId: auth.userId } }),
  );
  if (!row) throw new AppError('NOT_FOUND', undefined, { detail: 'Session not found' });
  await revokeStaffSessions(req.services, tenant.id, { ids: [id] });
  await auditNow(req, { action: 'auth.session_revoked', entity: 'session', entityId: id });
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function changePassword(
  req: Request,
  body: { currentPassword: string; newPassword: string },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  const auth = req.auth!;
  const user = await confirmPassword(req, body.currentPassword);
  await setStaffPassword(services, tenant.id, user, body.newPassword);
  await revokeStaffSessions(services, tenant.id, { userId: user.id, exceptId: auth.sessionId });
  await auditNow(req, { action: 'auth.password_changed', entity: 'user', entityId: user.id });
  const policy = await services.securityPolicies.get(tenant.id);
  const meta = await services.cache.get<SessionMeta>(metaKey(auth.sessionId));
  const access = await staffAccess(services, {
    userId: user.id,
    tenantId: tenant.id,
    sid: auth.sessionId,
    mfa: meta?.mfa ?? auth.mfa,
    mcp: false,
    idle: policy.sessionIdleMinutes,
  });
  return { ...access, mustChangePassword: false };
}

export async function forgotPassword(req: Request, body: { email: string }) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [
    { key: `forgot:ip:${ipKey(req)}`, limit: 10, windowS: 60 },
    { key: `forgot:acct:${tenant.id}:${accountKey(body.email)}`, limit: 3, windowS: 15 * 60 },
  ]);
  const user = await inTenant(req, () =>
    services.db.user.findFirst({
      where: { email: { equals: body.email, mode: 'insensitive' }, deletedAt: null },
    }),
  );
  if (!user || user.status !== 'ACTIVE') return { ok: true as const };
  const token = randomToken(32);
  const hash = sha256(token);
  const previous = await services.redis.get(resetUserKey(user.id));
  if (previous) await services.redis.del(resetKey(tenant.id, previous));
  await services.redis
    .multi()
    .set(resetKey(tenant.id, hash), user.id, 'EX', RESET_TTL_S)
    .set(resetUserKey(user.id), hash, 'EX', RESET_TTL_S)
    .exec();
  await sendAuthMessage(services, {
    tenantId: tenant.id,
    to: { email: user.email },
    templateCode: 'password_reset',
    userId: user.id,
    data: {
      user: { name: user.name },
      hotel: { name: tenant.name },
      reset: {
        url: `https://${tenant.hostname}/reset-password?token=${encodeURIComponent(token)}`,
        expiresInMinutes: RESET_TTL_S / 60,
      },
    },
    idempotencyKey: `pwreset:${hash}`,
  });
  await auditNow(req, {
    action: 'auth.password_reset_requested',
    entity: 'user',
    entityId: user.id,
    userId: user.id,
  });
  return { ok: true as const };
}

const invalidResetToken = () =>
  new AppError('BAD_REQUEST', 'Invalid or expired link', {
    meta: { reason: 'TOKEN_INVALID' },
  });

export async function resetPassword(req: Request, body: { token: string; newPassword: string }) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [{ key: `reset:ip:${ipKey(req)}`, limit: 20, windowS: 60 }]);
  const hash = sha256(body.token);
  const userId = await services.redis.get(resetKey(tenant.id, hash));
  if (!userId) throw invalidResetToken();
  const user = await inTenant(req, () =>
    services.db.user.findFirst({ where: { id: userId, deletedAt: null, status: 'ACTIVE' } }),
  );
  if (!user) throw invalidResetToken();
  await setStaffPassword(services, tenant.id, user, body.newPassword);
  // Single use: the first consumer wins.
  if ((await services.redis.del(resetKey(tenant.id, hash))) !== 1) throw invalidResetToken();
  await services.redis.del(resetUserKey(user.id));
  await revokeStaffSessions(services, tenant.id, { userId: user.id });
  await auditNow(req, {
    action: 'auth.password_reset',
    entity: 'user',
    entityId: user.id,
    userId: user.id,
  });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Invitations (created by IAM, accepted here)
// ---------------------------------------------------------------------------

async function invitedUser(req: Request, token: string) {
  const tenant = tenantOf(req);
  const hash = sha256(token);
  const userId = await req.services.redis.get(inviteKey(tenant.id, hash));
  const user = userId
    ? await inTenant(req, () =>
        req.services.db.user.findFirst({
          where: { id: userId, deletedAt: null, status: 'INVITED' },
        }),
      )
    : null;
  if (!user) throw invalidResetToken();
  return { user, hash };
}

export async function inspectInvitation(req: Request, body: { token: string }) {
  await rateLimit(req.services, [{ key: `invite:ip:${ipKey(req)}`, limit: 30, windowS: 60 }]);
  const { user } = await invitedUser(req, body.token);
  const tenant = tenantOf(req);
  return { email: user.email, name: user.name, tenant: { name: tenant.name } };
}

export async function acceptInvitation(
  req: Request,
  body: { token: string; password: string; name?: string | undefined },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [{ key: `invite:ip:${ipKey(req)}`, limit: 30, windowS: 60 }]);
  const { user, hash } = await invitedUser(req, body.token);
  await setStaffPassword(services, tenant.id, user, body.password, {
    status: 'ACTIVE',
    ...(body.name ? { name: body.name } : {}),
  });
  await services.redis.del(inviteKey(tenant.id, hash), inviteUserKey(user.id));
  await services.permVersions.bump(tenant.id);
  await auditNow(req, {
    action: 'iam.invitation_accepted',
    entity: 'user',
    entityId: user.id,
    userId: user.id,
  });
  return { email: user.email };
}
