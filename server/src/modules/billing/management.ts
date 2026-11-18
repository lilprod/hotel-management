import type { Prisma } from '@hm/database';
import type { Services } from '../../core/container.js';
import {
  BILLING_EVENTS,
  dateOf,
  emit,
  inTx,
  invalid,
  invalidateTenantCaches,
  isoOf,
  isoOrNull,
  lockTenantBilling,
  notFound,
  num,
  precondition,
  tenantClock,
  type Actor,
  type Tx,
} from './common.js';
import { addDays, diffDays, periodEndOf, prorata, type Cycle, type IsoDate } from './domain.js';
import { renderInvoicePdf } from './documents.js';
import {
  ensurePeriodInvoice,
  issueInvoice,
  LINE,
  paidAmount,
  pendingChangeOf,
  periodLines,
  planPriceOn,
  type PendingChange,
} from './invoices.js';
import { loadBillingSettings, type BillingSettings } from './settings.js';
import {
  applyTransition,
  currentSubscription,
  recordSubscriptionChange,
  requireSubscription,
  type SubscriptionWithPlan,
} from './subscriptions.js';
import { quotaViolations } from './usage.js';

async function activePlan(db: Tx, planId: string) {
  const plan = await db.plan.findFirst({ where: { id: planId, deletedAt: null, isActive: true } });
  if (!plan) throw notFound('Plan');
  return plan;
}

/**
 * Starts the subscription of a new tenant: TRIALING for the plan's trial days (0 = none) or
 * ACTIVE with the first period invoiced at once (doc 02 §3 "à la souscription").
 */
export async function startSubscription(
  tx: Tx,
  input: {
    tenantId: string;
    planId: string;
    billingCycle: Cycle;
    today: IsoDate;
    currency: string;
    trialDays?: number | undefined;
  },
  settings: BillingSettings,
  actor: Actor,
) {
  const plan = await activePlan(tx, input.planId);
  const trialDays = input.trialDays ?? plan.trialDays;
  const trialing = trialDays > 0;
  const trialEnd = addDays(input.today, trialDays);
  const periodEnd = trialing ? trialEnd : periodEndOf(input.today, input.billingCycle);
  const sub = await tx.subscription.create({
    data: {
      tenantId: input.tenantId,
      planId: plan.id,
      billingCycle: input.billingCycle,
      status: trialing ? 'TRIALING' : 'ACTIVE',
      trialEndsAt: trialing ? dateOf(trialEnd) : null,
      currentPeriodStart: dateOf(input.today),
      currentPeriodEnd: dateOf(periodEnd),
    },
    include: { plan: true },
  });
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      fromStatus: null,
      toStatus: sub.status,
      reason: trialing ? `subscription started, trial ${trialDays} days` : 'subscription started',
      actor: actor.id ? `${actor.kind}:${actor.id}` : actor.kind,
    },
  });
  await emit(tx, input.tenantId, BILLING_EVENTS.subscriptionChanged, {
    subscriptionId: sub.id,
    from: null,
    to: sub.status,
  });
  let invoiceId: string | null = null;
  if (!trialing) {
    const lines = await periodLines(
      tx,
      sub,
      sub.planId,
      input.billingCycle,
      input.currency,
      input.today,
    );
    const inv = await issueInvoice(
      tx,
      {
        tenantId: input.tenantId,
        subscriptionId: sub.id,
        issueDate: input.today,
        dueDate: addDays(input.today, settings.paymentTermsDays),
        periodStart: input.today,
        periodEnd,
        currency: input.currency,
        lines,
      },
      settings,
    );
    invoiceId = inv.id;
  }
  return { subscription: sub, invoiceId };
}

/** Voids an unpaid period invoice (re-issued by the caller or the next lifecycle run). */
async function voidUnpaidPeriodInvoice(tx: Tx, subscriptionId: string, periodStart: IsoDate) {
  const inv = await tx.platformInvoice.findFirst({
    where: {
      subscriptionId,
      periodStart: dateOf(periodStart),
      status: { in: ['ISSUED', 'OVERDUE'] },
      platformInvoiceLines: { none: { label: { startsWith: LINE.prorata } } },
    },
  });
  if (!inv || (await paidAmount(tx, inv.id)) > 0n) return null;
  await tx.platformInvoice.update({ where: { id: inv.id }, data: { status: 'VOID' } });
  await emit(tx, inv.tenantId, BILLING_EVENTS.invoiceVoided, {
    invoiceId: inv.id,
    reason: 'superseded',
  });
  return inv.id;
}

export interface PlanChangeInput {
  planId: string;
  billingCycle?: Cycle | undefined;
}

export interface PlanChangeResult {
  mode: 'immediate' | 'scheduled';
  effectiveAt: IsoDate;
  invoiceIds: string[];
  pendingChange: PendingChange | null;
}

