import { Prisma } from '@hm/database';
import { normalizePhone } from '@hm/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Services } from '../../core/container.js';
import { AppError } from '../../lib/errors.js';
import { ipOf, writePlatformAudit, writeTenantAudit } from '../audit/service.js';
import { sendAuthMessage } from '../auth/mailer.js';
import { assertPasswordIssues, checkPasswordRules, hashPassword } from '../auth/passwords.js';
import { accountKey, ipKey, randomToken, rateLimit, sha256 } from '../auth/tokens.js';
import {
  billingNow,
  conflict,
  inTx,
  invalidateTenantCaches,
  isoOf,
  platformToday,
  type Actor,
} from '../billing/common.js';
import { renderInvoicePdf } from '../billing/documents.js';
import { loadBillingSettings } from '../billing/settings.js';
import { latestDocuments } from '../legal/service.js';
import { countryDefaults } from '../platform-tenants/country-defaults.js';
import { provisionTenant } from '../platform-tenants/provision.js';
import { getCaptchaVerifier } from './captcha.js';
import type { resendBody, signupBody, verifyBody } from './schemas.js';
import { baseDomain, checkSlug } from './slug.js';

export const VERIFY_TTL_S = 48 * 3600;
const verifyKey = (hash: string) => `hm:signup-verify:${hash}`;
const verifyUserKey = (userId: string) => `hm:signup-verify-user:${userId}`;
const SYSTEM: Actor = { kind: 'system', id: null };

const invalid = (path: string, code: string, message: string) =>
  new AppError('VALIDATION_ERROR', undefined, {
    errors: [{ path, code, message }],
    meta: { reason: code },
  });

const appUrl = (services: Services, host: string, path: string) =>
  `${services.config.APP_URL_SCHEME}://${host}${path}`;

// --- public plans (landing page) ---------------------------------------------------------

