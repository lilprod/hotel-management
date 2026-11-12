import {
  DEFAULT_PLANS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  type DefaultPlanCode,
  type SystemRoleKey,
} from '@hm/shared';
import type { AdminClient } from '../src/index.js';
import { TOGO_TAX_RULE_IDS } from './togo.js';
import {
  ensurePasswordHash,
  seedId,
  SEED_BASE_DOMAIN,
  SEED_COUNTRY,
  SEED_CURRENCY,
  SEED_REFERENCE_DATE,
  SEED_TIMEZONE,
  type Logger,
} from './common.js';
import { planPriceXof } from './platform.js';

/** Everything that differs between the two fictional demo tenants. All names are invented. */

export interface RoomTypeSpec {
  code: string;
  name: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  baseOccupancy: number;
  beds: string;
  sizeM2: number;
  amenities: string[];
  /** Number of rooms of this type. */
  count: number;
  /** Room number prefix (e.g. 'B' for bungalows) and first sequence number. */
  numberPrefix: string;
  numberStart: number;
  floor: string;
  /** Base nightly price in XOF (integer). */
  basePrice: number;
  /** Price during the seeded high season, in XOF (integer). */
  seasonPrice: number;
  extraAdult: number;
  extraChild: number;
}

export interface ProductSpec {
  code: string;
  name: string;
  price: number;
  departmentCode: string;
}

export interface DemoTenantSpec {
  slug: string;
  name: string;
  legalName: string;
  planCode: DefaultPlanCode;
  city: string;
  address: string;
  /** Fictional tax identifiers, to be replaced by the tenant. */
  taxId: string;
  rccm: string;
  primaryColor: string;
  secondaryColor: string;
  /** Fictional business phone (+228 …). */
  businessPhone: string;
  /** Fictional guest numbers: '+228' + this 6-digit prefix + 2-digit index (1..10). */
  guestPhonePrefix: string;
  departments: Array<{ code: string; name: string }>;
  roomTypes: RoomTypeSpec[];
  season: { name: string; from: string; to: string; priority: number };
  products: ProductSpec[];
}

export interface DemoOptions {
  demoPassword?: string;
  log: Logger;
}

export const demoIds = {
  tenant: (slug: string) => seedId(`tenant:${slug}`),
  property: (slug: string) => seedId(`property:${slug}`),
  department: (slug: string, code: string) => seedId(`dept:${slug}:${code}`),
  roomType: (slug: string, code: string) => seedId(`room-type:${slug}:${code}`),
  ratePlan: (slug: string) => seedId(`rate-plan:${slug}:BAR`),
  tax: (slug: string, code: string) => seedId(`tax:${slug}:${code}`),
  product: (slug: string, code: string) => seedId(`product:${slug}:${code}`),
  roleOf: (slug: string, key: SystemRoleKey) => seedId(`role:${slug}:${key}`),
  subscription: (slug: string) => seedId(`subscription:${slug}`),
};

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

/** Lookup lists with system defaults (sources, guest segments, cancellation reasons). */
const LOOKUP_DEFAULTS: Array<{ listKey: string; code: string; fr: string; en: string }> = [
  { listKey: 'reservation_source', code: 'FRONT_DESK', fr: 'Réception', en: 'Front desk' },
  { listKey: 'reservation_source', code: 'PHONE', fr: 'Téléphone', en: 'Phone' },
  { listKey: 'reservation_source', code: 'WHATSAPP', fr: 'WhatsApp', en: 'WhatsApp' },
  { listKey: 'reservation_source', code: 'PORTAL', fr: 'Site / portail', en: 'Website / portal' },
  { listKey: 'reservation_source', code: 'AGENCY', fr: 'Agence', en: 'Travel agency' },
  { listKey: 'guest_segment', code: 'LEISURE', fr: 'Loisirs', en: 'Leisure' },
  { listKey: 'guest_segment', code: 'BUSINESS', fr: 'Affaires', en: 'Business' },
  { listKey: 'guest_segment', code: 'GROUP', fr: 'Groupe', en: 'Group' },
  { listKey: 'guest_segment', code: 'LOCAL', fr: 'Clientèle locale', en: 'Local guest' },
  {
    listKey: 'cancel_reason',
    code: 'CHANGE_OF_PLANS',
    fr: 'Changement de projet',
    en: 'Change of plans',
  },
  { listKey: 'cancel_reason', code: 'NO_RESPONSE', fr: 'Pas de réponse', en: 'No response' },
  { listKey: 'cancel_reason', code: 'PRICE', fr: 'Prix', en: 'Price' },
  { listKey: 'cancel_reason', code: 'DUPLICATE', fr: 'Doublon', en: 'Duplicate' },
  { listKey: 'cancel_reason', code: 'OTHER', fr: 'Autre', en: 'Other' },
];