/**
 * SA-22 / TN-32: upgrade = immediate, prorata invoice `(new − old) × remaining / period`;
 * downgrade (or cycle change) = at the period end, after a quota check (never retroactive).
 * During the trial the change is immediate and free.
 */
export async function changePlan(
  services: Services,
  tenantId: string,
  input: PlanChangeInput,
  actor: Actor,
): Promise<PlanChangeResult> {
  const settings = await loadBillingSettings(services.admin);
  const clock = await tenantClock(services.admin, tenantId);
  const today = clock.today;
  const tenant = await services.admin.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { defaultCurrency: true },
  });
  const currency = tenant.defaultCurrency;
  const result = await inTx(services, async (tx): Promise<PlanChangeResult> => {
    await lockTenantBilling(tx, tenantId);
    const sub = await requireSubscription(tx, tenantId);
    const plan = await activePlan(tx, input.planId);
    const cycle = input.billingCycle ?? (sub.billingCycle as Cycle);
    if (plan.id === sub.planId && cycle === sub.billingCycle && !pendingChangeOf(sub))
      throw precondition('The subscription already uses this plan and cycle');
    if (!['TRIALING', 'ACTIVE'].includes(sub.status))
      throw precondition('Settle the subscription before changing plan', { status: sub.status });
    if ((await planPriceOn(tx, plan.id, cycle, currency, today)) === null)
      throw precondition(`Plan ${plan.code} has no ${cycle} price in ${currency}`);
    const invoiceIds: string[] = [];

    if (sub.status === 'TRIALING') {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { planId: plan.id, billingCycle: cycle, priceSnapshot: clearPending(sub) },
      });
      await recordSubscriptionChange(tx, sub, `plan changed to ${plan.code} (trial)`, actor);
      const anchor = isoOrNull(sub.trialEndsAt);
      if (anchor && (await voidUnpaidPeriodInvoice(tx, sub.id, anchor))) {
        const fresh = (await currentSubscription(tx, tenantId))!;
        const r = await ensurePeriodInvoice(tx, fresh, anchor, today, settings, currency);
        if (r.created) invoiceIds.push(r.invoice.id);
      }
      return { mode: 'immediate', effectiveAt: today, invoiceIds, pendingChange: null };
    }

    const start = isoOrNull(sub.currentPeriodStart) ?? today;
    const end = isoOrNull(sub.currentPeriodEnd) ?? periodEndOf(start, sub.billingCycle as Cycle);
    const oldPrice =
      (await planPriceOn(tx, sub.planId, sub.billingCycle as Cycle, currency, start)) ?? 0n;
    const newPriceSameCycle = await planPriceOn(
      tx,
      plan.id,
      sub.billingCycle as Cycle,
      currency,
      today,
    );
    const upgrade =
      plan.id !== sub.planId && newPriceSameCycle !== null && newPriceSameCycle > oldPrice;

    if (upgrade) {
      const remaining = Math.max(0, diffDays(today, end));
      const periodDays = Math.max(1, diffDays(start, end));
      const amount = prorata(newPriceSameCycle, oldPrice, remaining, periodDays);
      const pending: PendingChange | null =
        cycle !== sub.billingCycle
          ? { planId: plan.id, billingCycle: cycle, effectiveAt: end, requestedBy: actor.id ?? '' }
          : null;
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planId: plan.id,
          priceSnapshot: pending ? withPending(sub, pending) : clearPending(sub),
        },
      });
      await recordSubscriptionChange(tx, sub, `upgrade ${sub.plan.code} → ${plan.code}`, actor);
      if (amount > 0n) {
        const inv = await issueInvoice(
          tx,
          {
            tenantId,
            subscriptionId: sub.id,
            issueDate: today,
            dueDate: addDays(today, settings.paymentTermsDays),
            periodStart: today,
            periodEnd: end,
            currency,
            lines: [
              {
                label: `${LINE.prorata} ${sub.plan.name} → ${plan.name} (${remaining}/${periodDays} j)`,
                unitAmount: amount,
              },
            ],
          },
          settings,
        );
        invoiceIds.push(inv.id);
      }
      // A renewal already issued with the old plan is replaced.
      if (await voidUnpaidPeriodInvoice(tx, sub.id, end)) {
        const fresh = (await currentSubscription(tx, tenantId))!;
        const r = await ensurePeriodInvoice(tx, fresh, end, today, settings, currency);
        if (r.created) invoiceIds.push(r.invoice.id);
      }
      return { mode: 'immediate', effectiveAt: today, invoiceIds, pendingChange: pending };
    }

    // Downgrade / cycle change at the period end, quotas checked now.
    if (plan.id !== sub.planId) {
      const violations = await quotaViolations(tx, plan.id, tenantId);
      if (violations.length)
        throw precondition('Current usage exceeds the quotas of the target plan', {
          reason: 'QUOTA_EXCEEDED',
          violations,
        });
    }
    const pending: PendingChange = {
      planId: plan.id,
      billingCycle: cycle,
      effectiveAt: end,
      requestedBy: actor.id ?? '',
    };
    await tx.subscription.update({
      where: { id: sub.id },
      data: { priceSnapshot: withPending(sub, pending) },
    });
    await recordSubscriptionChange(
      tx,
      sub,
      `plan change to ${plan.code} scheduled on ${end}`,
      actor,
    );
    if (await voidUnpaidPeriodInvoice(tx, sub.id, end)) {
      const fresh = (await currentSubscription(tx, tenantId))!;
      const r = await ensurePeriodInvoice(tx, fresh, end, today, settings, currency);
      if (r.created) invoiceIds.push(r.invoice.id);
    }
    return { mode: 'scheduled', effectiveAt: end, invoiceIds, pendingChange: pending };
  });
  await afterChange(services, tenantId, result.invoiceIds);
  return result;
}

