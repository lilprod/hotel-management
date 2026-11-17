import { runWithTenant } from '@hm/database';
import type { Request, Response } from 'express';
import { AppError, unauthenticated } from '../../lib/errors.js';
import { auditNow, ipOf } from '../audit/service.js';
import { sendAuthMessage } from '../auth/mailer.js';
import {
  assertPasswordIssues,
  checkPasswordRules,
  hashPassword,
  verifyDummy,
  verifyPassword,
} from '../auth/passwords.js';
import {
  createRedisSession,
  revokeAllRedisSessions,
  revokeRedisSession,
  rotateRedisSession,
} from '../auth/redis-sessions.js';
import {
  accountKey,
  assertCsrf,
  clearSessionCookies,
  COOKIES,
  ipKey,
  issueAccessToken,
  parseRefreshToken,
  randomToken,
  rateLimit,
  readCookie,
  REFRESH_TTL_S,
  setSessionCookies,
  sha256,
} from '../auth/tokens.js';

/** Guest password rules (fixed: the tenant policy targets staff accounts). */
export const GUEST_PASSWORD_RULES = { minLength: 8, requireClasses: 2 } as const;
export const VERIFY_TTL_S = 48 * 3600;
export const GUEST_RESET_TTL_S = 30 * 60;
/** No template exists yet for e-mail verification (reported gap in @hm/templates). */
export const GUEST_VERIFICATION_TEMPLATE = 'guest_email_verification';
const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

const verifyKey = (tid: string, hash: string) => `hm:gverify:${tid}:${hash}`;
const resetKey = (tid: string, hash: string) => `hm:pwreset:guest:${tid}:${hash}`;
const resetAccountKey = (id: string) => `hm:pwreset-user:guest:${id}`;
const failKey = (tid: string, email: string) => `hm:gfail:${tid}:${accountKey(email)}`;
const lockKey = (tid: string, email: string) => `hm:glock:${tid}:${accountKey(email)}`;

function tenantOf(req: Request) {
  if (!req.tenant) throw new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });
  return req.tenant;
}
const inTenant = <T>(req: Request, fn: () => Promise<T>) => runWithTenant(tenantOf(req).id, fn);

const invalidCredentials = () =>
  new AppError('UNAUTHENTICATED', 'Invalid credentials', {
    meta: { reason: 'INVALID_CREDENTIALS' },
  });
const invalidToken = () =>
  new AppError('BAD_REQUEST', 'Invalid or expired link', { meta: { reason: 'TOKEN_INVALID' } });

function assertGuestPassword(password: string, email: string) {
  assertPasswordIssues(checkPasswordRules(password, GUEST_PASSWORD_RULES, { email }));
}

async function sendVerification(
  req: Request,
  account: { id: string; email: string; locale: string; guestId: string },
  firstName: string,
) {
  const tenant = tenantOf(req);
  const token = randomToken(32);
  const hash = sha256(token);
  await req.services.redis.set(verifyKey(tenant.id, hash), account.id, 'EX', VERIFY_TTL_S);
  await sendAuthMessage(req.services, {
    tenantId: tenant.id,
    to: { email: account.email },
    templateCode: GUEST_VERIFICATION_TEMPLATE,
    locale: account.locale,
    guestId: account.guestId,
    data: {
      guest: { firstName },
      hotel: { name: tenant.name },
      verification: {
        url: `https://${tenant.hostname}/verify-email?token=${encodeURIComponent(token)}`,
        expiresInHours: VERIFY_TTL_S / 3600,
      },
    },
    idempotencyKey: `gverify:${hash}`,
  });
}

/** Always 202 (no account enumeration). An existing guest profile with the e-mail is linked. */
export async function register(
  req: Request,
  body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string | undefined;
    locale: string;
  },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [
    { key: `greg:ip:${ipKey(req)}`, limit: 10, windowS: 60 },
    { key: `greg:acct:${tenant.id}:${accountKey(body.email)}`, limit: 3, windowS: 3600 },
  ]);
  assertGuestPassword(body.password, body.email);
  const existing = await inTenant(req, () =>
    services.db.guestAccount.findFirst({
      where: { email: { equals: body.email, mode: 'insensitive' } },
    }),
  );
  if (existing) {
    // Unverified account: send the link again; verified: nothing (they can reset).
    if (!existing.emailVerifiedAt) await sendVerification(req, existing, body.firstName);
    return { ok: true as const };
  }
  const passwordHash = await hashPassword(body.password);
  const account = await inTenant(req, async () => {
    const guest =
      (await services.db.guest.findFirst({
        where: {
          email: { equals: body.email, mode: 'insensitive' },
          deletedAt: null,
          guestAccount: { is: null },
        },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await services.db.guest.create({
        data: {
          tenantId: tenant.id,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          phone: body.phone ?? null,
        },
      }));
    return services.db.guestAccount.create({
      data: {
        tenantId: tenant.id,
        guestId: guest.id,
        email: body.email,
        passwordHash,
        locale: body.locale,
      },
    });
  });
  await sendVerification(req, account, body.firstName);
  await auditNow(req, {
    action: 'portal.auth.registered',
    entity: 'guest_account',
    entityId: account.id,
  });
  return { ok: true as const };
}

export async function verifyEmail(req: Request, body: { token: string }) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [{ key: `gverify:ip:${ipKey(req)}`, limit: 30, windowS: 60 }]);
  const key = verifyKey(tenant.id, sha256(body.token));
  const accountId = await services.redis.getdel(key);
  if (!accountId) throw invalidToken();
  const updated = await inTenant(req, () =>
    services.db.guestAccount.updateMany({
      where: { id: accountId },
      data: { emailVerifiedAt: new Date() },
    }),
  );
  if (updated.count !== 1) throw invalidToken();
  await auditNow(req, {
    action: 'portal.auth.email_verified',
    entity: 'guest_account',
    entityId: accountId,
  });
  return { ok: true as const };
}

