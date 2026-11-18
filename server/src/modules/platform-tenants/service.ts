import type { Prisma } from '@hm/database';
import { SYSTEM_ROLE_KEYS, SYSTEM_ROLE_PERMISSIONS, type SystemRoleKey } from '@hm/shared';
import type { z } from 'zod';
import type { Services } from '../../core/container.js';
import { CORE_EVENTS, publishPlatformEvent } from '../../core/events.js';
import { sendAuthMessage } from '../auth/mailer.js';
import { INVITE_TTL_S, inviteKey, inviteUserKey } from '../auth/service.js';
import { randomToken, sha256 } from '../auth/tokens.js';
import {
  billingNow,
  conflict,
  dateOf,
  inTx,
  invalidateTenantCaches,
  isoOf,
  isoOrNull,
  notFound,
  num,
  platformToday,
  precondition,
  type Actor,
} from '../billing/common.js';
import { localDate } from '../billing/domain.js';
import { renderInvoicePdf } from '../billing/documents.js';
import { addonPriceOn, creditBalance, pendingChangeOf } from '../billing/invoices.js';
import { startSubscription } from '../billing/management.js';
import { serializeInvoice } from '../billing/queries.js';
import { serializePayment } from '../billing/payments.js';
import { loadBillingSettings } from '../billing/settings.js';
import { currentSubscription } from '../billing/subscriptions.js';
import { quotaReport } from '../billing/usage.js';
import type {
  addonAttachBody,
  overrideBody,
  tenantCreateBody,
  tenantListQuery,
  tenantUpdateBody,
} from './schemas.js';

const ROLE_LABELS: Record<SystemRoleKey, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  MANAGER: 'Manager',
  FRONT_DESK: 'Réception',
  HOUSEKEEPING: 'Housekeeping',
  RESTAURANT_STAFF: 'Personnel restauration',
  SPA_STAFF: 'Personnel spa',
  MAINTENANCE: 'Maintenance',
  CASHIER: 'Caisse',
  ACCOUNTANT: 'Comptabilité',
};

async function entitlementsChanged(services: Services, tenantId: string, reason: string) {
  await publishPlatformEvent(services.admin, tenantId, CORE_EVENTS.entitlementsChanged, { reason });
  await invalidateTenantCaches(services, tenantId);
}

function serializeSubscription(
  s: Prisma.SubscriptionGetPayload<{ include: { plan: true } }> | null,
) {
  if (!s) return null;
  return {
    id: s.id,
    status: s.status,
    plan: { id: s.plan.id, code: s.plan.code, name: s.plan.name },
    billingCycle: s.billingCycle,
    trialEndsAt: isoOrNull(s.trialEndsAt),
    currentPeriodStart: isoOrNull(s.currentPeriodStart),
    currentPeriodEnd: isoOrNull(s.currentPeriodEnd),
    graceEndsAt: isoOrNull(s.graceEndsAt),
    cancelAt: isoOrNull(s.cancelAt),
    pendingChange: pendingChangeOf(s),
  };
}

