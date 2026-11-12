/** Feature keys (doc 02 §1 and §1 bis). Tenant entitlements = plan ∪ add-ons ∪ overrides. */
export const CORE_FEATURE_KEYS = [
  'lodging.core',
  'billing.core',
  'crm.core',
  'housekeeping',
  'maintenance.preventive',
  'restaurant',
  'spa',
  'activities',
  'inventory',
  'hr.shifts',
  'hr.timeclock',
  'loyalty',
  'portal.booking',
  'groups',
  'city_ledger',
  'analytics.advanced',
  'reports.scheduled',
  'security.custom_roles',
  'security.ip_restriction',
  'branding.custom_domain',
  'api',
  'sso',
  'channel_manager',
  'sms',
] as const;

/** Additional feature keys (doc 02 §1 bis, doc 08). */
export const EXTRA_FEATURE_KEYS = [
  'revenue.restrictions',
  'agencies',
  'mice',
  'vouchers',
  'day_pass',
  'precheckin',
  'concierge',
  'transfers',
  'rentals',
  'laundry',
  'tips',
  'commissions',
  'checklists',
  'energy',
  'budget',
  'consolidated_reports',
  'accounting_export',
  'fiscal_invoice',
  'reconciliation',
  'surveys',
  'reviews',
  'guest_chat',
  'marketing',
  'upsell',
  'webhooks',
  'door_locks',
] as const;

export const FEATURE_KEYS = [...CORE_FEATURE_KEYS, ...EXTRA_FEATURE_KEYS] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