/** Plans offered on the landing page: public, active, with the prices in force today. */
export async function publicPlans(services: Services) {
  const today = platformToday();
  const plans = await services.admin.plan.findMany({
    where: { isPublic: true, isActive: true, deletedAt: null },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    include: {
      planPrices: { orderBy: { validFrom: 'desc' } },
      planFeatures: { where: { enabled: true }, orderBy: { featureKey: 'asc' } },
      planQuotas: { orderBy: { quotaKey: 'asc' } },
    },
  });
  return {
    items: plans.map((p) => {
      const seen = new Set<string>();
      const prices = p.planPrices
        .filter((x) => isoOf(x.validFrom) <= today && (!x.validTo || isoOf(x.validTo) > today))
        .filter((x) => {
          const k = `${x.billingCycle}:${x.currency}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((x) => ({
          billingCycle: x.billingCycle,
          currency: x.currency,
          amount: Number(x.amount),
        }));
      return {
        code: p.code,
        name: p.name,
        description: p.description,
        trialDays: p.trialDays,
        features: p.planFeatures.map((f) => f.featureKey),
        quotas: Object.fromEntries(p.planQuotas.map((q) => [q.quotaKey, q.limit])),
        prices,
      };
    }),
  };
}

// --- signup (TN-01) ------------------------------------------------------------------------

type SignupBody = z.infer<typeof signupBody>;

async function sendVerification(
  services: Services,
  t: {
    tenantId: string;
    userId: string;
    email: string;
    ownerName: string;
    hotelName: string;
    locale: string;
    host: string;
  },
) {
  const previous = await services.redis.get(verifyUserKey(t.userId));
  if (previous) await services.redis.del(verifyKey(previous));
  const token = randomToken(32);
  const hash = sha256(token);
  await services.redis
    .multi()
    .set(verifyKey(hash), `${t.tenantId}:${t.userId}`, 'EX', VERIFY_TTL_S)
    .set(verifyUserKey(t.userId), hash, 'EX', VERIFY_TTL_S)
    .exec();
  const platformHost = services.config.PLATFORM_HOSTS[0] ?? t.host;
  await sendAuthMessage(services, {
    tenantId: t.tenantId,
    to: { email: t.email },
    templateCode: 'tenant_email_verification',
    locale: t.locale,
    userId: t.userId,
    data: {
      owner: { name: t.ownerName },
      hotel: { name: t.hotelName },
      verification: {
        url: appUrl(services, platformHost, `/signup/verify?token=${encodeURIComponent(token)}`),
        expiresInHours: VERIFY_TTL_S / 3600,
      },
    },
    idempotencyKey: `signup-verify:${hash}`,
  });
}

/**
 * Self-service signup: validation, anti-abuse, then ONE transaction (`provisionTenant`) and the
 * verification e-mail. The owner stays PENDING_VERIFICATION (cannot log in) until the e-mail is
 * verified.
 */
export async function signup(services: Services, req: Request, body: SignupBody) {
  const ip = ipOf(req);
  await rateLimit(services, [
    { key: `signup:ip:${ipKey(req)}`, limit: 5, windowS: 3600 },
    { key: `signup:email:${accountKey(body.email)}`, limit: 3, windowS: 3600 },
  ]);
  if (body.website && body.website.trim() !== '') {
    // Honeypot filled: pretend success, create nothing, tell nobody.
    services.logger.warn('signup honeypot triggered', { ip });
    return {
      status: 'pending_verification' as const,
      email: body.email,
      host: `${body.slug}.${baseDomain(services.config) ?? ''}`,
    };
  }
  if (!(await getCaptchaVerifier().verify(body.captchaToken, { ip })))
    throw invalid('captchaToken', 'CAPTCHA_FAILED', 'Captcha verification failed');

  const base = baseDomain(services.config);
  if (!base)
    throw new AppError('SERVICE_UNAVAILABLE', undefined, { detail: 'Signup is not configured' });
  const regional = countryDefaults(body.country);
  if (!regional) throw invalid('country', 'COUNTRY_UNSUPPORTED', 'Country not supported');

  const phone = normalizePhone(body.phone, regional.dialCode);
  if (!phone.ok) throw invalid('phone', 'PHONE_INVALID', 'Invalid phone number');

  const issues = checkPasswordRules(
    body.password,
    { minLength: 10, requireClasses: 3 },
    { email: body.email, name: body.ownerName },
  );
  assertPasswordIssues(issues, 'password');

  const plan = await services.admin.plan.findFirst({
    where: { code: body.planCode, isPublic: true, isActive: true, deletedAt: null },
  });
  if (!plan) throw invalid('planCode', 'PLAN_UNKNOWN', 'Unknown plan');

  const slug = await checkSlug(services, body.slug);
  if (!slug.available)
    throw slug.reason === 'TAKEN'
      ? conflict('Slug already used', { field: 'slug', reason: 'SLUG_TAKEN' })
      : invalid(
          'slug',
          slug.reason === 'RESERVED' ? 'SLUG_RESERVED' : 'SLUG_INVALID',
          'Slug not allowed',
        );

  const host = `${slug.slug}.${base}`;
  const passwordHash = await hashPassword(body.password);
  const settings = await loadBillingSettings(services.admin);
  const docs = await latestDocuments(services);

  let out;
  try {
    out = await inTx(services, (tx) =>
      provisionTenant(tx, {
        slug: slug.slug,
        name: body.hotelName,
        country: body.country,
        timezone: regional.timezone,
        currency: regional.currency,
        locale: body.locale,
        email: body.email,
        phone: phone.e164,
        hostname: host,
        owner: {
          name: body.ownerName,
          email: body.email,
          phone: phone.e164,
          passwordHash,
          status: 'PENDING_VERIFICATION',
        },
        property: { city: body.city },
        planId: plan.id,
        billingCycle: body.cycle,
        settings,
        actor: SYSTEM,
        legalAcceptance: { documents: docs.map((d) => ({ id: d.id, version: d.version })), ip },
      }),
    );
  } catch (err) {
    // Lost a race on the unique slug / host name: same answer as the pre-check.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      throw conflict('Slug already used', { field: 'slug', reason: 'SLUG_TAKEN' });
    throw err;
  }

  await invalidateTenantCaches(services, out.tenantId);
  if (out.invoiceId)
    await renderInvoicePdf(services, out.invoiceId).catch((err: unknown) =>
      services.logger.error('invoice pdf failed', { err: (err as Error).message }),
    );

  const acceptance = {
    acceptTerms: true,
    acceptDpa: true,
    acceptedAt: billingNow().toISOString(),
    documents: docs.map((d) => ({ type: d.type, version: d.version })),
  };
  const userAgent = req.header('user-agent') ?? null;
  await Promise.all([
    writePlatformAudit(services, {
      action: 'tenant.signup',
      entity: 'tenant',
      entityId: out.tenantId,
      after: {
        slug: slug.slug,
        name: body.hotelName,
        plan: plan.code,
        cycle: body.cycle,
        owner: body.email,
        country: body.country,
        ...acceptance,
      },
      ip,
      userAgent,
    }),
    writeTenantAudit(services, {
      tenantId: out.tenantId,
      userId: out.ownerId,
      action: 'tenant.signup',
      entity: 'tenant',
      entityId: out.tenantId,
      after: { slug: slug.slug, plan: plan.code, ...acceptance },
      ip,
      userAgent,
    }),
  ]);

  await sendVerification(services, {
    tenantId: out.tenantId,
    userId: out.ownerId,
    email: body.email,
    ownerName: body.ownerName,
    hotelName: body.hotelName,
    locale: body.locale,
    host,
  });
  return { status: 'pending_verification' as const, email: body.email, host };
}

// --- e-mail verification ---------------------------------------------------------------------

/** Activates the owner and returns where to log in (the tenant host). */
export async function verifyEmail(
  services: Services,
  req: Request,
  body: z.infer<typeof verifyBody>,
) {
  await rateLimit(services, [{ key: `signup-verify:ip:${ipKey(req)}`, limit: 20, windowS: 60 }]);
  const hash = sha256(body.token);
  const stored = await services.redis.get(verifyKey(hash));
  const [tenantId, userId] = stored?.split(':') ?? [];
  const user =
    tenantId && userId
      ? await services.admin.user.findFirst({
          where: { id: userId, tenantId, deletedAt: null },
          include: {
            tenant: { include: { tenantDomains: { take: 1, orderBy: { createdAt: 'asc' } } } },
          },
        })
      : null;
  if (!user || !tenantId)
    throw invalid('token', 'TOKEN_INVALID', 'Invalid or expired verification link');
  const host = user.tenant.tenantDomains[0]?.hostname;
  if (!host) throw invalid('token', 'TOKEN_INVALID', 'Invalid or expired verification link');

  const firstTime = user.status === 'PENDING_VERIFICATION';
  if (firstTime) {
    await services.admin.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    await services.permVersions.bump(tenantId);
  }
  await services.redis.del(verifyKey(hash), verifyUserKey(user.id));

  if (firstTime) {
    const ip = ipOf(req);
    const userAgent = req.header('user-agent') ?? null;
    await Promise.all([
      writePlatformAudit(services, {
        action: 'tenant.owner_email_verified',
        entity: 'tenant',
        entityId: tenantId,
        after: { slug: user.tenant.slug, owner: user.email },
        ip,
        userAgent,
      }),
      writeTenantAudit(services, {
        tenantId,
        userId: user.id,
        action: 'tenant.owner_email_verified',
        entity: 'user',
        entityId: user.id,
        ip,
        userAgent,
      }),
    ]);
    const sub = await services.admin.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    await sendAuthMessage(services, {
      tenantId,
      to: { email: user.email },
      templateCode: 'tenant_welcome',
      locale: user.tenant.defaultLocale,
      userId: user.id,
      data: {
        owner: { name: user.name },
        hotel: { name: user.tenant.name },
        login: { url: appUrl(services, host, '/login') },
        subscription: { planName: sub?.plan.name ?? '' },
        trial: { endDate: sub?.trialEndsAt ? isoOf(sub.trialEndsAt) : '' },
      },
      idempotencyKey: `tenant-welcome:${user.id}`,
    });
  }
  return {
    loginUrl: appUrl(services, host, `/login?verified=1&email=${encodeURIComponent(user.email)}`),
    host,
    email: user.email,
  };
}

/** Sends a new verification link (always the same answer: no account enumeration). */
export async function resendVerification(
  services: Services,
  req: Request,
  body: z.infer<typeof resendBody>,
) {
  await rateLimit(services, [
    { key: `signup-resend:ip:${ipKey(req)}`, limit: 10, windowS: 3600 },
    { key: `signup-resend:acct:${body.slug}:${accountKey(body.email)}`, limit: 3, windowS: 3600 },
  ]);
  const user = await services.admin.user.findFirst({
    where: {
      email: body.email,
      status: 'PENDING_VERIFICATION',
      deletedAt: null,
      tenant: { slug: body.slug, deletedAt: null },
    },
    include: { tenant: { include: { tenantDomains: { take: 1, orderBy: { createdAt: 'asc' } } } } },
  });
  const host = user?.tenant.tenantDomains[0]?.hostname;
  if (user && host)
    await sendVerification(services, {
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
      ownerName: user.name,
      hotelName: user.tenant.name,
      locale: user.tenant.defaultLocale,
      host,
    });
  return { status: 'ok' as const };
}
