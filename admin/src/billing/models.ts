import type { Cycle, Invoice, Payment, SubStatus } from './common';

export interface PlanPrice {
  id: string;
  billingCycle: Cycle;
  currency: string;
  amount: number;
  validFrom: string | null;
  validTo: string | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  trialDays: number;
  sort: number;
  isPublic: boolean;
  isActive: boolean;
  deletedAt: string | null;
  features: string[];
  /** `null` = unlimited. */
  quotas: Record<string, number | null>;
  prices: PlanPrice[];
  priceHistory: PlanPrice[];
  subscribers?: number;
}

export interface Addon {
  id: string;
  code: string;
  name: string;
  description: string | null;
  featureKeys: string[];
  quotaDeltas: Record<string, number>;
  sort: number;
  isActive: boolean;
  prices: PlanPrice[];
}

export interface Coupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREE_MONTHS';
  value: string;
  duration: number | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  eligiblePlans: string[];
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface SubscriptionInfo {
  id: string;
  status: SubStatus;
  plan: { id: string; code: string; name: string };
  billingCycle: Cycle;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAt: string | null;
  pendingChange: { planId: string; billingCycle: Cycle; effectiveAt: string } | null;
}

export interface TenantListItem {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  country: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  host: string | null;
  subscription: SubscriptionInfo | null;
  amountDue: number;
  createdAt: string;
}

export interface TenantOverride {
  id: string;
  kind: 'FEATURE' | 'QUOTA' | 'DISCOUNT';
  key: string;
  value: Record<string, unknown>;
  endsAt: string | null;
  note: string | null;
  active: boolean;
}

export interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  country: string;
  timezone: string;
  currency: string;
  locale: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  tags: string[];
  allowImpersonation: boolean;
  domains: { hostname: string; type: string; verifiedAt: string | null }[];
  subscription: SubscriptionInfo | null;
  entitlements: {
    features: string[];
    quotas: Record<string, number | null>;
    planCode: string | null;
  };
  quotaUsage: { key: string; used: number; limit: number | null }[];
  credit: number;
  invoices: Invoice[];
  payments: Payment[];
  declarations: {
    id: string;
    status: string;
    amount: number;
    method: string;
    reference: string | null;
    paidAt: string;
    createdAt: string;
  }[];
  events: {
    from: string | null;
    to: string;
    reason: string | null;
    actor: string | null;
    at: string;
  }[];
  addons: {
    id: string;
    addon: { id: string; code: string; name: string };
    status: string;
    startsAt: string;
    endsAt: string | null;
  }[];
  overrides: TenantOverride[];
  createdAt: string;
}
