import type { Prisma } from '@hm/database';
import {
  BILLING_EVENTS,
  actorLabel,
  billingNow,
  dateOf,
  emit,
  isoOf,
  isoOrNull,
  notFound,
  type Actor,
  type Db,
  type Tx,
} from './common.js';
import { maxDate, periodEndOf, type Cycle, type IsoDate } from './domain.js';
import { oldestUnpaidDueDate } from './invoices.js';
import {
  evaluate,
  REACTIVABLE_BY_PAYMENT,
  transition,
  type Decision,
  type LifecycleTrigger,
  type SubscriptionFacts,
  type SubStatus,
} from './state-machine.js';
import type { BillingSettings } from './settings.js';

export type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{ include: { plan: true } }>;

/** Current subscription of a tenant (latest row), with its plan. */
export async function currentSubscription(db: Db, tenantId: string) {
  return db.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: { plan: true },
  });
}

export async function requireSubscription(db: Db, tenantId: string) {
  const sub = await currentSubscription(db, tenantId);
  if (!sub) throw notFound('Subscription');
  return sub;
}

export async function factsOf(db: Db, sub: SubscriptionWithPlan): Promise<SubscriptionFacts> {
  return {
    status: sub.status,
    trialEndsAt: isoOrNull(sub.trialEndsAt),
    graceEndsAt: isoOrNull(sub.graceEndsAt),
    cancelAt: isoOrNull(sub.cancelAt),
    suspendedSince: sub.status === 'SUSPENDED' ? isoOrNull(sub.suspendedAt) : null,
    oldestUnpaidDueDate: await oldestUnpaidDueDate(db, sub.tenantId),
  };
}

export interface ApplyTransition {
  trigger: LifecycleTrigger;
  reason?: string;
  actor: Actor;
  /** Extra columns updated with the status. */
  patch?: Prisma.SubscriptionUpdateInput;
  graceEndsAt?: IsoDate | null;
}

/**
 * Applies a state-machine transition: status + `subscription_events` row (from, to, reason,
 * actor) + outbox `subscription.changed` (cache invalidation, realtime) in the caller's tx.
 */
export async function applyTransition(
  tx: Tx,
  sub: { id: string; tenantId: string; status: SubStatus },
  t: ApplyTransition,
) {
  const to = transition(sub.status, t.trigger);
  const at = billingNow();
  // suspended_at = start of the current suspension, cancelled_at = cancellation date; both are
  // cleared when the subscription is live again.
  const dates: Prisma.SubscriptionUpdateInput =
    to === 'SUSPENDED'
      ? sub.status === 'SUSPENDED'
        ? {}
        : { suspendedAt: at }
      : to === 'CANCELLED'
        ? { cancelledAt: at }
        : { suspendedAt: null, cancelledAt: null };
  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      status: to,
      ...dates,
      ...(t.graceEndsAt !== undefined
        ? { graceEndsAt: t.graceEndsAt ? dateOf(t.graceEndsAt) : null }
        : {}),
      ...(t.patch ?? {}),
    },
  });
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      fromStatus: sub.status,
      toStatus: to,
      reason: [t.trigger, t.reason].filter(Boolean).join(': ').slice(0, 500),
      actor: actorLabel(t.actor),
      createdAt: at,
    },
  });
  await emit(tx, sub.tenantId, BILLING_EVENTS.subscriptionChanged, {
    subscriptionId: sub.id,
    from: sub.status,
    to,
    trigger: t.trigger,
  });
  return to;
}

/** Records a non-status change of the subscription (plan change, trial extension…). */
export async function recordSubscriptionChange(
  tx: Tx,
  sub: { id: string; tenantId: string; status: SubStatus },
  reason: string,
  actor: Actor,
) {
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      fromStatus: sub.status,
      toStatus: sub.status,
      reason: reason.slice(0, 500),
      actor: actorLabel(actor),
      createdAt: billingNow(),
    },
  });
  await emit(tx, sub.tenantId, BILLING_EVENTS.subscriptionChanged, {
    subscriptionId: sub.id,
    from: sub.status,
    to: sub.status,
    reason,
  });
  await emit(tx, sub.tenantId, BILLING_EVENTS.entitlementsChanged, { reason });
}

