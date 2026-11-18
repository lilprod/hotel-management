import type { AdminClient, Prisma, TransactionClient } from '@hm/database';
import type { Services } from '../../core/container.js';
import { CORE_EVENTS, publishPlatformEvent } from '../../core/events.js';
import { AppError } from '../../lib/errors.js';
import { fromIsoDate, localDate, toIsoDate, type IsoDate } from './domain.js';

export type Tx = TransactionClient;
export type Db = AdminClient | TransactionClient;

/** Billing domain events (outbox, tenant of the platform operation). */
export const BILLING_EVENTS = {
  invoiceIssued: 'platform_invoice.issued',
  invoiceVoided: 'platform_invoice.voided',
  paymentRecorded: 'payment.recorded',
  paymentConfirmed: 'payment.confirmed',
  paymentReversed: 'payment.reversed',
  declarationSubmitted: 'payment_declaration.submitted',
  declarationReviewed: 'payment_declaration.reviewed',
  subscriptionChanged: CORE_EVENTS.subscriptionChanged,
  entitlementsChanged: CORE_EVENTS.entitlementsChanged,
} as const;

/** Who performed a billing operation (platform user, tenant user, or a job). */
export interface Actor {
  kind: 'platform' | 'tenant' | 'system';
  id: string | null;
}

export const SYSTEM_ACTOR: Actor = { kind: 'system', id: null };

export const actorLabel = (a: Actor) => (a.id ? `${a.kind}:${a.id}` : a.kind);

/** Billing clock: `BILLING_NOW` in tests (fake clock), wall clock otherwise. */
let clockOverride: (() => Date) | null = null;
export function setBillingClock(fn: (() => Date) | null): void {
  clockOverride = fn;
}
export const billingNow = (): Date => (clockOverride ? clockOverride() : new Date());

export const dateOf = (iso: IsoDate) => fromIsoDate(iso);
export const isoOf = (d: Date) => toIsoDate(d);
export const isoOrNull = (d: Date | null | undefined) => (d ? toIsoDate(d) : null);
export const num = (v: bigint | number) => Number(v);

export interface TenantClock {
  id: string;
  timezone: string;
  today: IsoDate;
}

export async function tenantClock(db: Db, tenantId: string, now = billingNow()) {
  const t = await db.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { id: true, timezone: true },
  });
  if (!t) throw new AppError('NOT_FOUND', undefined, { detail: 'Tenant not found' });
  return { id: t.id, timezone: t.timezone, today: localDate(now, t.timezone) } as TenantClock;
}

/** Serialises billing operations of one tenant (row lock until the transaction ends). */
export async function lockTenantBilling(tx: Tx, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
}

export function emit(tx: Db, tenantId: string, type: string, payload: Prisma.InputJsonValue = {}) {
  return publishPlatformEvent(tx, tenantId, type, payload);
}

/** Immediate cache invalidation after commit (the outbox relay does it again asynchronously). */
export async function invalidateTenantCaches(services: Services, tenantId: string): Promise<void> {
  await Promise.all([
    services.tenants.invalidateTenant(tenantId),
    services.entitlements.invalidate(tenantId),
  ]);
}

/** Runs `fn` in an admin transaction with a generous timeout (PDF / mail happen after commit). */
export function inTx<T>(services: Services, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return services.admin.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
}

export const notFound = (what: string) =>
  new AppError('NOT_FOUND', undefined, { detail: `${what} not found` });

export const conflict = (detail: string, meta?: Record<string, unknown>) =>
  new AppError('CONFLICT', undefined, { detail, ...(meta ? { meta } : {}) });

export const precondition = (detail: string, meta?: Record<string, unknown>) =>
  new AppError('PRECONDITION_FAILED', undefined, { detail, ...(meta ? { meta } : {}) });

export const invalid = (path: string, message: string) =>
  new AppError('VALIDATION_ERROR', undefined, {
    errors: [{ path, message, code: 'custom' }],
  });
