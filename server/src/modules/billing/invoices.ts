import type { PlatformInvoiceKind, Prisma } from '@hm/database';
import {
  addDays,
  couponDiscount,
  diffDays,
  invoiceStatusOf,
  periodEndOf,
  taxOf,
  type Cycle,
  type IsoDate,
} from './domain.js';
import { BILLING_EVENTS, dateOf, emit, isoOf, notFound, type Db, type Tx } from './common.js';
import { nextPlatformNumber } from './numbering.js';
import type { BillingSettings } from './settings.js';

export interface LineInput {
  label: string;
  qty?: number;
  unitAmount: bigint;
}

/** Label prefixes of generated lines (user-visible, French by default; the invoice kind is a column). */
export const LINE = {
  prorata: 'Prorata',
  coupon: 'Remise coupon',
  discount: 'Remise',
} as const;

const validOn = (on: Date) => ({
  validFrom: { lte: on },
  OR: [{ validTo: null }, { validTo: { gt: on } }],
});

/** Plan price valid on a date (versioned prices, no retroactive effect), or null. */
export async function planPriceOn(
  db: Db,
  planId: string,
  cycle: Cycle,
  currency: string,
  on: IsoDate,
): Promise<bigint | null> {
  const p = await db.planPrice.findFirst({
    where: { planId, billingCycle: cycle, currency, ...validOn(dateOf(on)) },
    orderBy: { validFrom: 'desc' },
  });
  return p?.amount ?? null;
}

export async function addonPriceOn(
  db: Db,
  addonId: string,
  cycle: Cycle,
  currency: string,
  on: IsoDate,
): Promise<bigint | null> {
  const d = dateOf(on);
  const p = await db.addonPrice.findFirst({
    where: {
      addonId,
      billingCycle: cycle,
      currency,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: d } }] },
        { OR: [{ validTo: null }, { validTo: { gt: d } }] },
      ],
    },
    orderBy: { validFrom: 'desc' },
  });
  return p?.amount ?? null;
}

/**
 * Amount actually paid on an invoice: allocations of CONFIRMED payments only (allocations of
 * reversed payments stay in the history but no longer count).
 */