/** Applies the daily evaluation (also used after a payment reversal). */
export async function reevaluate(
  tx: Tx,
  sub: SubscriptionWithPlan,
  today: IsoDate,
  settings: Pick<BillingSettings, 'graceDays' | 'suspensionDays'>,
  actor: Actor,
  reason?: string,
): Promise<Decision | null> {
  const facts = await factsOf(tx, sub);
  const d = evaluate(facts, today, {
    graceDays: settings.graceDays,
    suspensionDays: settings.suspensionDays,
  });
  if (!d) return null;
  await applyTransition(tx, sub, {
    trigger: d.trigger,
    actor,
    ...(reason ? { reason } : {}),
    ...(d.graceEndsAt !== undefined ? { graceEndsAt: d.graceEndsAt } : {}),
  });
  return d;
}

/**
 * Effects of a confirmed payment on the subscription (doc 02 §4.2): the paid period invoices
 * extend `current_period_*`; a TRIALING / PAST_DUE / SUSPENDED subscription whose due
 * invoices are settled becomes ACTIVE. A period that ended before the reactivation restarts
 * on the reactivation day (the paid cycle is never lost).
 */
export async function settleSubscription(
  tx: Tx,
  tenantId: string,
  today: IsoDate,
  actor: Actor,
  paidInvoiceIds: readonly string[],
): Promise<{ from: SubStatus; to: SubStatus } | null> {
  const sub = await currentSubscription(tx, tenantId);
  if (!sub) return null;
  const paid = await tx.platformInvoice.findMany({
    where: {
      id: { in: [...paidInvoiceIds] },
      subscriptionId: sub.id,
      status: 'PAID',
      periodStart: { not: null },
      periodEnd: { not: null },
      kind: { not: 'PRORATA' },
    },
    orderBy: { periodStart: 'asc' },
  });
  let start = isoOrNull(sub.currentPeriodStart);
  let end = isoOrNull(sub.currentPeriodEnd);
  const reactivating = REACTIVABLE_BY_PAYMENT.includes(sub.status) && sub.status !== 'TRIALING';
  for (const inv of paid) {
    const ps = isoOf(inv.periodStart!);
    const pe = isoOf(inv.periodEnd!);
    if (end !== null && pe <= end) continue;
    if (reactivating && pe <= today) {
      // Paid long after the period: the paid cycle starts on the reactivation day.
      start = today;
      end = periodEndOf(today, sub.billingCycle as Cycle);
    } else {
      start = end !== null ? maxDate(ps, end) : ps;
      end = pe;
    }
  }
  const periodPatch: Prisma.SubscriptionUpdateInput = {
    ...(start && start !== isoOrNull(sub.currentPeriodStart)
      ? { currentPeriodStart: dateOf(start) }
      : {}),
    ...(end && end !== isoOrNull(sub.currentPeriodEnd) ? { currentPeriodEnd: dateOf(end) } : {}),
  };

  const owed = await oldestUnpaidDueDate(tx, tenantId);
  const stillOverdue = owed !== null && owed < today;
  const settles =
    REACTIVABLE_BY_PAYMENT.includes(sub.status) &&
    !stillOverdue &&
    (sub.status !== 'TRIALING' || paid.length > 0);
  if (settles) {
    await applyTransition(tx, sub, {
      trigger: 'PAYMENT_SETTLED',
      actor,
      graceEndsAt: null,
      patch: periodPatch,
    });
    return { from: sub.status, to: 'ACTIVE' };
  }
  if (Object.keys(periodPatch).length) {
    await tx.subscription.update({ where: { id: sub.id }, data: periodPatch });
    await recordSubscriptionChange(tx, sub, `period extended to ${end}`, actor);
  }
  return null;
}
