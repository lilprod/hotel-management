import type { Prisma } from '@hm/database';
import type { Services } from '../../core/container.js';
import { defineJob } from '../../jobs/context.js';
import { writePlatformAudit } from '../audit/service.js';
import {
  SYSTEM_ACTOR,
  billingNow,
  inTx,
  invalidateTenantCaches,
  isoOf,
  isoOrNull,
  lockTenantBilling,
  num,
} from './common.js';
import { addDays, diffDays, localDate, localMinutes, type IsoDate } from './domain.js';
import { renderInvoicePdf } from './documents.js';
import { ensurePeriodInvoice, openInvoices, pendingChangeOf } from './invoices.js';
import { sendBillingNotice, type BillingNotice } from './notifier.js';
import { loadBillingSettings, type BillingSettings } from './settings.js';
import {
  currentSubscription,
  factsOf,
  recordSubscriptionChange,
  reevaluate,
} from './subscriptions.js';

export const BILLING_QUEUE = 'billing';

/** Daily jobs run at 00:15 in the tenant's time zone (doc 02 §2). */
export const DAILY_RUN_MINUTE = 15;
const CLAIM_TTL_S = 3 * 24 * 3600;
const REMINDER_TTL_S = 400 * 24 * 3600;

export interface RunOptions {
  /** Fake clock (tests) — defaults to the billing clock. */
  now?: Date;
  /** Restrict to some tenants (tests, manual re-run). */
  tenantIds?: string[];
  /** Ignore the 00:15 local gate. */
  force?: boolean;
}

async function dueTenants(services: Services, opts: RunOptions, job: string) {
  const now = opts.now ?? billingNow();
  const tenants = await services.admin.tenant.findMany({
    where: {
      deletedAt: null,
      status: { not: 'ARCHIVED' },
      subscriptions: { some: {} },
      ...(opts.tenantIds ? { id: { in: opts.tenantIds } } : {}),
    },
    select: { id: true, timezone: true },
  });
  const out: { id: string; today: IsoDate; claim: string }[] = [];
  for (const t of tenants) {
    const today = localDate(now, t.timezone);
    if (!opts.force && localMinutes(now, t.timezone) < DAILY_RUN_MINUTE) continue;
    const claim = `hm:billing:${job}:${t.id}:${today}`;
    const first = await services.redis.set(claim, '1', 'EX', CLAIM_TTL_S, 'NX');
    if (first === 'OK') out.push({ id: t.id, today, claim });
  }
  return out;
}

export interface LifecycleReport {
  tenantId: string;
  today: IsoDate;
  invoices: string[];
  transition: { from: string; to: string; trigger: string } | null;
  planChanged: boolean;
}

/** One tenant: pending plan change, renewal invoice at J-lead, state transition. */
async function lifecycleOf(
  services: Services,
  tenantId: string,
  today: IsoDate,
  settings: BillingSettings,
): Promise<LifecycleReport> {
  const report: LifecycleReport = {
    tenantId,
    today,
    invoices: [],
    transition: null,
    planChanged: false,
  };
  const tenant = await services.admin.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { defaultCurrency: true },
  });
  await inTx(services, async (tx) => {
    await lockTenantBilling(tx, tenantId);
    let sub = await currentSubscription(tx, tenantId);
    if (!sub) return;

    // 1. Downgrade / cycle change scheduled at the period end.
    const pending = pendingChangeOf(sub);
    if (pending && pending.effectiveAt <= today) {
      const snap = { ...((sub.priceSnapshot as Record<string, unknown> | null) ?? {}) };
      delete snap.pendingChange;
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planId: pending.planId,
          billingCycle: pending.billingCycle,
          priceSnapshot: snap as Prisma.InputJsonValue,
        },
      });
      await recordSubscriptionChange(tx, sub, `scheduled plan change applied`, SYSTEM_ACTOR);
      report.planChanged = true;
      sub = (await currentSubscription(tx, tenantId))!;
    }

    // 2. Renewal (or first period after the trial) invoiced `renewalLeadDays` before.
    const anchor =
      sub.status === 'TRIALING' ? isoOrNull(sub.trialEndsAt) : isoOrNull(sub.currentPeriodEnd);
    const cancelAt = isoOrNull(sub.cancelAt);
    if (
      anchor &&
      ['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(sub.status) &&
      (cancelAt === null || cancelAt > anchor) &&
      today >= addDays(anchor, -settings.renewalLeadDays)
    ) {
      const r = await ensurePeriodInvoice(tx, sub, anchor, today, settings, tenant.defaultCurrency);
      if (r.created) report.invoices.push(r.invoice.id);
    }

    // 3. State machine.
    const d = await reevaluate(tx, sub, today, settings, SYSTEM_ACTOR);
    if (d) report.transition = { from: d.from, to: d.to, trigger: d.trigger };
  });
  if (report.transition || report.planChanged) await invalidateTenantCaches(services, tenantId);
  for (const id of report.invoices)
    await renderInvoicePdf(services, id).catch((err: unknown) =>
      services.logger.error('invoice pdf failed', { invoiceId: id, err: (err as Error).message }),
    );
  if (report.transition)
    await writePlatformAudit(services, {
      action: 'subscription.transition',
      entity: 'subscription',
      entityId: tenantId,
      after: report.transition,
    }).catch(() => undefined);
  return report;
}

/** `subscription-lifecycle`: every tenant whose local time passed 00:15, once per local day. */
export async function runLifecycle(services: Services, opts: RunOptions = {}) {
  const settings = await loadBillingSettings(services.admin);
  const reports: LifecycleReport[] = [];
  for (const t of await dueTenants(services, opts, 'lifecycle')) {
    try {
      reports.push(await lifecycleOf(services, t.id, t.today, settings));
    } catch (err) {
      await services.redis.del(t.claim); // retried on the next tick
      services.logger.error('subscription lifecycle failed', {
        tenantId: t.id,
        err: (err as Error).message,
      });
    }
  }
  return reports;
}