function snapshotOf(sub: SubscriptionWithPlan): Record<string, unknown> {
  return { ...((sub.priceSnapshot as Record<string, unknown> | null) ?? {}) };
}
function withPending(sub: SubscriptionWithPlan, p: PendingChange): Prisma.InputJsonValue {
  return { ...snapshotOf(sub), pendingChange: { ...p } } as Prisma.InputJsonValue;
}
function clearPending(sub: SubscriptionWithPlan): Prisma.InputJsonValue {
  const s = snapshotOf(sub);
  delete s.pendingChange;
  return s as Prisma.InputJsonValue;
}

async function afterChange(services: Services, tenantId: string, invoiceIds: readonly string[]) {
  await invalidateTenantCaches(services, tenantId);
  for (const id of invoiceIds)
    await renderInvoicePdf(services, id).catch((err: unknown) =>
      services.logger.error('invoice pdf failed', { invoiceId: id, err: (err as Error).message }),
    );
}

/** Cancels a scheduled plan change. */
export async function cancelPendingChange(services: Services, tenantId: string, actor: Actor) {
  await inTx(services, async (tx) => {
    await lockTenantBilling(tx, tenantId);
    const sub = await requireSubscription(tx, tenantId);
    if (!pendingChangeOf(sub)) throw precondition('No scheduled plan change');
    await tx.subscription.update({
      where: { id: sub.id },
      data: { priceSnapshot: clearPending(sub) },
    });
    await recordSubscriptionChange(tx, sub, 'scheduled plan change cancelled', actor);
  });
  await invalidateTenantCaches(services, tenantId);
}

/**
 * SA-12: extends the trial (TRIALING) or offers days on the current period (other statuses but
 * CANCELLED). An unpaid invoice of the moved period is voided and re-issued at the new date.
 */
export async function offerDays(
  services: Services,
  tenantId: string,
  days: number,
  reason: string,
  actor: Actor,
) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw invalid('days', '1 to 365 days');
  const settings = await loadBillingSettings(services.admin);
  const clock = await tenantClock(services.admin, tenantId);
  const tenant = await services.admin.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { defaultCurrency: true },
  });
  const invoiceIds: string[] = [];
  await inTx(services, async (tx) => {
    await lockTenantBilling(tx, tenantId);
    const sub = await requireSubscription(tx, tenantId);
    if (sub.status === 'CANCELLED') throw precondition('Subscription cancelled');
    if (sub.status === 'TRIALING') {
      const end = isoOrNull(sub.trialEndsAt) ?? clock.today;
      const next = addDays(end, days);
      const voided = await voidUnpaidPeriodInvoice(tx, sub.id, end);
      await tx.subscription.update({
        where: { id: sub.id },
        data: { trialEndsAt: dateOf(next), currentPeriodEnd: dateOf(next) },
      });
      await recordSubscriptionChange(tx, sub, `trial extended by ${days} days: ${reason}`, actor);
      if (voided && clock.today >= addDays(next, -settings.renewalLeadDays)) {
        const fresh = (await currentSubscription(tx, tenantId))!;
        const r = await ensurePeriodInvoice(
          tx,
          fresh,
          next,
          clock.today,
          settings,
          tenant.defaultCurrency,
        );
        if (r.created) invoiceIds.push(r.invoice.id);
      }
      return;
    }
    const end = isoOrNull(sub.currentPeriodEnd) ?? clock.today;
    const next = addDays(end, days);
    const voided = await voidUnpaidPeriodInvoice(tx, sub.id, end);
    await tx.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: dateOf(next) },
    });
    await recordSubscriptionChange(tx, sub, `${days} days offered: ${reason}`, actor);
    if (voided && clock.today >= addDays(next, -settings.renewalLeadDays)) {
      const fresh = (await currentSubscription(tx, tenantId))!;
      const r = await ensurePeriodInvoice(
        tx,
        fresh,
        next,
        clock.today,
        settings,
        tenant.defaultCurrency,
      );
      if (r.created) invoiceIds.push(r.invoice.id);
    }
  });
  await afterChange(services, tenantId, invoiceIds);
  return currentSubscription(services.admin, tenantId);
}