export async function paidAmount(db: Db, invoiceId: string): Promise<bigint> {
  const agg = await db.paymentAllocation.aggregate({
    where: { invoiceId, payment: { status: 'CONFIRMED' } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0n;
}

/** Recomputes `amount_paid` and the status of invoices (after allocation or reversal). */
export async function recomputeInvoices(tx: Tx, invoiceIds: readonly string[]) {
  const changed: { id: string; from: string; to: string }[] = [];
  for (const id of new Set(invoiceIds)) {
    const inv = await tx.platformInvoice.findUniqueOrThrow({ where: { id } });
    const paid = await paidAmount(tx, id);
    const status = invoiceStatusOf(inv.status, inv.total, paid);
    if (paid !== inv.amountPaid || status !== inv.status) {
      await tx.platformInvoice.update({ where: { id }, data: { amountPaid: paid, status } });
      changed.push({ id, from: inv.status, to: status });
    }
  }
  return changed;
}

/** Available tenant credit: unconsumed credits whose source payment is still confirmed. */
export async function creditBalance(db: Db, tenantId: string, currency: string): Promise<bigint> {
  const credits = await db.tenantCredit.findMany({
    where: {
      tenantId,
      currency,
      OR: [{ sourcePaymentId: null }, { sourcePayment: { status: 'CONFIRMED' } }],
    },
  });
  return credits.reduce((s, c) => s + (c.amount - c.consumedAmount), 0n);
}

/**
 * Consumes the tenant credit on an invoice: an allocation of the credit's source payment
 * (traceable, reversed with it) and `consumed_amount` increased.
 */
async function applyCredit(tx: Tx, tenantId: string, invoiceId: string, currency: string) {
  const inv = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  let due = inv.total - (await paidAmount(tx, invoiceId));
  if (due <= 0n) return 0n;
  const credits = await tx.tenantCredit.findMany({
    where: { tenantId, currency, sourcePayment: { status: 'CONFIRMED' } },
    orderBy: { createdAt: 'asc' },
  });
  let used = 0n;
  for (const c of credits) {
    const left = c.amount - c.consumedAmount;
    if (left <= 0n || due <= 0n || !c.sourcePaymentId) continue;
    const take = left < due ? left : due;
    const existing = await tx.paymentAllocation.findUnique({
      where: { paymentId_invoiceId: { paymentId: c.sourcePaymentId, invoiceId } },
    });
    if (existing) continue;
    await tx.paymentAllocation.create({
      data: { paymentId: c.sourcePaymentId, invoiceId, amount: take },
    });
    await tx.tenantCredit.update({
      where: { id: c.id },
      data: { consumedAmount: c.consumedAmount + take },
    });
    due -= take;
    used += take;
  }
  if (used > 0n) await recomputeInvoices(tx, [invoiceId]);
  return used;
}

export interface IssueInvoiceInput {
  tenantId: string;
  subscriptionId: string | null;
  issueDate: IsoDate;
  dueDate: IsoDate;
  periodStart?: IsoDate | null;
  periodEnd?: IsoDate | null;
  currency: string;
  lines: LineInput[];
  /** SUBSCRIPTION (first period), RENEWAL, PRORATA (upgrade), ADDON, MANUAL. */
  kind: PlatformInvoiceKind;
}

/**
 * Issues a platform invoice in the caller's transaction: gap-free number `PLT-YYYY-NNNNNN`,
 * lines, platform VAT (EX-03, settings), tenant credit applied, outbox event. A zero total is
 * PAID at once. Issued invoices are immutable (only status / amount paid / PDF change).
 */
export async function issueInvoice(
  tx: Tx,
  input: IssueInvoiceInput,
  settings: Pick<BillingSettings, 'vat'>,
) {
  const lines = input.lines.map((l) => {
    const qty = l.qty ?? 1;
    return {
      label: l.label.slice(0, 300),
      qty,
      unitAmount: l.unitAmount,
      amount: l.unitAmount * BigInt(qty),
    };
  });
  const subtotalRaw = lines.reduce((s, l) => s + l.amount, 0n);
  const subtotal = subtotalRaw < 0n ? 0n : subtotalRaw;
  const tax = settings.vat.enabled ? taxOf(subtotal, settings.vat.rateBps) : 0n;
  const total = subtotal + tax;
  const number = await nextPlatformNumber(tx, 'invoice', Number(input.issueDate.slice(0, 4)));
  const invoice = await tx.platformInvoice.create({
    data: {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      kind: input.kind,
      number,
      issueDate: dateOf(input.issueDate),
      dueDate: dateOf(input.dueDate),
      periodStart: input.periodStart ? dateOf(input.periodStart) : null,
      periodEnd: input.periodEnd ? dateOf(input.periodEnd) : null,
      currency: input.currency,
      subtotal,
      tax,
      total,
      amountPaid: 0n,
      status: total === 0n ? 'PAID' : 'ISSUED',
      platformInvoiceLines: { create: lines },
    },
  });
  if (total > 0n) await applyCredit(tx, input.tenantId, invoice.id, input.currency);
  await emit(tx, input.tenantId, BILLING_EVENTS.invoiceIssued, {
    invoiceId: invoice.id,
    number,
    total: total.toString(),
  });
  return tx.platformInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

type SubscriptionRow = Prisma.SubscriptionGetPayload<{ include: { plan: true } }>;

export interface PendingChange {
  planId: string;
  billingCycle: Cycle;
  effectiveAt: IsoDate;
}

/** Plan change scheduled at the period end (`pending_*` columns), or null. */
export function pendingChangeOf(sub: {
  pendingPlanId: string | null;
  pendingCycle: string | null;
  pendingEffectiveAt: Date | null;
}): PendingChange | null {
  if (!sub.pendingPlanId || !sub.pendingCycle || !sub.pendingEffectiveAt) return null;
  return {
    planId: sub.pendingPlanId,
    billingCycle: sub.pendingCycle as Cycle,
    effectiveAt: isoOf(sub.pendingEffectiveAt),
  };
}

/** Columns writing (or clearing) the scheduled plan change. */
export function pendingChangeData(p: PendingChange | null) {
  return {
    pendingPlanId: p?.planId ?? null,
    pendingCycle: p?.billingCycle ?? null,
    pendingEffectiveAt: p ? dateOf(p.effectiveAt) : null,
  };
}

/** Is there already a (non-void) period invoice for this period start? */
export async function findPeriodInvoice(db: Db, subscriptionId: string, periodStart: IsoDate) {
  return db.platformInvoice.findFirst({
    where: {
      subscriptionId,
      periodStart: dateOf(periodStart),
      status: { not: 'VOID' },
      kind: { not: 'PRORATA' },
    },
  });
}

/** Number of period invoices already discounted by a coupon (FREE_MONTHS / N cycles). */
async function couponCyclesUsed(db: Db, subscriptionId: string, code: string) {
  return db.platformInvoice.count({
    where: {
      subscriptionId,
      status: { not: 'VOID' },
      platformInvoiceLines: { some: { label: `${LINE.coupon} ${code}` } },
    },
  });
}

/**
 * Lines of a period invoice: plan price (valid at the period start) + active add-ons + coupon
 * discount + DISCOUNT overrides (percentage, SA-15).
 */
export async function periodLines(
  db: Db,
  sub: SubscriptionRow,
  planId: string,
  cycle: Cycle,
  currency: string,
  periodStart: IsoDate,
): Promise<LineInput[]> {
  const plan =
    planId === sub.planId ? sub.plan : await db.plan.findUniqueOrThrow({ where: { id: planId } });
  const price = await planPriceOn(db, planId, cycle, currency, periodStart);
  if (price === null) throw notFound(`Price of plan ${plan.code} (${cycle}, ${currency})`);
  const periodEnd = periodEndOf(periodStart, cycle);
  const lines: LineInput[] = [
    {
      label: `Abonnement ${plan.name} — ${cycle} (${periodStart} → ${periodEnd})`,
      unitAmount: price,
    },
  ];
  const start = dateOf(periodStart);
  const addons = await db.tenantAddon.findMany({
    where: {
      tenantId: sub.tenantId,
      status: 'ACTIVE',
      startsAt: { lte: dateOf(periodEnd) },
      OR: [{ endsAt: null }, { endsAt: { gt: start } }],
    },
    include: { addon: true },
  });
  for (const ta of addons) {
    const p = await addonPriceOn(db, ta.addonId, cycle, currency, periodStart);
    if (p !== null && p > 0n) lines.push({ label: `Add-on ${ta.addon.name}`, unitAmount: p });
  }
  const base = lines.reduce((s, l) => s + l.unitAmount, 0n);

  const redemption = await db.couponRedemption.findFirst({
    where: { tenantId: sub.tenantId, OR: [{ subscriptionId: sub.id }, { subscriptionId: null }] },
    include: { coupon: true },
    orderBy: { redeemedAt: 'desc' },
  });
  if (redemption?.coupon.isActive) {
    const c = redemption.coupon;
    const eligible = !c.eligiblePlans.length || c.eligiblePlans.includes(plan.code);
    if (eligible) {
      const used = await couponCyclesUsed(db, sub.id, c.code);
      const d = couponDiscount(
        { type: c.type, value: c.value.toString(), duration: c.duration },
        base,
        cycle,
        used,
      );
      if (d > 0n) lines.push({ label: `${LINE.coupon} ${c.code}`, unitAmount: -d });
    }
  }

  const discounts = await db.tenantOverride.findMany({
    where: {
      tenantId: sub.tenantId,
      kind: 'DISCOUNT',
      OR: [{ endsAt: null }, { endsAt: { gt: start } }],
    },
  });
  for (const o of discounts) {
    const pct = (o.value as { percent?: unknown } | null)?.percent;
    const amount = (o.value as { amount?: unknown } | null)?.amount;
    let d = 0n;
    if (typeof pct === 'number' && pct > 0 && pct <= 100)
      d = (base * BigInt(Math.round(pct * 100)) + 5_000n) / 10_000n;
    else if (typeof amount === 'number' && Number.isInteger(amount) && amount > 0)
      d = BigInt(amount);
    if (d > base) d = base;
    if (d > 0n) lines.push({ label: `${LINE.discount} ${o.key}`.trim(), unitAmount: -d });
  }
  return lines;
}

/**
 * Issues the invoice of the period starting at `periodStart` (subscription, renewal at J-7)
 * unless it already exists — idempotent. Uses the pending plan change effective at that date.
 */
export async function ensurePeriodInvoice(
  tx: Tx,
  sub: SubscriptionRow,
  periodStart: IsoDate,
  today: IsoDate,
  settings: Pick<BillingSettings, 'vat'>,
  currency: string,
) {
  const existing = await findPeriodInvoice(tx, sub.id, periodStart);
  if (existing) return { invoice: existing, created: false };
  const pending = pendingChangeOf(sub);
  const usePending = pending && pending.effectiveAt <= periodStart;
  const planId = usePending ? pending.planId : sub.planId;
  const cycle = (usePending ? pending.billingCycle : sub.billingCycle) as Cycle;
  const lines = await periodLines(tx, sub, planId, cycle, currency, periodStart);
  const previous = await tx.platformInvoice.count({
    where: { subscriptionId: sub.id, status: { not: 'VOID' }, kind: { not: 'PRORATA' } },
  });
  const invoice = await issueInvoice(
    tx,
    {
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      issueDate: today,
      dueDate: periodStart < today ? today : periodStart,
      periodStart,
      periodEnd: periodEndOf(periodStart, cycle),
      currency,
      lines,
      kind: previous ? 'RENEWAL' : 'SUBSCRIPTION',
    },
    settings,
  );
  return { invoice, created: true };
}

/** Outstanding (non-void, unpaid) invoices of a tenant, oldest first. */
export async function openInvoices(db: Db, tenantId: string) {
  const rows = await db.platformInvoice.findMany({
    where: { tenantId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }, { number: 'asc' }],
  });
  return rows.map((r) => ({ ...r, balance: r.total - r.amountPaid }));
}

/** Earliest due date of a subscription invoice still owed. */
export async function oldestUnpaidDueDate(db: Db, tenantId: string): Promise<IsoDate | null> {
  const inv = await db.platformInvoice.findFirst({
    where: { tenantId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    orderBy: { dueDate: 'asc' },
    select: { dueDate: true },
  });
  return inv ? isoOf(inv.dueDate) : null;
}

/** Remaining days of the current period (for prorata) — never negative. */
export function remainingDays(today: IsoDate, periodEnd: IsoDate): number {
  return Math.max(0, diffDays(today, periodEnd));
}

export const dueIn = (today: IsoDate, days: number) => addDays(today, days);
