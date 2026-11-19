import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '@hm/shared';

import { useMeStore } from '../auth/session';
import type { PlatformRole } from '../auth/session';

export const METHODS = ['MIXX', 'MOOV_MONEY', 'CASH', 'CARD'] as const;
export type PayMethod = (typeof METHODS)[number];

export const SUB_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];

export const CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type Cycle = (typeof CYCLES)[number];

export const INVOICE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING_VALIDATION', 'CONFIRMED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface TenantRef {
  id: string;
  name: string;
  slug: string;
}

export interface Invoice {
  id: string;
  number: string;
  tenant: TenantRef;
  issueDate: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  balance: number;
  status: InvoiceStatus;
  overdue: boolean;
  createdAt: string;
}

export interface PaymentAllocation {
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  amount: number;
}

export interface Payment {
  id: string;
  tenant: TenantRef;
  amount: number;
  currency: string;
  method: PayMethod;
  reference: string | null;
  paidAt: string;
  status: PaymentStatus;
  attachmentFileId: string | null;
  note: string | null;
  recordedBy: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  receiptNumber: string | null;
  declarationId: string | null;
  plannedAllocations: { invoiceId: string; amount: number }[];
  allocations: PaymentAllocation[];
  credit: number;
  createdAt: string;
}

/** Calendar day as `YYYY-MM-DD` (the platform runs on Africa/Lome = UTC+0, no DST). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** First day of the month `months` away from the month of `iso`. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

/** Integer amount + currency (XOF by default), formatted by `@hm/shared`; never a float. */
export function money(amount: number, currency = 'XOF'): string {
  try {
    return formatMoney({ amount, currency });
  } catch {
    return `${amount} ${currency}`;
  }
}

export function useFormatDate() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
    const dt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
    return {
      day: (iso: string | null | undefined) =>
        iso ? day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—',
      dateTime: (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '—'),
    };
  }, [i18n.language]);
}

/** What the current platform role may do. The API enforces the same rules (guard per route). */
export interface Abilities {
  role: PlatformRole | null;
  /** Record / validate / reverse payments, void invoices, review declarations. */
  finance: boolean;
  /** Tenant lifecycle, plans, add-ons, coupons, settings. */
  admin: boolean;
  /** Notes and tags of a tenant. */
  editTenantNotes: boolean;
}

export function abilitiesFor(role: PlatformRole | null): Abilities {
  const isSuper = role === 'SUPER_ADMIN';
  return {
    role,
    finance: isSuper || role === 'FINANCE',
    admin: isSuper,
    editTenantNotes: isSuper || role === 'SUPPORT',
  };
}

export function useAbilities(): Abilities {
  const role = useMeStore((s) => s.me?.role ?? null);
  return useMemo(() => abilitiesFor(role), [role]);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