/** Fictional guest names (invented, not linked to any person). */
const GUEST_NAMES: Array<[string, string]> = [
  ['Afi', 'Ayivi'],
  ['Kossi', 'Dogbé'],
  ['Akossiwa', 'Lawson'],
  ['Komlan', 'Amouzou'],
  ['Essi', 'Togbé'],
  ['Yao', 'Kpodar'],
  ['Mawuli', 'Sossou'],
  ['Adjo', 'Tettey'],
  ['Kodjo', 'Agbéyomé'],
  ['Édèm', 'Fiagan'],
];

const pad = (n: number) => String(n).padStart(2, '0');

export async function seedDemoTenant(
  admin: AdminClient,
  spec: DemoTenantSpec,
  options: DemoOptions,
): Promise<{ tenantId: string; propertyId: string; guestIds: string[] }> {
  const slug = spec.slug;
  const tenantId = demoIds.tenant(slug);
  const propertyId = demoIds.property(slug);
  const log = (msg: string) => options.log(`${slug}: ${msg}`);

  // Tenant and its public hostname.
  await admin.tenant.upsert({
    where: { slug },
    create: {
      id: tenantId,
      slug,
      name: spec.name,
      legalName: spec.legalName,
      country: SEED_COUNTRY,
      phone: spec.businessPhone,
      email: `contact@${slug}.example.invalid`,
      defaultLocale: 'fr',
      defaultCurrency: SEED_CURRENCY,
      timezone: SEED_TIMEZONE,
      notes: 'Données de démonstration fictives (seed L0b).',
      tags: ['demo'],
    },
    update: { name: spec.name, legalName: spec.legalName, timezone: SEED_TIMEZONE },
  });
  const hostname = `${slug}.${SEED_BASE_DOMAIN}`;
  await admin.tenantDomain.upsert({
    where: { hostname },
    create: {
      id: seedId(`tenant-domain:${hostname}`),
      tenantId,
      hostname,
      type: 'SUBDOMAIN',
      verifiedAt: SEED_REFERENCE_DATE,
    },
    update: { tenantId, type: 'SUBDOMAIN' },
  });

  // Subscription in trial. Trial length comes from the shared plan definition via the plan row.
  const plan = await admin.plan.findUniqueOrThrow({ where: { code: spec.planCode } });
  const definition = DEFAULT_PLANS[spec.planCode];
  const trialEnd = new Date(SEED_REFERENCE_DATE.getTime() + definition.trialDays * 86_400_000);
  const monthly = planPriceXof(definition, 'MONTHLY');
  await admin.subscription.upsert({
    where: { id: demoIds.subscription(slug) },
    create: {
      id: demoIds.subscription(slug),
      tenantId,
      planId: plan.id,
      billingCycle: 'MONTHLY',
      status: 'TRIALING',
      trialEndsAt: trialEnd,
      currentPeriodStart: SEED_REFERENCE_DATE,
      currentPeriodEnd: trialEnd,
      priceSnapshot: {
        planCode: spec.planCode,
        billingCycle: 'MONTHLY',
        amount: monthly.toString(),
        currency: SEED_CURRENCY,
      },
    },
    update: {
      planId: plan.id,
      status: 'TRIALING',
      trialEndsAt: trialEnd,
      currentPeriodEnd: trialEnd,
    },
  });

  // Branding and security defaults (schema defaults apply to the policy row).
  await admin.branding.upsert({
    where: { tenantId },
    create: {
      id: seedId(`branding:${slug}`),
      tenantId,
      primaryColor: spec.primaryColor,
      secondaryColor: spec.secondaryColor,
      docHeader: spec.name,
      docFooter: `${spec.legalName} - NIF ${spec.taxId} - RCCM ${spec.rccm}`,
      emailSenderName: spec.name,
    },
    update: {
      primaryColor: spec.primaryColor,
      secondaryColor: spec.secondaryColor,
      docHeader: spec.name,
      docFooter: `${spec.legalName} - NIF ${spec.taxId} - RCCM ${spec.rccm}`,
      emailSenderName: spec.name,
    },
  });
  await admin.securityPolicy.upsert({
    where: { tenantId },
    create: { id: seedId(`security-policy:${slug}`), tenantId },
    update: {},
  });

  // System roles and their permissions (shared mapping, doc 05 §2).
  for (const key of SYSTEM_ROLE_KEYS) {
    const roleId = demoIds.roleOf(slug, key);
    const name = ROLE_LABELS[key];
    await admin.role.upsert({
      where: { id: roleId },
      create: { id: roleId, tenantId, name, isSystem: true, description: `Rôle système ${key}` },
      update: { name, isSystem: true },
    });
    const permissions = SYSTEM_ROLE_PERMISSIONS[key];
    await admin.rolePermission.deleteMany({
      where: { roleId, permissionKey: { notIn: [...permissions] } },
    });
    await admin.rolePermission.createMany({
      data: permissions.map((permissionKey) => ({
        id: seedId(`role-permission:${slug}:${key}:${permissionKey}`),
        tenantId,
        roleId,
        permissionKey,
      })),
      skipDuplicates: true,
    });
  }
  log(`${SYSTEM_ROLE_KEYS.length} system roles with permissions`);

  // Property (single establishment), in XOF and Africa/Lome.
  await admin.property.upsert({
    where: { id: propertyId },
    create: {
      id: propertyId,
      tenantId,
      name: spec.name,
      address: spec.address,
      city: spec.city,
      country: SEED_COUNTRY,
      phone: spec.businessPhone,
      email: `reception@${slug}.example.invalid`,
      taxId: spec.taxId,
      rccm: spec.rccm,
      currency: SEED_CURRENCY,
      timezone: SEED_TIMEZONE,
      checkinTime: '14:00',
      checkoutTime: '12:00',
      businessDate: SEED_REFERENCE_DATE,
    },
    update: {
      name: spec.name,
      address: spec.address,
      city: spec.city,
      businessDate: SEED_REFERENCE_DATE,
    },
  });

  // Owner user (only when a demo password is provided).
  const guestIds: string[] = [];
  if (options.demoPassword) {
    const email = `owner@${slug}.example.invalid`;
    const existing = await admin.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    const passwordHash = await ensurePasswordHash(existing?.passwordHash, options.demoPassword);
    const userId = seedId(`user:${slug}:owner`);
    const user = await admin.user.upsert({
      where: { tenantId_email: { tenantId, email } },
      create: {
        id: userId,
        tenantId,
        email,
        name: 'Propriétaire démo',
        passwordHash,
        status: 'ACTIVE',
      },
      update: { passwordHash, status: 'ACTIVE' },
    });
    await admin.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: demoIds.roleOf(slug, 'OWNER') } },
      create: {
        id: seedId(`user-role:${slug}:owner`),
        tenantId,
        userId: user.id,
        roleId: demoIds.roleOf(slug, 'OWNER'),
      },
      update: {},
    });
    await admin.userProperty.upsert({
      where: { userId_propertyId: { userId: user.id, propertyId } },
      create: { id: seedId(`user-property:${slug}:owner`), tenantId, userId: user.id, propertyId },
      update: {},
    });
    log(`owner user ${email} ready`);
  } else {
    log('WARNING SEED_DEMO_PASSWORD not set, owner user skipped');
  }

  // Departments.
  for (const dept of spec.departments) {
    await admin.department.upsert({
      where: { tenantId_propertyId_code: { tenantId, propertyId, code: dept.code } },
      create: {
        id: demoIds.department(slug, dept.code),
        tenantId,
        propertyId,
        code: dept.code,
        name: dept.name,
      },
      update: { name: dept.name },
    });
  }

  // Taxes of the establishment, linked to the global Togo tax rules.
  await admin.tax.upsert({
    where: { tenantId_propertyId_code: { tenantId, propertyId, code: 'TVA18' } },
    create: {
      id: demoIds.tax(slug, 'TVA18'),
      tenantId,
      propertyId,
      taxRuleId: TOGO_TAX_RULE_IDS.VAT_STANDARD,
      code: 'TVA18',
      name: 'TVA 18 %',
      type: 'PERCENT',
      value: '18',
      inclusive: false,
      appliesTo: ['LODGING', 'FOLIO', 'RESTAURANT', 'SPA', 'ACTIVITY', 'PRODUCT'],
    },
    update: { name: 'TVA 18 %', value: '18' },
  });
  await admin.tax.upsert({
    where: { tenantId_propertyId_code: { tenantId, propertyId, code: 'TAXE_SEJOUR' } },
    create: {
      id: demoIds.tax(slug, 'TAXE_SEJOUR'),
      tenantId,
      propertyId,
      taxRuleId: TOGO_TAX_RULE_IDS.TOURIST_TAX_EXAMPLE,
      code: 'TAXE_SEJOUR',
      name: 'Taxe de séjour (exemple) [À CONFIRMER]',
      type: 'FIXED_PER_PERSON_NIGHT',
      value: '1000',
      inclusive: false,
      appliesTo: ['LODGING'],
    },
    update: { name: 'Taxe de séjour (exemple) [À CONFIRMER]', value: '1000' },
  });

  // Room types, rooms, rate plan, season and rates.
  for (const rt of spec.roomTypes) {
    await admin.roomType.upsert({
      where: { tenantId_propertyId_code: { tenantId, propertyId, code: rt.code } },
      create: {
        id: demoIds.roomType(slug, rt.code),
        tenantId,
        propertyId,
        code: rt.code,
        name: rt.name,
        description: rt.description,
        maxAdults: rt.maxAdults,
        maxChildren: rt.maxChildren,
        baseOccupancy: rt.baseOccupancy,
        beds: rt.beds,
        sizeM2: rt.sizeM2,
        amenities: rt.amenities,
      },
      update: { name: rt.name, description: rt.description, maxAdults: rt.maxAdults },
    });
    for (let i = 0; i < rt.count; i += 1) {
      const number = `${rt.numberPrefix}${pad(rt.numberStart + i)}`;
      await admin.room.upsert({
        where: { tenantId_propertyId_number: { tenantId, propertyId, number } },
        create: {
          id: seedId(`room:${slug}:${number}`),
          tenantId,
          propertyId,
          roomTypeId: demoIds.roomType(slug, rt.code),
          number,
          floor: rt.floor,
        },
        update: { roomTypeId: demoIds.roomType(slug, rt.code), floor: rt.floor },
      });
    }
  }
  const roomCount = spec.roomTypes.reduce((sum, rt) => sum + rt.count, 0);
  log(`${spec.roomTypes.length} room types, ${roomCount} rooms`);

  const ratePlanId = demoIds.ratePlan(slug);
  await admin.ratePlan.upsert({
    where: { tenantId_propertyId_code: { tenantId, propertyId, code: 'BAR' } },
    create: {
      id: ratePlanId,
      tenantId,
      propertyId,
      code: 'BAR',
      name: 'Tarif public (best available)',
      mealPlan: 'RO',
      isPublic: true,
      currency: SEED_CURRENCY,
    },
    update: { name: 'Tarif public (best available)' },
  });

  const seasonId = seedId(`season:${slug}:${spec.season.name}`);
  await admin.season.upsert({
    where: { id: seasonId },
    create: {
      id: seasonId,
      tenantId,
      propertyId,
      name: spec.season.name,
      fromDate: new Date(spec.season.from),
      toDate: new Date(spec.season.to),
      priority: spec.season.priority,
    },
    update: {
      name: spec.season.name,
      fromDate: new Date(spec.season.from),
      toDate: new Date(spec.season.to),
      priority: spec.season.priority,
    },
  });

  for (const rt of spec.roomTypes) {
    const roomTypeId = demoIds.roomType(slug, rt.code);
    const rateRows: Array<{ key: string; seasonId: string | null; price: number }> = [
      { key: 'base', seasonId: null, price: rt.basePrice },
      { key: 'season', seasonId, price: rt.seasonPrice },
    ];
    for (const row of rateRows) {
      const id = seedId(`rate:${slug}:${rt.code}:${row.key}`);
      const data = {
        price: BigInt(row.price),
        extraAdult: BigInt(rt.extraAdult),
        extraChild: BigInt(rt.extraChild),
        currency: SEED_CURRENCY,
      };
      await admin.rate.upsert({
        where: { id },
        create: {
          id,
          tenantId,
          ratePlanId,
          roomTypeId,
          seasonId: row.seasonId,
          ...data,
        },
        update: data,
      });
    }
  }
  log('1 rate plan, 1 season, rates per room type (base + season)');

  // Lookup defaults.
  for (const lv of LOOKUP_DEFAULTS) {
    const labelI18n = { fr: lv.fr, en: lv.en };
    await admin.lookupValue.upsert({
      where: { tenantId_listKey_code: { tenantId, listKey: lv.listKey, code: lv.code } },
      create: {
        id: seedId(`lookup:${slug}:${lv.listKey}:${lv.code}`),
        tenantId,
        listKey: lv.listKey,
        code: lv.code,
        labelI18n,
        isSystem: true,
        sort: LOOKUP_DEFAULTS.filter((x) => x.listKey === lv.listKey).indexOf(lv) + 1,
      },
      update: { labelI18n },
    });
  }

  // Products (retail items sold through the folio/POS).
  for (const p of spec.products) {
    const data = {
      name: p.name,
      price: BigInt(p.price),
      currency: SEED_CURRENCY,
      departmentCode: p.departmentCode,
      taxId: demoIds.tax(slug, 'TVA18'),
    };
    await admin.product.upsert({
      where: { id: demoIds.product(slug, p.code) },
      create: { id: demoIds.product(slug, p.code), tenantId, propertyId, ...data },
      update: data,
    });
  }

  // Ten fictional guests with fictional +228 numbers.
  for (let i = 0; i < GUEST_NAMES.length; i += 1) {
    const [firstName, lastName] = GUEST_NAMES[i] ?? ['Client', `Démo ${i + 1}`];
    const id = seedId(`guest:${slug}:${i + 1}`);
    const phone = `+228${spec.guestPhonePrefix}${pad(i + 1)}`;
    const data = {
      firstName,
      lastName,
      phone,
      email: `client${i + 1}@${slug}.example.invalid`,
      nationality: 'TG',
      tags: ['demo'],
    };
    await admin.guest.upsert({
      where: { id },
      create: { id, tenantId, ...data },
      update: data,
    });
    guestIds.push(id);
  }
  log(`${GUEST_NAMES.length} guests, ${spec.products.length} products`);

  return { tenantId, propertyId, guestIds };
}