// --- Reminders (doc 02 §5) --------------------------------------------------------------

/** A reminder fires on its target day, or up to 2 days later if a run was missed. */
const CATCH_UP_DAYS = 2;
const fires = (today: IsoDate, target: IsoDate) =>
  today >= target && diffDays(target, today) <= CATCH_UP_DAYS;

async function remindersOf(
  services: Services,
  tenantId: string,
  today: IsoDate,
  settings: BillingSettings,
): Promise<BillingNotice[]> {
  const sub = await currentSubscription(services.admin, tenantId);
  if (!sub) return [];
  const notices: BillingNotice[] = [];
  const sms = (rule: BillingSettings['reminders'][number]) =>
    rule.channels.includes('SMS') ||
    (settings.smsReminders && (rule.optionalChannels ?? []).includes('SMS'));
  const invoices = ['ACTIVE', 'PAST_DUE', 'TRIALING'].includes(sub.status)
    ? await openInvoices(services.admin, tenantId)
    : [];
  const facts = await factsOf(services.admin, sub);

  for (const rule of settings.reminders) {
    if (!rule.channels.includes('EMAIL') && !sms(rule)) continue;
    for (const offset of rule.offsetsDays) {
      if (rule.model === 'trial_ending') {
        const end = isoOrNull(sub.trialEndsAt);
        if (sub.status !== 'TRIALING' || !end || !fires(today, addDays(end, offset))) continue;
        notices.push({
          tenantId,
          templateCode: 'trial_ending',
          idempotencyKey: `trial:${sub.id}:${end}:${offset}`,
          sms: sms(rule),
          data: {
            subscription: { planName: sub.plan.name },
            trial: { endDate: end, daysLeft: Math.max(0, diffDays(today, end)) },
          },
        });
      } else if (rule.model === 'account_suspended') {
        if (sub.status !== 'SUSPENDED' || !facts.suspendedSince) continue;
        if (!fires(today, addDays(facts.suspendedSince, offset))) continue;
        const owed = await openInvoices(services.admin, tenantId);
        const due = owed.reduce((s, i) => s + i.balance, 0n);
        notices.push({
          tenantId,
          templateCode: 'account_suspended',
          idempotencyKey: `suspended:${sub.id}:${facts.suspendedSince}:${offset}`,
          sms: sms(rule),
          data: {
            invoice: { amountDue: { amount: num(due), currency: owed[0]?.currency ?? 'XOF' } },
            hotel: { supportEmail: settings.identity.email ?? '' },
          },
        });
      } else {
        for (const inv of invoices) {
          const due = isoOf(inv.dueDate);
          if (!fires(today, addDays(due, offset))) continue;
          if (rule.model === 'invoice_upcoming' && offset >= 0) continue;
          if (rule.model === 'invoice_overdue' && offset <= 0) continue;
          const amount = { amount: num(inv.balance), currency: inv.currency };
          notices.push({
            tenantId,
            templateCode: rule.model,
            idempotencyKey: `${rule.model}:${inv.id}:${offset}`,
            sms: sms(rule),
            data: {
              subscription: { planName: sub.plan.name },
              invoice: {
                number: inv.number,
                amount,
                dueDate: due,
                daysOverdue: Math.max(0, diffDays(due, today)),
                suspensionDate: addDays(due, settings.graceDays),
                paymentInstructions: settings.paymentInstructions.note,
              },
            },
          });
        }
      }
    }
  }
  return notices;
}

/** `billing-reminders`: J-7/J-3/J0/J+3/J+7 and trial J-3/J-1, each notice sent once. */
export async function runReminders(services: Services, opts: RunOptions = {}) {
  const settings = await loadBillingSettings(services.admin);
  const sent: BillingNotice[] = [];
  for (const t of await dueTenants(services, opts, 'reminders')) {
    try {
      for (const n of await remindersOf(services, t.id, t.today, settings)) {
        const key = `hm:billing:reminder:${t.id}:${n.idempotencyKey}`;
        const first = await services.redis.set(key, '1', 'EX', REMINDER_TTL_S, 'NX');
        if (first !== 'OK') continue;
        await sendBillingNotice(services, n);
        sent.push(n);
      }
    } catch (err) {
      await services.redis.del(t.claim);
      services.logger.error('billing reminders failed', {
        tenantId: t.id,
        err: (err as Error).message,
      });
    }
  }
  return sent;
}

export interface TickData {
  /** ISO timestamp overriding the clock (tests / manual re-run). */
  now?: string;
}

const tickNow = (d: TickData | undefined) => (d?.now ? new Date(d.now) : undefined);

export const subscriptionLifecycleJob = defineJob<TickData>({
  name: 'subscription-lifecycle',
  queue: BILLING_QUEUE,
  tenantScoped: false,
  repeat: { pattern: '*/15 * * * *' },
  options: { attempts: 3 },
  handler: async (data, { services }) => {
    const now = tickNow(data);
    const r = await runLifecycle(services, now ? { now } : {});
    return { tenants: r.length };
  },
});

export const billingRemindersJob = defineJob<TickData>({
  name: 'billing-reminders',
  queue: BILLING_QUEUE,
  tenantScoped: false,
  repeat: { pattern: '*/15 * * * *' },
  options: { attempts: 3 },
  handler: async (data, { services }) => {
    const now = tickNow(data);
    const r = await runReminders(services, now ? { now } : {});
    return { sent: r.length };
  },
});
