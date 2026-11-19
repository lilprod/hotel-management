import { FEATURE_KEYS } from '@hm/shared';

/** Feature keys grouped for the plan editor (a key missing here lands in "other"). */
export const FEATURE_GROUPS: { id: string; keys: readonly string[] }[] = [
  {
    id: 'core',
    keys: [
      'lodging.core',
      'billing.core',
      'crm.core',
      'housekeeping',
      'maintenance.preventive',
      'checklists',
    ],
  },
  {
    id: 'services',
    keys: [
      'restaurant',
      'spa',
      'activities',
      'inventory',
      'laundry',
      'concierge',
      'transfers',
      'rentals',
      'tips',
      'day_pass',
      'vouchers',
    ],
  },
  {
    id: 'sales',
    keys: [
      'portal.booking',
      'groups',
      'agencies',
      'mice',
      'revenue.restrictions',
      'channel_manager',
      'loyalty',
      'marketing',
      'upsell',
      'precheckin',
      'guest_chat',
      'surveys',
      'reviews',
    ],
  },
  {
    id: 'finance',
    keys: [
      'city_ledger',
      'commissions',
      'budget',
      'consolidated_reports',
      'accounting_export',
      'fiscal_invoice',
      'reconciliation',
    ],
  },
  { id: 'operations', keys: ['hr.shifts', 'hr.timeclock', 'energy', 'door_locks'] },
  {
    id: 'platform',
    keys: [
      'analytics.advanced',
      'reports.scheduled',
      'security.custom_roles',
      'security.ip_restriction',
      'branding.custom_domain',
      'api',
      'sso',
      'sms',
      'webhooks',
    ],
  },
];

/** Groups restricted to the known feature keys, plus an "other" group for any key not listed. */
export function groupedFeatures(): { id: string; keys: string[] }[] {
  const known = new Set<string>(FEATURE_KEYS);
  const used = new Set<string>();
  const groups = FEATURE_GROUPS.map((g) => ({
    id: g.id,
    keys: g.keys.filter((k) => known.has(k)),
  })).filter((g) => g.keys.length > 0);
  groups.forEach((g) => g.keys.forEach((k) => used.add(k)));
  const other = FEATURE_KEYS.filter((k) => !used.has(k));
  return other.length ? [...groups, { id: 'other', keys: [...other] }] : groups;
}