export async function resendVerification(req: Request, body: { email: string }) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [
    { key: `gresend:ip:${ipKey(req)}`, limit: 10, windowS: 60 },
    { key: `gresend:acct:${tenant.id}:${accountKey(body.email)}`, limit: 3, windowS: 3600 },
  ]);
  const account = await inTenant(req, () =>
    services.db.guestAccount.findFirst({
      where: { email: { equals: body.email, mode: 'insensitive' }, isActive: true },
      include: { guest: { select: { firstName: true } } },
    }),
  );
  if (account && !account.emailVerifiedAt)
    await sendVerification(req, account, account.guest.firstName);
  return { ok: true as const };
}

async function openSession(req: Request, res: Response, accountId: string) {
  const { services } = req;
  const tenant = tenantOf(req);
  const { session, token } = await createRedisSession(services, {
    scope: 'portal',
    subject: accountId,
    tenantId: tenant.id,
    ip: ipOf(req),
    userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
    mfa: false,
  });
  const csrfToken = setSessionCookies(res, COOKIES.portal, token, REFRESH_TTL_S);
  const access = await issueAccessToken(services, {
    sub: accountId,
    tid: tenant.id,
    sid: session.id,
    scope: 'portal',
  });
  return { ...access, csrfToken };
}

export async function login(
  req: Request,
  res: Response,
  body: { email: string; password: string },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [
    { key: `glogin:ip:${ipKey(req)}`, limit: 30, windowS: 60 },
    { key: `glogin:acct:${tenant.id}:${accountKey(body.email)}`, limit: 10, windowS: 60 },
  ]);
  const lockedTtl = await services.redis.ttl(lockKey(tenant.id, body.email));
  if (lockedTtl > 0)
    throw new AppError('ACCOUNT_LOCKED', undefined, {
      detail: 'Too many failed attempts',
      meta: { lockedUntil: new Date(Date.now() + lockedTtl * 1000).toISOString() },
    });
  const account = await inTenant(req, () =>
    services.db.guestAccount.findFirst({
      where: { email: { equals: body.email, mode: 'insensitive' } },
    }),
  );
  const ok = account ? await verifyPassword(account.passwordHash, body.password) : false;
  if (!account) await verifyDummy(body.password);
  if (!account || !ok || !account.isActive) {
    if (account && !ok) {
      const fk = failKey(tenant.id, body.email);
      const n = await services.redis.incr(fk);
      await services.redis.expire(fk, LOCK_MINUTES * 60);
      if (n >= LOCK_THRESHOLD) {
        await services.redis.set(lockKey(tenant.id, body.email), '1', 'EX', LOCK_MINUTES * 60);
        await services.redis.del(fk);
      }
    }
    throw invalidCredentials();
  }
  if (!account.emailVerifiedAt)
    throw new AppError('FORBIDDEN', 'E-mail address not verified', {
      meta: { reason: 'EMAIL_NOT_VERIFIED' },
    });
  await services.redis.del(failKey(tenant.id, body.email));
  await inTenant(req, () =>
    services.db.guestAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    }),
  );
  await auditNow(req, {
    action: 'portal.auth.login',
    entity: 'guest_account',
    entityId: account.id,
  });
  return openSession(req, res, account.id);
}

export async function refresh(req: Request, res: Response) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [{ key: `grefresh:ip:${ipKey(req)}`, limit: 120, windowS: 60 }]);
  assertCsrf(req);
  try {
    const rotated = await rotateRedisSession(
      services,
      'portal',
      readCookie(req, COOKIES.portal.name),
      tenant.id,
      (s) =>
        auditNow(req, {
          action: 'portal.auth.refresh_reuse_detected',
          entity: 'guest_account',
          entityId: s.subject,
        }),
    );
    const account = await inTenant(req, () =>
      services.db.guestAccount.findFirst({
        where: { id: rotated.session.subject, isActive: true },
      }),
    );
    if (!account) {
      await revokeRedisSession(services, 'portal', rotated.session.id);
      throw unauthenticated('Account disabled');
    }
    const csrfToken = setSessionCookies(res, COOKIES.portal, rotated.token, rotated.remainingS);
    const access = await issueAccessToken(services, {
      sub: account.id,
      tid: tenant.id,
      sid: rotated.session.id,
      scope: 'portal',
    });
    return { ...access, csrfToken };
  } catch (err) {
    clearSessionCookies(res, COOKIES.portal);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  let sid = req.auth?.scope === 'portal' ? req.auth.sessionId : undefined;
  if (!sid) {
    const parsed = parseRefreshToken(readCookie(req, COOKIES.portal.name));
    if (parsed) {
      assertCsrf(req);
      sid = parsed.sessionId;
    }
  }
  clearSessionCookies(res, COOKIES.portal);
  if (sid) await revokeRedisSession(req.services, 'portal', sid);
}

