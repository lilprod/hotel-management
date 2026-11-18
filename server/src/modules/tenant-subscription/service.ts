import type { Services } from '../../core/container.js';
import { billingNow, isoOf, isoOrNull, num } from '../billing/common.js';
import { addDays, diffDays, localDate } from '../billing/domain.js';
import { creditBalance, openInvoices, pendingChangeOf, planPriceOn } from '../billing/invoices.js';
import { listInvoices } from '../billing/queries.js';
import { loadBillingSettings } from '../billing/settings.js';
import { currentSubscription, factsOf } from '../billing/subscriptions.js';
import { quotaReport } from '../billing/usage.js';
import { notificationDeps } from '../notifications/deps.js';

/**
 * Tenant side of the SaaS subscription (TN-30…TN-34). The platform tables are admin-only
 * (no hm_app grant): every query goes through the admin client and is filtered by the tenant
 * resolved from the Host / token (`req.tenant.id`), never by client input.
 */
export async function tenantToday(services: Services, tenantId: string) {
  const t = await services.admin.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true, defaultCurrency: true },
  });
  return { today: localDate(billingNow(), t.timezone), currency: t.defaultCurrency };
}

export async function subscriptionOverview(services: Services, tenantId: string) {
  const { today, currency } = await tenantToday(services, tenantId);
  const sub = await currentSubscription(services.admin, tenantId);
  const [quotas, ent, open, credit] = await Promise.all([
    quotaReport(services, tenantId),
    services.entitlements.resolve(tenantId),
    openInvoices(services.admin, tenantId),
    creditBalance(services.admin, tenantId, currency),
  ]);
  const pending = sub ? pendingChangeOf(sub) : null;
  const pendingPlan = pending
    ? await services.admin.plan.findUnique({
        where: { id: pending.planId },
        select: { id: true, code: true, name: true },
      })
    : null;
  return {
    today,
    subscription: sub
      ? {
          status: sub.status,
          plan: { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name },
          billingCycle: sub.billingCycle,
          trialEndsAt: isoOrNull(sub.trialEndsAt),
          currentPeriodStart: isoOrNull(sub.currentPeriodStart),
          currentPeriodEnd: isoOrNull(sub.currentPeriodEnd),
          graceEndsAt: isoOrNull(sub.graceEndsAt),
          cancelAt: isoOrNull(sub.cancelAt),
          pendingChange: pending ? { ...pending, plan: pendingPlan } : null,
        }
      : null,
    features: ent.features,
    quotas,
    amountDue: num(open.reduce((s, i) => s + i.balance, 0n)),
    currency,
    credit: num(credit),
  };
}

export function tenantInvoices(
  services: Services,
  tenantId: string,
  limit: number,
  offset: number,
) {
  return tenantToday(services, tenantId).then(({ today }) =>
    listInvoices(services, { tenantId, limit, offset }, today),
  );
}

export async function tenantReceipts(services: Services, tenantId: string) {
  const rows = await services.admin.payment.findMany({
    where: { tenantId, receiptNumber: { not: null } },
    orderBy: { paidAt: 'desc' },
    take: 200,
  });
  return {
    items: rows.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      amount: num(p.amount),
      currency: p.currency,
      method: p.method,
      reference: p.reference,
      paidAt: isoOf(p.paidAt),
      status: p.status,
      reversalReason: p.reversalReason,
    })),
  };
}

/** TN-34: platform payment instructions (Mixx / Moov merchant numbers…) + amounts due. */
export async function paymentInstructions(services: Services, tenantId: string) {
  const settings = await loadBillingSettings(services.admin);
  const { currency } = await tenantToday(services, tenantId);
  const open = await openInvoices(services.admin, tenantId);
  const due = open.reduce((s, i) => s + i.balance, 0n);
  const intent = await notificationDeps(services)
    .providers.payment('manual')
    .createIntent({
      tenantId,
      reference: open[0]?.number ?? 'subscription',
      money: { amount: due, currency },
      method: 'manual',
    });
  return {
    payee: settings.identity.legalName,
    note: settings.paymentInstructions.note,
    methods: settings.paymentInstructions.methods,
    provider: intent.provider,
    instructions: intent.instructions ?? null,
    amountDue: num(due),
    currency,
    invoices: open.map((i) => ({
      id: i.id,
      number: i.number,
      dueDate: isoOf(i.dueDate),
      balance: num(i.balance),
    })),
  };
}