/** SA-20: list / filter / search (subscription status = latest subscription). */
export async function listTenants(services: Services, q: z.infer<typeof tenantListQuery>) {
  const where: Prisma.TenantWhereInput = {
    deletedAt: null,
    ...(q.tenantStatus ? { status: q.tenantStatus } : {}),
    ...(q.tag ? { tags: { has: q.tag } } : {}),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { slug: { contains: q.q, mode: 'insensitive' } },
            { email: { contains: q.q, mode: 'insensitive' } },
            { legalName: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  if (q.status || q.planId) {
    const latest = await services.admin.$queryRaw<{ tenant_id: string }[]>`
      SELECT DISTINCT ON (tenant_id) tenant_id, status::text AS status, plan_id
      FROM subscriptions ORDER BY tenant_id, created_at DESC`;
    const rows = latest as unknown as { tenant_id: string; status: string; plan_id: string }[];
    where.id = {
      in: rows
        .filter(
          (r) => (!q.status || r.status === q.status) && (!q.planId || r.plan_id === q.planId),
        )
        .map((r) => r.tenant_id),
    };
  }
  const [rows, total] = await Promise.all([
    services.admin.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      skip: q.offset,
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } },
        tenantDomains: { where: { type: 'SUBDOMAIN' }, take: 1 },
      },
    }),
    services.admin.tenant.count({ where }),
  ]);
  const balances = await services.admin.platformInvoice.groupBy({
    by: ['tenantId'],
    where: {
      tenantId: { in: rows.map((r) => r.id) },
      status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
    },
    _sum: { total: true, amountPaid: true },
  });
  const due = new Map(
    balances.map((b) => [b.tenantId, num((b._sum.total ?? 0n) - (b._sum.amountPaid ?? 0n))]),
  );
  return {
    total,
    items: rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      country: t.country,
      email: t.email,
      phone: t.phone,
      tags: t.tags,
      host: t.tenantDomains[0]?.hostname ?? null,
      subscription: serializeSubscription(t.subscriptions[0] ?? null),
      amountDue: due.get(t.id) ?? 0,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

/** SA-20: tenant card (contact, plan, status, quota usage, invoices, payments, notes, tags…). */
export async function tenantDetail(services: Services, tenantId: string) {
  const { admin } = services;
  const t = await admin.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    include: { tenantDomains: true },
  });
  if (!t) throw notFound('Tenant');
  const today = localDate(billingNow(), t.timezone);
  const sub = await currentSubscription(admin, tenantId);
  const [usage, ent, invoices, payments, events, addons, overrides, credit, declarations] =
    await Promise.all([
      quotaReport(services, tenantId),
      services.entitlements.resolve(tenantId),
      admin.platformInvoice.findMany({
        where: { tenantId },
        include: { tenant: { select: { id: true, name: true, slug: true } } },
        orderBy: { issueDate: 'desc' },
        take: 50,
      }),
      admin.payment.findMany({
        where: { tenantId },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          paymentAllocations: {
            include: { invoice: { select: { id: true, number: true, status: true } } },
          },
          tenantCredits: true,
        },
        orderBy: { paidAt: 'desc' },
        take: 50,
      }),
      sub
        ? admin.subscriptionEvent.findMany({
            where: { subscriptionId: sub.id },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
      admin.tenantAddon.findMany({
        where: { tenantId },
        include: { addon: true },
        orderBy: { createdAt: 'desc' },
      }),
      admin.tenantOverride.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      creditBalance(admin, tenantId, t.defaultCurrency),
      admin.paymentDeclaration.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    legalName: t.legalName,
    status: t.status,
    country: t.country,
    timezone: t.timezone,
    currency: t.defaultCurrency,
    locale: t.defaultLocale,
    email: t.email,
    phone: t.phone,
    notes: t.notes,
    tags: t.tags,
    allowImpersonation: t.allowImpersonation,
    domains: t.tenantDomains.map((d) => ({
      hostname: d.hostname,
      type: d.type,
      verifiedAt: d.verifiedAt?.toISOString() ?? null,
    })),
    subscription: serializeSubscription(sub),
    entitlements: { features: ent.features, quotas: ent.quotas, planCode: ent.planCode },
    quotaUsage: usage,
    credit: num(credit),
    invoices: invoices.map((i) => serializeInvoice(i, today)),
    payments: payments.map(serializePayment),
    declarations: declarations.map((d) => ({
      id: d.id,
      status: d.status,
      amount: num(d.amount),
      method: d.method,
      reference: d.reference,
      paidAt: isoOf(d.paidAt),
      createdAt: d.createdAt.toISOString(),
    })),
    events: events.map((e) => ({
      from: e.fromStatus,
      to: e.toStatus,
      reason: e.reason,
      actor: e.actor,
      at: e.createdAt.toISOString(),
    })),
    addons: addons.map((a) => ({
      id: a.id,
      addon: { id: a.addon.id, code: a.addon.code, name: a.addon.name },
      status: a.status,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt?.toISOString() ?? null,
    })),
    overrides: overrides.map((o) => ({
      id: o.id,
      kind: o.kind,
      key: o.key,
      value: o.value,
      endsAt: o.endsAt?.toISOString() ?? null,
      note: o.note,
      active: !o.endsAt || o.endsAt > new Date(),
    })),
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * SA-21: manual tenant creation — tenant + verified sub-domain + system roles + owner (INVITED,
 * OWNER role) + security policy + subscription (trial or first invoice), one transaction;
 * then the owner invitation e-mail.
 */
export async function createTenant(
  services: Services,
  body: z.infer<typeof tenantCreateBody>,
  actor: Actor,
) {
  const { admin, config } = services;
  const base = config.PLATFORM_HOSTS[0];
  if (!base) throw precondition('PLATFORM_HOSTS is not configured');
  const hostname = `${body.slug}.${base}`;
  if (await admin.tenant.findUnique({ where: { slug: body.slug } }))
    throw conflict('Slug already used', { field: 'slug' });
  if (await admin.tenantDomain.findUnique({ where: { hostname } }))
    throw conflict('Hostname already used', { hostname });
  const settings = await loadBillingSettings(admin);
  const today = localDate(billingNow(), body.timezone);
  const out = await inTx(services, async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug: body.slug,
        name: body.name,
        legalName: body.legalName ?? null,
        country: body.country,
        timezone: body.timezone,
        defaultCurrency: body.currency,
        defaultLocale: body.locale,
        email: body.email ?? body.owner.email,
        phone: body.phone ?? null,
        tags: body.tags,
        notes: body.notes ?? null,
      },
    });
    await tx.tenantDomain.create({
      data: { tenantId: tenant.id, hostname, type: 'SUBDOMAIN', verifiedAt: new Date() },
    });
    await tx.securityPolicy.create({ data: { tenantId: tenant.id } });
    let ownerRoleId = '';
    for (const key of SYSTEM_ROLE_KEYS) {
      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: ROLE_LABELS[key],
          isSystem: true,
          description: `Rôle système ${key}`,
          rolePermissions: {
            create: SYSTEM_ROLE_PERMISSIONS[key].map((permissionKey) => ({
              tenantId: tenant.id,
              permissionKey,
            })),
          },
        },
      });
      if (key === 'OWNER') ownerRoleId = role.id;
    }
    const owner = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: body.owner.email.toLowerCase(),
        name: body.owner.name,
        phone: body.owner.phone ?? null,
        status: 'INVITED',
      },
    });
    await tx.userRole.create({
      data: { tenantId: tenant.id, userId: owner.id, roleId: ownerRoleId },
    });
    const { invoiceId } = await startSubscription(
      tx,
      {
        tenantId: tenant.id,
        planId: body.planId,
        billingCycle: body.billingCycle,
        today,
        currency: body.currency,
        trialDays: body.trialDays,
      },
      settings,
      actor,
    );
    return { tenantId: tenant.id, ownerId: owner.id, invoiceId };
  });
  if (out.invoiceId)
    await renderInvoicePdf(services, out.invoiceId).catch((err: unknown) =>
      services.logger.error('invoice pdf failed', { err: (err as Error).message }),
    );
  await inviteOwner(services, out.tenantId, out.ownerId, hostname, body.name);
  return tenantDetail(services, out.tenantId);
}

