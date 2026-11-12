import { CORE_FEATURE_KEYS, type FeatureKey } from './features.js';
import type { QuotaSet } from './quotas.js';

export const DEFAULT_PLAN_CODES = ['STANDARD', 'MEDIUM', 'PREMIUM'] as const;
export type DefaultPlanCode = (typeof DEFAULT_PLAN_CODES)[number];

export interface PlanDefinition {
  code: DefaultPlanCode;
  /** Indicative monthly price in XOF (integer minor units; XOF has 0 decimals). */
  monthlyPriceXof: number;
  trialDays: number;
  /** Discounts in basis points (500 = 5 %). */
  quarterlyDiscountBp: number;
  yearlyDiscountBp: number;
  quotas: QuotaSet;
  features: readonly FeatureKey[];
}

// Standard: staff "tasks + messaging" are not feature-gated (no hr.* key); portal is storefront-only.
const STANDARD_FEATURES: readonly FeatureKey[] = [
  'lodging.core',
  'billing.core',
  'crm.core',
  'housekeeping',
];

// Medium: partial advanced analytics (analytics.advanced without reports.scheduled).
const MEDIUM_FEATURES: readonly FeatureKey[] = [
  ...STANDARD_FEATURES,
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
  'security.custom_roles',
  'security.ip_restriction',
  'sms',
];

// Premium: every core feature. Extra (doc 08) features are add-ons / rollouts, not in default plans.
const PREMIUM_FEATURES: readonly FeatureKey[] = [...CORE_FEATURE_KEYS];

export const DEFAULT_PLANS: Record<DefaultPlanCode, PlanDefinition> = {
  STANDARD: {
    code: 'STANDARD',
    monthlyPriceXof: 25_000,
    trialDays: 14,
    quarterlyDiscountBp: 500,
    yearlyDiscountBp: 1500,
    quotas: { properties: 1, units: 20, users: 5, storage_mb: 1024, sms_per_month: 0 },
    features: STANDARD_FEATURES,
  },
  MEDIUM: {
    code: 'MEDIUM',
    monthlyPriceXof: 50_000,
    trialDays: 14,
    quarterlyDiscountBp: 500,
    yearlyDiscountBp: 1500,
    quotas: { properties: 2, units: 60, users: 15, storage_mb: 5 * 1024, sms_per_month: 200 },
    features: MEDIUM_FEATURES,
  },
  PREMIUM: {
    code: 'PREMIUM',
    monthlyPriceXof: 100_000,
    trialDays: 30,
    quarterlyDiscountBp: 500,
    yearlyDiscountBp: 1500,
    quotas: {
      properties: null,
      units: null,
      users: null,
      storage_mb: 20 * 1024,
      sms_per_month: 1000,
    },
    features: PREMIUM_FEATURES,
  },
};