/** Public, active plans with their current prices (plan change screen). */
export async function availablePlans(services: Services, tenantId: string) {
  const { today, currency } = await tenantToday(services, tenantId);
  const plans = await services.admin.plan.findMany({
    where: { deletedAt: null, isActive: true, isPublic: true },
    include: { planFeatures: { where: { enabled: true } }, planQuotas: true },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  const out = [];
  for (const p of plans) {
    const prices: Record<string, number | null> = {};
    for (const c of ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const) {
      const v = await planPriceOn(services.admin, p.id, c, currency, today);
      prices[c] = v === null ? null : num(v);
    }
    out.push({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      trialDays: p.trialDays,
      features: p.planFeatures.map((f) => f.featureKey),
      quotas: Object.fromEntries(p.planQuotas.map((q) => [q.quotaKey, q.limit])),
      prices,
      currency,
    });
  }
  return { items: out };
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

/** TN-33: banners (trial J-x, due soon, overdue, suspended / read only). */
export async function banners(services: Services, tenantId: string) {
  const settings = await loadBillingSettings(services.admin);
  const { today, currency } = await tenantToday(services, tenantId);
  const sub = await currentSubscription(services.admin, tenantId);
  const out: Banner[] = [];
  if (!sub) return { today, currency, status: 'NONE', readOnly: true, items: out };
  const open = await openInvoices(services.admin, tenantId);
  const due = open.reduce((s, i) => s + i.balance, 0n);
  const facts = await factsOf(services.admin, sub);
  const trialWindow = Math.max(
    0,
    ...settings.reminders
      .filter((r) => r.model === 'trial_ending')
      .flatMap((r) => r.offsetsDays.map((o) => -o)),
    7,
  );
  if (sub.status === 'TRIALING' && sub.trialEndsAt) {
    const end = isoOf(sub.trialEndsAt);
    const daysLeft = Math.max(0, diffDays(today, end));
    out.push({
      kind: 'trial',
      severity: daysLeft <= trialWindow ? 'warning' : 'info',
      daysLeft,
      endsAt: end,
    });
  }
  if (sub.cancelAt && sub.status !== 'CANCELLED')
    out.push({ kind: 'cancel_scheduled', severity: 'warning', cancelAt: isoOf(sub.cancelAt) });
  if (['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status)) {
    const overdue = open.filter((i) => isoOf(i.dueDate) < today);
    if (overdue.length) {
      const first = isoOf(overdue[0]!.dueDate);
      out.push({
        kind: 'overdue',
        severity: 'error',
        amount: num(overdue.reduce((s, i) => s + i.balance, 0n)),
        dueDate: first,
        suspensionDate: isoOrNull(sub.graceEndsAt) ?? addDays(first, settings.graceDays),
      });
    } else {
      const soon = open.find((i) => diffDays(today, isoOf(i.dueDate)) <= 7);
      if (soon)
        out.push({
          kind: 'due_soon',
          severity: 'warning',
          invoiceNumber: soon.number,
          dueDate: isoOf(soon.dueDate),
          daysLeft: diffDays(today, isoOf(soon.dueDate)),
          amount: num(soon.balance),
        });
    }
  }
  if (sub.status === 'SUSPENDED')
    out.push({
      kind: 'suspended',
      severity: 'error',
      amountDue: num(due),
      since: facts.suspendedSince,
    });
  if (sub.status === 'CANCELLED') {
    const at = isoOrNull(sub.cancelAt);
    out.push({
      kind: 'cancelled',
      severity: 'error',
      purgeDate: at ? addDays(at, settings.purgeDays) : null,
    });
  }
  return {
    today,
    currency,
    status: sub.status,
    readOnly: sub.status === 'SUSPENDED' || sub.status === 'CANCELLED',
    items: out,
  };
}