/** Owner invitation (same Redis keys and template as the IAM invitations). */
async function inviteOwner(
  services: Services,
  tenantId: string,
  userId: string,
  hostname: string,
  hotelName: string,
) {
  const user = await services.admin.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomToken(32);
  const hash = sha256(token);
  await services.redis
    .multi()
    .set(inviteKey(tenantId, hash), userId, 'EX', INVITE_TTL_S)
    .set(inviteUserKey(userId), hash, 'EX', INVITE_TTL_S)
    .exec();
  await sendAuthMessage(services, {
    tenantId,
    to: { email: user.email },
    templateCode: 'user_invitation',
    userId,
    data: {
      invitee: { name: user.name },
      inviter: { name: 'Équipe plateforme' },
      hotel: { name: hotelName },
      invitation: {
        role: ROLE_LABELS.OWNER,
        url: `https://${hostname}/accept-invite?token=${encodeURIComponent(token)}`,
        expiresInDays: INVITE_TTL_S / 86_400,
      },
    },
    idempotencyKey: `invite:${hash}`,
  });
}

export async function updateTenant(
  services: Services,
  tenantId: string,
  body: z.infer<typeof tenantUpdateBody>,
) {
  const before = await services.admin.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
  });
  if (!before) throw notFound('Tenant');
  const after = await services.admin.tenant.update({ where: { id: tenantId }, data: body });
  await services.tenants.invalidateTenant(tenantId);
  const pick = (t: typeof before) => ({
    name: t.name,
    legalName: t.legalName,
    email: t.email,
    phone: t.phone,
    timezone: t.timezone,
    notes: t.notes,
    tags: t.tags,
  });
  return { before: pick(before), after: pick(after) };
}