/** SA-24: suspend (read only), reason mandatory. */
export async function suspendTenant(
  services: Services,
  tenantId: string,
  reason: string,
  actor: Actor,
) {
  await inTx(services, async (tx) => {
    await lockTenantBilling(tx, tenantId);
    const sub = await requireSubscription(tx, tenantId);
    if (sub.status === 'SUSPENDED') throw precondition('Already suspended');
    await guarded(() => applyTransition(tx, sub, { trigger: 'ADMIN_SUSPEND', reason, actor }));
  });
  await invalidateTenantCaches(services, tenantId);
}

/** SA-24: reactivate (SUSPENDED / CANCELLED → ACTIVE) with a fresh grace on overdue invoices. */
export async function reactivateTenant(
  services: Services,
  tenantId: string,
  reason: string,
  actor: Actor,
) {
  const settings = await loadBillingSettings(services.admin);
  const clock = await tenantClock(services.admin, tenantId);
  await inTx(services, async (tx) => {
    await lockTenantBilling(tx, tenantId);
    const sub = await requireSubscription(tx, tenantId);
    const end = isoOrNull(sub.currentPeriodEnd);
    const restart = end === null || end <= clock.today;
    await guarded(() =>
      applyTransition(tx, sub, {
        trigger: 'ADMIN_REACTIVATE',
        reason,
        actor,
        graceEndsAt: addDays(clock.today, settings.graceDays),
        patch: {
          cancelAt: null,
          ...(restart
            ? {
                currentPeriodStart: dateOf(clock.today),
                currentPeriodEnd: dateOf(periodEndOf(clock.today, sub.billingCycle as Cycle)),
              }
            : {}),
        },
      }),
    );
  });
  await invalidateTenantCaches(services, tenantId);
}

/** SA-24: cancel now (export only) or at the period end, reason mandatory. */
export async function cancelSubscription(
  services: Services,
  tenantId: string,
  reason: string,
  actor: Actor,
  atPeriodEnd: boolean,
) {
  await inTx(services, async (tx) => {
    await lockTenantBilling(tx, tenantId);
    const sub = await requireSubscription(tx, tenantId);
    if (sub.status === 'CANCELLED') throw precondition('Already cancelled');
    if (atPeriodEnd) {
      const at =
        sub.status === 'TRIALING' ? isoOrNull(sub.trialEndsAt) : isoOrNull(sub.currentPeriodEnd);
      if (!at) throw precondition('No period end to cancel at');
      await tx.subscription.update({ where: { id: sub.id }, data: { cancelAt: dateOf(at) } });
      await recordSubscriptionChange(tx, sub, `cancellation scheduled on ${at}: ${reason}`, actor);
      // The next period will not be billed.
      await voidUnpaidPeriodInvoice(tx, sub.id, at);
      return;
    }
    await guarded(() =>
      applyTransition(tx, sub, {
        trigger: 'ADMIN_CANCEL',
        reason,
        actor,
        patch: { cancelAt: dateOf(isoOf(new Date())) },
      }),
    );
  });
  await invalidateTenantCaches(services, tenantId);
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as Error).name === 'InvalidTransitionError')
      throw precondition((err as Error).message, { reason: 'INVALID_TRANSITION' });
    throw err;
  }
}

/** Voids an invoice that has received no payment (credit note semantics, reason audited). */
export async function voidInvoice(services: Services, invoiceId: string, reason: string) {
  if (!reason.trim()) throw invalid('reason', 'A reason is required');
  const inv0 = await services.admin.platformInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv0) throw notFound('Invoice');
  const out = await inTx(services, async (tx) => {
    await lockTenantBilling(tx, inv0.tenantId);
    const inv = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.status === 'VOID') throw precondition('Invoice already void');
    if ((await paidAmount(tx, inv.id)) > 0n)
      throw precondition('Reverse the payments allocated to this invoice first', {
        reason: 'INVOICE_HAS_PAYMENTS',
      });
    const updated = await tx.platformInvoice.update({
      where: { id: inv.id },
      data: { status: 'VOID' },
    });
    await emit(tx, inv.tenantId, BILLING_EVENTS.invoiceVoided, { invoiceId: inv.id, reason });
    return updated;
  });
  return { id: out.id, number: out.number, status: out.status, total: num(out.total) };
}
