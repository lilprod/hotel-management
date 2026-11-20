import { SYSTEM_ROLE_KEYS, SYSTEM_ROLE_PERMISSIONS, type SystemRoleKey } from '@hm/shared';
import { billingNow, dateOf, type Actor, type Tx } from '../billing/common.js';
import { localDate } from '../billing/domain.js';
import { startSubscription } from '../billing/management.js';
import type { BillingSettings } from '../billing/settings.js';
import { seedBranding, seedDepartments, seedLookups, seedTaxes } from './provision-defaults.js';

export const ROLE_LABELS: Record<SystemRoleKey, string> = {
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

export interface ProvisionInput {
  slug: string;
  name: string;
  legalName?: string | null | undefined;
  country: string;
  timezone: string;
  currency: string;
  locale: string;
  email: string;
  phone?: string | null | undefined;
  tags?: string[] | undefined;
  notes?: string | null | undefined;
  /** `{slug}.{base domain}`. */
  hostname: string;
  owner: {
    name: string;
    email: string;
    phone?: string | null | undefined;
    /** Already hashed (self-signup); absent for an invitation flow. */
    passwordHash?: string | null | undefined;
    /** `INVITED` until the e-mail is verified / the invitation accepted. */
    status: 'INVITED' | 'ACTIVE';
  };
  planId: string;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  /** Overrides the plan's trial days (0 = no trial: first invoice at once). */
  trialDays?: number | undefined;
  /** First property: defaults to the tenant name / country / timezone / currency. */
  property?: {
    name?: string | undefined;
    city?: string | null | undefined;
    address?: string | null | undefined;
  };
  /** Legal documents (TOS, DPA) accepted by the owner at signup (EX-04). */
  legalAcceptance?:
    { documents: ReadonlyArray<{ id: string; version: string }>; ip: string | null } | undefined;
  settings: BillingSettings;
  actor: Actor;
}

export interface ProvisionResult {
  tenantId: string;
  ownerId: string;
  propertyId: string;
  subscriptionId: string;
  invoiceId: string | null;
  taxes: string[];
}

/**
 * Creates a complete tenant inside the caller's transaction (all or nothing): tenant, verified
 * sub-domain, default security policy, system roles + permissions, owner, default property
 * (country / time zone / currency), departments, taxes bound to the country's `tax_rules`,
 * default lookups, branding defaults and the subscription (TRIALING for the plan's trial days).
 * Shared by the Super Admin creation (SA-21) and the public signup (TN-01).
 */
export async function provisionTenant(tx: Tx, input: ProvisionInput): Promise<ProvisionResult> {
  const today = localDate(billingNow(), input.timezone);
  const tenant = await tx.tenant.create({
    data: {
      slug: input.slug,
      name: input.name,
      legalName: input.legalName ?? null,
      country: input.country,
      timezone: input.timezone,
      defaultCurrency: input.currency,
      defaultLocale: input.locale,
      email: input.email,
      phone: input.phone ?? null,
      tags: input.tags ?? [],
      notes: input.notes ?? null,
    },
  });
  await tx.tenantDomain.create({
    data: {
      tenantId: tenant.id,
      hostname: input.hostname,
      type: 'SUBDOMAIN',
      verifiedAt: new Date(),
    },
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

  const property = await tx.property.create({
    data: {
      tenantId: tenant.id,
      name: input.property?.name ?? input.name,
      city: input.property?.city ?? null,
      address: input.property?.address ?? null,
      country: input.country,
      phone: input.phone ?? null,
      email: input.email,
      currency: input.currency,
      timezone: input.timezone,
      businessDate: dateOf(today),
    },
  });

  const owner = await tx.user.create({
    data: {
      tenantId: tenant.id,
      email: input.owner.email.toLowerCase(),
      name: input.owner.name,
      phone: input.owner.phone ?? null,
      status: input.owner.status,
      ...(input.owner.passwordHash
        ? { passwordHash: input.owner.passwordHash, passwordChangedAt: new Date() }
        : {}),
    },
  });
  await tx.userRole.create({
    data: { tenantId: tenant.id, userId: owner.id, roleId: ownerRoleId },
  });
  await tx.userProperty.create({
    data: { tenantId: tenant.id, userId: owner.id, propertyId: property.id },
  });

  if (input.legalAcceptance?.documents.length)
    await tx.legalAcceptance.createMany({
      data: input.legalAcceptance.documents.map((d) => ({
        tenantId: tenant.id,
        legalDocumentId: d.id,
        userId: owner.id,
        version: d.version,
        ip: input.legalAcceptance?.ip ?? null,
      })),
    });

  const ctx = {
    tenantId: tenant.id,
    propertyId: property.id,
    tenantName: input.name,
    country: input.country,
    today,
  };
  await seedDepartments(tx, ctx);
  const taxes = await seedTaxes(tx, ctx);
  await seedLookups(tx, ctx);
  await seedBranding(tx, ctx);

  const { subscription, invoiceId } = await startSubscription(
    tx,
    {
      tenantId: tenant.id,
      planId: input.planId,
      billingCycle: input.billingCycle,
      today,
      currency: input.currency,
      trialDays: input.trialDays,
    },
    input.settings,
    input.actor,
  );
  return {
    tenantId: tenant.id,
    ownerId: owner.id,
    propertyId: property.id,
    subscriptionId: subscription.id,
    invoiceId,
    taxes,
  };
}