// --- overrides & add-ons (SA-15, EX-01) ---------------------------------------------------

export async function addOverride(
  services: Services,
  tenantId: string,
  body: z.infer<typeof overrideBody>,
) {
  await requireTenant(services, tenantId);
  const o = await services.admin.tenantOverride.create({
    data: {
      tenantId,
      kind: body.kind,
      key: body.key,
      value: body.value as Prisma.InputJsonValue,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      note: body.note ?? null,
    },
  });
  await entitlementsChanged(services, tenantId, 'override.added');
  return o;
}

/** Ends an override now (kept for the history). */
export async function endOverride(services: Services, tenantId: string, overrideId: string) {
  const o = await services.admin.tenantOverride.findFirst({ where: { id: overrideId, tenantId } });
  if (!o) throw notFound('Override');
  const after = await services.admin.tenantOverride.update({
    where: { id: o.id },
    data: { endsAt: new Date() },
  });
  await entitlementsChanged(services, tenantId, 'override.ended');
  return { before: o, after };
}

export async function attachAddon(
  services: Services,
  tenantId: string,
  body: z.infer<typeof addonAttachBody>,
) {
  await requireTenant(services, tenantId);
  const addon = await services.admin.addon.findFirst({
    where: { id: body.addonId, isActive: true },
  });
  if (!addon) throw notFound('Add-on');
  const sub = await currentSubscription(services.admin, tenantId);
  const tenant = await services.admin.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const starts = body.startsAt ?? platformToday();
  const price = sub
    ? await addonPriceOn(
        services.admin,
        addon.id,
        sub.billingCycle as 'MONTHLY',
        tenant.defaultCurrency,
        starts,
      )
    : null;
  const active = await services.admin.tenantAddon.findFirst({
    where: { tenantId, addonId: addon.id, status: 'ACTIVE' },
  });
  if (active) throw conflict('Add-on already active for this tenant', { tenantAddonId: active.id });
  const ta = await services.admin.tenantAddon.create({
    data: {
      tenantId,
      addonId: addon.id,
      startsAt: dateOf(starts),
      endsAt: body.endsAt ? dateOf(body.endsAt) : null,
      status: 'ACTIVE',
      priceSnapshot:
        price !== null
          ? { amount: price.toString(), currency: tenant.defaultCurrency, cycle: sub?.billingCycle }
          : undefined,
    },
  });
  await entitlementsChanged(services, tenantId, 'addon.attached');
  return { id: ta.id, addonId: addon.id, status: ta.status, startsAt: starts };
}

export async function detachAddon(services: Services, tenantId: string, tenantAddonId: string) {
  const ta = await services.admin.tenantAddon.findFirst({
    where: { id: tenantAddonId, tenantId },
  });
  if (!ta) throw notFound('Tenant add-on');
  if (ta.status !== 'ACTIVE') throw precondition('Add-on is not active');
  const after = await services.admin.tenantAddon.update({
    where: { id: ta.id },
    data: { status: 'CANCELLED', endsAt: new Date() },
  });
  await entitlementsChanged(services, tenantId, 'addon.detached');
  return { before: ta, after };
}

export async function requireTenant(services: Services, tenantId: string) {
  const t = await services.admin.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
  if (!t) throw notFound('Tenant');
  return t;
}
