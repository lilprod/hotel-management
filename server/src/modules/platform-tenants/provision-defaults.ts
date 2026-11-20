import { dateOf, type Tx } from '../billing/common.js';
import type { IsoDate } from '../billing/domain.js';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY } from '../branding/service.js';

/** Departments created with the default property (same codes as the demo tenants). */
export const DEFAULT_DEPARTMENTS = [
  { code: 'HEB', name: 'Hébergement' },
  { code: 'RES', name: 'Restauration' },
  { code: 'HK', name: 'Housekeeping' },
  { code: 'MAINT', name: 'Maintenance' },
] as const;

/** Lookup lists with system defaults (sources, guest segments, cancellation reasons). */
export const DEFAULT_LOOKUPS: ReadonlyArray<{
  listKey: string;
  code: string;
  fr: string;
  en: string;
}> = [
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

export interface DefaultsContext {
  tenantId: string;
  propertyId: string;
  tenantName: string;
  country: string;
  today: IsoDate;
}

export async function seedDepartments(tx: Tx, c: DefaultsContext): Promise<void> {
  await tx.department.createMany({
    data: DEFAULT_DEPARTMENTS.map((d) => ({
      tenantId: c.tenantId,
      propertyId: c.propertyId,
      code: d.code,
      name: d.name,
    })),
  });
}

export async function seedLookups(tx: Tx, c: DefaultsContext): Promise<void> {
  const sorts = new Map<string, number>();
  await tx.lookupValue.createMany({
    data: DEFAULT_LOOKUPS.map((l) => {
      const sort = (sorts.get(l.listKey) ?? 0) + 1;
      sorts.set(l.listKey, sort);
      return {
        tenantId: c.tenantId,
        listKey: l.listKey,
        code: l.code,
        labelI18n: { fr: l.fr, en: l.en },
        sort,
        isSystem: true,
      };
    }),
  });
}

export async function seedBranding(tx: Tx, c: DefaultsContext): Promise<void> {
  await tx.branding.create({
    data: {
      tenantId: c.tenantId,
      primaryColor: DEFAULT_PRIMARY,
      secondaryColor: DEFAULT_SECONDARY,
      docHeader: c.tenantName,
      emailSenderName: c.tenantName,
    },
  });
}

/** Applies to every revenue stream (same list as the demo tenants). */
const TAX_APPLIES_TO = ['LODGING', 'FOLIO', 'RESTAURANT', 'SPA', 'ACTIVITY', 'PRODUCT'];

/**
 * Binds the country's standard percentage rule (`tax_rules`, in force today) to the property.
 * Nothing is assumed: no rule for the country means no tax is created.
 */
export async function seedTaxes(tx: Tx, c: DefaultsContext): Promise<string[]> {
  const day = dateOf(c.today);
  const rules = await tx.taxRule.findMany({
    where: {
      country: c.country,
      kind: 'PERCENT',
      effectiveFrom: { lte: day },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: day } }],
    },
    orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }],
  });
  const seen = new Set<string>();
  const created: string[] = [];
  for (const rule of rules) {
    if (seen.has(rule.code)) continue;
    seen.add(rule.code);
    const rate = Number(rule.rate);
    const code = rule.code.startsWith('TVA') ? `TVA${rate}` : rule.code;
    await tx.tax.create({
      data: {
        tenantId: c.tenantId,
        propertyId: c.propertyId,
        taxRuleId: rule.id,
        code,
        name: rule.name ?? rule.code,
        type: 'PERCENT',
        value: rule.rate,
        inclusive: rule.inclusive,
        appliesTo: TAX_APPLIES_TO,
      },
    });
    created.push(code);
  }
  return created;
}