export async function me(req: Request) {
  const account = await inTenant(req, () =>
    req.services.db.guestAccount.findFirst({
      where: { id: req.auth!.userId, isActive: true },
      include: {
        guest: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      },
    }),
  );
  if (!account) throw unauthenticated('Account not found or disabled');
  const tenant = tenantOf(req);
  return {
    account: {
      id: account.id,
      email: account.email,
      locale: account.locale,
      emailVerified: !!account.emailVerifiedAt,
      lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    },
    guest: account.guest,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
  };
}

export async function forgotPassword(req: Request, body: { email: string }) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [
    { key: `gforgot:ip:${ipKey(req)}`, limit: 10, windowS: 60 },
    { key: `gforgot:acct:${tenant.id}:${accountKey(body.email)}`, limit: 3, windowS: 15 * 60 },
  ]);
  const account = await inTenant(req, () =>
    services.db.guestAccount.findFirst({
      where: { email: { equals: body.email, mode: 'insensitive' }, isActive: true },
      include: { guest: { select: { firstName: true } } },
    }),
  );
  if (!account) return { ok: true as const };
  const token = randomToken(32);
  const hash = sha256(token);
  const previous = await services.redis.get(resetAccountKey(account.id));
  if (previous) await services.redis.del(resetKey(tenant.id, previous));
  await services.redis
    .multi()
    .set(resetKey(tenant.id, hash), account.id, 'EX', GUEST_RESET_TTL_S)
    .set(resetAccountKey(account.id), hash, 'EX', GUEST_RESET_TTL_S)
    .exec();
  await sendAuthMessage(services, {
    tenantId: tenant.id,
    to: { email: account.email },
    templateCode: 'password_reset',
    locale: account.locale,
    guestId: account.guestId,
    data: {
      user: { name: account.guest.firstName },
      hotel: { name: tenant.name },
      reset: {
        url: `https://${tenant.hostname}/account/reset-password?token=${encodeURIComponent(token)}`,
        expiresInMinutes: GUEST_RESET_TTL_S / 60,
      },
    },
    idempotencyKey: `gpwreset:${hash}`,
  });
  return { ok: true as const };
}

export async function resetPassword(req: Request, body: { token: string; newPassword: string }) {
  const { services } = req;
  const tenant = tenantOf(req);
  await rateLimit(services, [{ key: `greset:ip:${ipKey(req)}`, limit: 20, windowS: 60 }]);
  const key = resetKey(tenant.id, sha256(body.token));
  const accountId = await services.redis.get(key);
  if (!accountId) throw invalidToken();
  const account = await inTenant(req, () =>
    services.db.guestAccount.findFirst({ where: { id: accountId, isActive: true } }),
  );
  if (!account) throw invalidToken();
  assertGuestPassword(body.newPassword, account.email);
  if ((await services.redis.del(key)) !== 1) throw invalidToken();
  await services.redis.del(resetAccountKey(account.id));
  const passwordHash = await hashPassword(body.newPassword);
  await inTenant(req, () =>
    services.db.guestAccount.update({
      where: { id: account.id },
      // Following a link sent to the address also proves it.
      data: {
        passwordHash,
        emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
      },
    }),
  );
  await revokeAllRedisSessions(services, 'portal', tenant.id, account.id);
  await auditNow(req, {
    action: 'portal.auth.password_reset',
    entity: 'guest_account',
    entityId: account.id,
  });
  return { ok: true as const };
}

export async function changePassword(
  req: Request,
  body: { currentPassword: string; newPassword: string },
) {
  const { services } = req;
  const tenant = tenantOf(req);
  const account = await inTenant(req, () =>
    services.db.guestAccount.findFirst({ where: { id: req.auth!.userId, isActive: true } }),
  );
  if (!account) throw unauthenticated();
  await rateLimit(services, [{ key: `gconfirm:${account.id}`, limit: 10, windowS: 15 * 60 }]);
  if (!(await verifyPassword(account.passwordHash, body.currentPassword)))
    throw new AppError('VALIDATION_ERROR', 'Invalid password', {
      errors: [{ path: 'currentPassword', message: 'Invalid password', code: 'INVALID_PASSWORD' }],
    });
  assertGuestPassword(body.newPassword, account.email);
  const passwordHash = await hashPassword(body.newPassword);
  await inTenant(req, () =>
    services.db.guestAccount.update({ where: { id: account.id }, data: { passwordHash } }),
  );
  await revokeAllRedisSessions(services, 'portal', tenant.id, account.id, req.auth!.sessionId);
}
