import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '@hm/shared';

export const SUBSCRIPTION_PATH = '/settings/subscription';

export const METHODS = ['MIXX', 'MOOV_MONEY', 'CASH', 'CARD'] as const;
export type PayMethod = (typeof METHODS)[number];

export const CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type Cycle = (typeof CYCLES)[number];

export type SubStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export interface QuotaUsage {
  key: string;
  used: number;
  /** `null` = unlimited. */
  limit: number | null;
}

export interface PendingChange {
  planId: string;
  billingCycle: Cycle;
  effectiveAt: string;
  plan: { id: string; code: string; name: string } | null;
}

export interface SubscriptionOverview {
  today: string;
  subscription: {
    status: SubStatus;
    plan: { id: string; code: string; name: string };
    billingCycle: Cycle;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
    cancelAt: string | null;
    pendingChange: PendingChange | null;
  } | null;
  features: string[];
  quotas: QuotaUsage[];
  amountDue: number;
  currency: string;
  credit: number;
}

export interface PlanOffer {
  id: string;
  code: string;
  name: string;
  description: string | null;
  trialDays: number;
  features: string[];
  quotas: Record<string, number | null>;
  prices: Record<Cycle, number | null>;
  currency: string;
}

export interface TenantInvoice {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  total: number;
  amountPaid: number;
  balance: number;
  status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID';
  overdue: boolean;
}

export interface TenantReceipt {
  id: string;
  receiptNumber: string;
  amount: number;
  currency: string;
  method: PayMethod;
  reference: string | null;
  paidAt: string;
  status: string;
}

export interface PaymentInstructions {
  payee: string;
  note: string;
  methods: {
    code: PayMethod;
    label: string;
    merchantNumber?: string;
    referenceLabel?: string;
  }[];
  amountDue: number;
  currency: string;
  invoices: { id: string; number: string; dueDate: string; balance: number }[];
}

export interface TenantDeclaration {
  id: string;
  amount: number;
  currency: string;
  method: PayMethod;
  reference: string | null;
  paidAt: string;
  note: string | null;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  createdAt: string;
}

export type Banner =
  | { kind: 'trial'; severity: 'info' | 'warning'; daysLeft: number; endsAt: string }
  | {
      kind: 'due_soon';
      severity: 'warning';
      invoiceNumber: string;
      dueDate: string;
      daysLeft: number;
      amount: number;
    }
  | {
      kind: 'overdue';
      severity: 'error';
      amount: number;
      dueDate: string;
      suspensionDate: string | null;
    }
  | { kind: 'suspended'; severity: 'error'; amountDue: number; since: string | null }
  | { kind: 'cancelled'; severity: 'error'; purgeDate: string | null }
  | { kind: 'cancel_scheduled'; severity: 'warning'; cancelAt: string };

export interface BannersResponse {
  today: string;
  currency: string;
  status: string;
  readOnly: boolean;
  items: Banner[];
}

/** Integer amount + currency (XOF by default), formatted by `@hm/shared`; never a float. */
export function money(amount: number, currency = 'XOF'): string {
  try {
    return formatMoney({ amount, currency });
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Calendar day as `YYYY-MM-DD`, in the browser's local time. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

export function useFormatDate() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
    return {
      day: (iso: string | null | undefined) =>
        iso ? day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—',
    };
  }, [i18n.language]);
}
