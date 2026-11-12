import type { AdminClient } from '@hm/database';
import { PLATFORM_DOMAIN } from './env.js';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export type SubStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export interface TenantFixtureOptions {
  label?: string;
  features?: string[];
  quotas?: Record<string, number | null>;
  subscription?: SubStatus | null;
  /** Permissions of the role given to the main user. */
  permissions?: string[];
}

export interface TenantFixture {
  tenantId: string;
  slug: string;
  host: string;
  planId: string;
  propertyId: string;
  userId: string;
  roleId: string;
}

/** Plan + tenant + verified sub-domain + subscription + property + user with one role. */
export async function createTenantFixture(
  admin: AdminClient,
  opts: TenantFixtureOptions = {},
): Promise<TenantFixture> {
  const u = uniq();
  const label = (opts.label ?? 'T').toLowerCase();
  const plan = await admin.plan.create({
    data: {
      code: `P-${u}`,
      name: `Plan ${u}`,
      planFeatures: {
        create: (opts.features ?? ['lodging.core', 'billing.core']).map((featureKey) => ({
          featureKey,
        })),
      },
      planQuotas: {
        create: Object.entries(opts.quotas ?? { users: 5 }).map(([quotaKey, limit]) => ({
          quotaKey,
          limit,
        })),
      },
    },
  });
  const slug = `${label}-${u}`;
  const tenant = await admin.tenant.create({
    data: { slug, name: `Hotel ${label.toUpperCase()}`, country: 'TG', timezone: 'Africa/Lome' },
  });
  const host = `${slug}.${PLATFORM_DOMAIN}`;
  await admin.tenantDomain.create({
    data: { tenantId: tenant.id, hostname: host, type: 'SUBDOMAIN', verifiedAt: new Date() },
  });
  if (opts.subscription !== null)
    await admin.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        billingCycle: 'MONTHLY',
        status: opts.subscription ?? 'ACTIVE',
      },
    });
  const property = await admin.property.create({
    data: {
      tenantId: tenant.id,
      name: `Property ${label}`,
      country: 'TG',
      timezone: 'Africa/Lome',
      businessDate: new Date('2026-11-12'),
    },
  });
  const user = await admin.user.create({
    data: {
      tenantId: tenant.id,
      email: `user-${u}@${label}.test`,
      name: `User ${label.toUpperCase()}`,
    },
  });
  const role = await admin.role.create({
    data: {
      tenantId: tenant.id,
      name: `Role ${u}`,
      rolePermissions: {
        create: (opts.permissions ?? ['*']).map((permissionKey) => ({
          tenantId: tenant.id,
          permissionKey,
        })),
      },
    },
  });
  await admin.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: role.id } });
  await admin.userProperty.create({
    data: { tenantId: tenant.id, userId: user.id, propertyId: property.id },
  });
  return {
    tenantId: tenant.id,
    slug,
    host,
    planId: plan.id,
    propertyId: property.id,
    userId: user.id,
    roleId: role.id,
  };
}

/** Adds a user with its own role to an existing tenant. */
export async function addUser(admin: AdminClient, tenantId: string, permissions: string[]) {
  const u = uniq();
  const user = await admin.user.create({
    data: { tenantId, email: `extra-${u}@x.test`, name: `Extra ${u}` },
  });
  const role = await admin.role.create({
    data: {
      tenantId,
      name: `Role ${u}`,
      rolePermissions: {
        create: permissions.map((permissionKey) => ({ tenantId, permissionKey })),
      },
    },
  });
  await admin.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
  return user.id;
}
