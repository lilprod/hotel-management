import type { Prisma } from '@hm/database';
import type { Services } from '../../core/container.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { notificationDeps } from '../notifications/deps.js';
import {
  BILLING_EVENTS,
  billingNow,
  conflict,
  emit,
  inTx,
  invalid,
  invalidateTenantCaches,
  isoOf,
  lockTenantBilling,
  notFound,
  num,
  precondition,
  tenantClock,
  type Actor,
  type Tx,
} from './common.js';
import { allocateOldestFirst, type IsoDate } from './domain.js';
import { findDocumentFile, renderReceiptPdf, signedFileUrl } from './documents.js';
import { openInvoices, recomputeInvoices } from './invoices.js';
import { sendBillingNotice } from './notifier.js';
import { nextPlatformNumber } from './numbering.js';
import { loadBillingSettings, type BillingSettings } from './settings.js';
import { currentSubscription, reevaluate, settleSubscription } from './subscriptions.js';

export type PlatformMethod = 'MIXX' | 'MOOV_MONEY' | 'CASH' | 'CARD';

export interface AllocationInput {
  invoiceId: string;
  amount: number;
}

export interface RecordPaymentInput {
  tenantId: string;
  amount: number;
  currency?: string | undefined;
  method: PlatformMethod;
  reference?: string | null | undefined;
  paidAt: IsoDate;
  attachmentFileId?: string | null | undefined;
  note?: string | null | undefined;
  /** Explicit allocations (default: oldest open invoice first). */
  allocations?: AllocationInput[] | undefined;
}

export interface PlannedPayload {
  allocations?: { invoiceId: string; amount: string }[];
  declarationId?: string;
  intent?: { provider: string; providerRef: string; status: string };
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

async function existingByReference(services: Services, method: PlatformMethod, reference: string) {
  return services.admin.payment.findFirst({
    where: { method, reference, status: { not: 'REVERSED' } },
    select: { id: true },
  });
}

function duplicate(existingId: string) {
  return conflict('A payment with this method and reference already exists', {
    reason: 'DUPLICATE_REFERENCE',
    existingPaymentId: existingId,
  });
}

/** SA-32: amount > 0, date ≤ today (tenant day), reference unique per method + format. */
async function validateInput(
  services: Services,
  input: RecordPaymentInput,
  settings: BillingSettings,
  today: IsoDate,
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw invalid('amount', 'Amount must be a positive integer');
  if (input.paidAt > today) throw invalid('paidAt', 'Payment date cannot be in the future');
  const ref = input.reference?.trim() || null;
  if (ref) {
    const rule = settings.paymentInstructions.methods.find((m) => m.code === input.method);
    if (rule?.referencePattern && !new RegExp(rule.referencePattern).test(ref))
      throw invalid('reference', 'Reference format is invalid for this payment method');
    const dup = await existingByReference(services, input.method, ref);
    if (dup) throw duplicate(dup.id);
  }
  if (input.attachmentFileId) {
    const f = await services.admin.file.findFirst({
      where: { id: input.attachmentFileId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!f) throw invalid('attachmentFileId', 'Unknown attachment');
  }
  if (input.allocations?.length) {
    const total = input.allocations.reduce((s, a) => s + a.amount, 0);
    if (total > input.amount) throw invalid('allocations', 'Allocations exceed the amount');
    const ids = input.allocations.map((a) => a.invoiceId);
    if (new Set(ids).size !== ids.length) throw invalid('allocations', 'Duplicate invoice');
    const invs = await services.admin.platformInvoice.findMany({
      where: { id: { in: ids }, tenantId: input.tenantId },
    });
    if (invs.length !== ids.length) throw invalid('allocations', 'Unknown invoice');
    for (const a of input.allocations) {
      const inv = invs.find((i) => i.id === a.invoiceId)!;
      if (inv.status === 'VOID' || inv.status === 'PAID' || inv.status === 'DRAFT')
        throw invalid('allocations', `Invoice ${inv.number} is not open`);
      if (BigInt(a.amount) > inv.total - inv.amountPaid)
        throw invalid('allocations', `Allocation exceeds the balance of ${inv.number}`);
    }
  }
  return ref;
}

/**
 * Records a manual payment (SA-31): PENDING_VALIDATION when double validation is on, else
 * confirmed in the same transaction. The manual PaymentProvider gives the intent (v1).
 */
export async function recordPayment(
  services: Services,
  input: RecordPaymentInput,
  actor: Actor,
  opts: { declarationId?: string; forceConfirm?: boolean } = {},
) {
  const settings = await loadBillingSettings(services.admin);
  const clock = await tenantClock(services.admin, input.tenantId);
  const reference = await validateInput(services, input, settings, clock.today);
  const tenant = await services.admin.tenant.findUniqueOrThrow({
    where: { id: input.tenantId },
    select: { defaultCurrency: true },
  });
  const currency = input.currency ?? tenant.defaultCurrency;
  const intent = await notificationDeps(services)
    .providers.payment('manual')
    .createIntent({
      tenantId: input.tenantId,
      reference: reference ?? `manual:${Date.now()}`,
      money: { amount: BigInt(input.amount), currency },
      method: input.method,
    });
  const payload: PlannedPayload = {
    ...(input.allocations?.length
      ? {
          allocations: input.allocations.map((a) => ({
            invoiceId: a.invoiceId,
            amount: String(a.amount),
          })),
        }
      : {}),
    ...(opts.declarationId ? { declarationId: opts.declarationId } : {}),
    intent: { provider: intent.provider, providerRef: intent.providerRef, status: intent.status },
  };
  const confirmNow = opts.forceConfirm || !settings.doubleValidation;
  let result;
  try {
    result = await inTx(services, async (tx) => {
      await lockTenantBilling(tx, input.tenantId);
      const payment = await tx.payment.create({
        data: {
          tenantId: input.tenantId,
          amount: BigInt(input.amount),
          currency,
          method: input.method,
          reference,
          paidAt: new Date(`${input.paidAt}T00:00:00.000Z`),
          status: 'PENDING_VALIDATION',
          provider: intent.provider,
          providerPayload: payload as Prisma.InputJsonValue,
          attachmentFileId: input.attachmentFileId ?? null,
          note: input.note ?? null,
          recordedBy: actor.id,
        },
      });
      await emit(tx, input.tenantId, BILLING_EVENTS.paymentRecorded, { paymentId: payment.id });
      if (!confirmNow) return { payment, confirmed: null };
      const confirmed = await confirmInTx(tx, payment.id, actor, clock.today);
      return { payment, confirmed };
    });
  } catch (err) {
    if (isUniqueViolation(err) && reference) {
      const dup = await existingByReference(services, input.method, reference);
      if (dup) throw duplicate(dup.id);
    }
    throw err;
  }
  if (result.confirmed) await afterConfirm(services, result.payment.id, input.tenantId);
  return getPayment(services, result.payment.id);
}

interface ConfirmOutcome {
  receiptNumber: string;
  allocations: { invoiceId: string; amount: bigint }[];
  credit: bigint;
  subscription: { from: string; to: string } | null;
}

/**
 * Confirmation (doc 02 §4.2), ONE transaction: allocations (planned or oldest first) →
 * invoice statuses → remainder as tenant credit → receipt number → subscription
 * reactivation / extension → outbox `payment.confirmed`.
 */
async function confirmInTx(
  tx: Tx,
  paymentId: string,
  actor: Actor,
  today: IsoDate,
): Promise<ConfirmOutcome> {
  const head = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { tenantId: true },
  });
  if (!head) throw notFound('Payment');
  // Lock order (tenant, then payment) is the same in every billing flow.
  await lockTenantBilling(tx, head.tenantId);
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.status !== 'PENDING_VALIDATION')
    throw precondition('Payment is not pending validation', { status: p.status });

  const planned = (p.providerPayload as PlannedPayload | null)?.allocations;
  const open = await openInvoices(tx, p.tenantId);
  let allocations: { invoiceId: string; amount: bigint }[];
  let remainder: bigint;
  if (planned?.length) {
    allocations = planned.map((a) => ({ invoiceId: a.invoiceId, amount: BigInt(a.amount) }));
    for (const a of allocations) {
      const inv = open.find((i) => i.id === a.invoiceId);
      if (!inv || a.amount > inv.balance)
        throw conflict('Planned allocation no longer matches the invoice balance', {
          invoiceId: a.invoiceId,
        });
    }
    remainder = p.amount - allocations.reduce((s, a) => s + a.amount, 0n);
  } else {
    const auto = allocateOldestFirst(
      p.amount,
      open
        .filter((i) => i.currency === p.currency)
        .map((i) => ({
          id: i.id,
          dueDate: isoOf(i.dueDate),
          issueDate: isoOf(i.issueDate),
          number: i.number,
          balance: i.balance,
        })),
    );
    allocations = auto.allocations;
    remainder = auto.remainder;
  }
  // Confirmed first: only allocations of CONFIRMED payments count in the invoice balances.
  const receiptNumber = await nextPlatformNumber(tx, 'receipt', Number(today.slice(0, 4)));
  await tx.payment.update({
    where: { id: paymentId },
    data: {
      status: 'CONFIRMED',
      validatedBy: actor.id,
      validatedAt: billingNow(),
      receiptNumber,
    },
  });
  for (const a of allocations)
    if (a.amount > 0n)
      await tx.paymentAllocation.create({
        data: { paymentId, invoiceId: a.invoiceId, amount: a.amount },
      });
  const changed = await recomputeInvoices(
    tx,
    allocations.map((a) => a.invoiceId),
  );
  if (remainder > 0n)
    await tx.tenantCredit.create({
      data: {
        tenantId: p.tenantId,
        sourcePaymentId: p.id,
        amount: remainder,
        currency: p.currency,
      },
    });
  const sub = await settleSubscription(
    tx,
    p.tenantId,
    today,
    actor,
    changed.filter((c) => c.to === 'PAID').map((c) => c.id),
  );
  await emit(tx, p.tenantId, BILLING_EVENTS.paymentConfirmed, {
    paymentId,
    receiptNumber,
    amount: p.amount.toString(),
  });
  return { receiptNumber, allocations, credit: remainder, subscription: sub };
}

/** After commit: caches, receipt PDF, receipt notice (e-mail / SMS). Never throws. */
async function afterConfirm(services: Services, paymentId: string, tenantId: string) {
  await invalidateTenantCaches(services, tenantId);
  let fileId: string | null = null;
  try {
    fileId = await renderReceiptPdf(services, paymentId);
  } catch (err) {
    services.logger.error('receipt pdf failed', { paymentId, err: (err as Error).message });
  }
  const p = await services.admin.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const url = fileId ? await signedFileUrl(services, tenantId, fileId).catch(() => null) : null;
  await sendBillingNotice(services, {
    tenantId,
    templateCode: 'payment_receipt_platform',
    idempotencyKey: `receipt:${paymentId}`,
    sms: (await loadBillingSettings(services.admin)).smsReminders,
    data: {
      receipt: { number: p.receiptNumber },
      payment: {
        amount: { amount: num(p.amount), currency: p.currency },
        method: p.method,
        paidAt: isoOf(p.paidAt),
      },
      document: { url: url ?? '' },
    },
  });
}

/** SA-35: second validation, by a different platform user. */
export async function validatePayment(services: Services, paymentId: string, actor: Actor) {
  const p = await services.admin.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment');
  if (p.status !== 'PENDING_VALIDATION')
    throw precondition('Payment is not pending validation', { status: p.status });
  if (p.recordedBy && p.recordedBy === actor.id)
    throw forbidden('The payment must be validated by another user', {
      reason: 'SAME_USER_VALIDATION',
    });
  const clock = await tenantClock(services.admin, p.tenantId);
  await inTx(services, (tx) => confirmInTx(tx, paymentId, actor, clock.today));
  await afterConfirm(services, paymentId, p.tenantId);
  return getPayment(services, paymentId);
}

/**
 * Reversal (doc 02 §4.3): never deleted — REVERSED with a mandatory reason; its allocations
 * stop counting (invoices re-opened), its credit is void, the subscription is re-evaluated
 * at once (PAST_DUE / SUSPENDED when the re-opened invoice is overdue), cancellation receipt.
 */
export async function reversePayment(
  services: Services,
  paymentId: string,
  reason: string,
  actor: Actor,
) {
  if (!reason.trim()) throw invalid('reason', 'A reason is required');
  const p0 = await services.admin.payment.findUnique({ where: { id: paymentId } });
  if (!p0) throw notFound('Payment');
  const settings = await loadBillingSettings(services.admin);
  const clock = await tenantClock(services.admin, p0.tenantId);
  const outcome = await inTx(services, async (tx) => {
    await lockTenantBilling(tx, p0.tenantId);
    const p = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { paymentAllocations: true },
    });
    if (p.status === 'REVERSED') throw precondition('Payment already reversed');
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: 'REVERSED',
        reversedBy: actor.id,
        reversedAt: billingNow(),
        reversalReason: reason.trim().slice(0, 1000),
      },
    });
    const reopened = await recomputeInvoices(
      tx,
      p.paymentAllocations.map((a) => a.invoiceId),
    );
    const sub = await currentSubscription(tx, p.tenantId);
    const decision = sub
      ? await reevaluate(tx, sub, clock.today, settings, actor, `payment reversed: ${reason}`)
      : null;
    await emit(tx, p.tenantId, BILLING_EVENTS.paymentReversed, { paymentId, reason });
    return { wasConfirmed: p.status === 'CONFIRMED', reopened, decision };
  });
  await invalidateTenantCaches(services, p0.tenantId);
  if (outcome.wasConfirmed)
    await renderReceiptPdf(services, paymentId, { reversal: true }).catch((err: unknown) =>
      services.logger.error('reversal receipt failed', { err: (err as Error).message }),
    );
  return { payment: await getPayment(services, paymentId), ...outcome };
}

export async function getPayment(services: Services, paymentId: string) {
  const p = await services.admin.payment.findUnique({
    where: { id: paymentId },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      paymentAllocations: {
        include: { invoice: { select: { id: true, number: true, status: true } } },
      },
      tenantCredits: true,
    },
  });
  if (!p) throw notFound('Payment');
  return serializePayment(p);
}

type PaymentFull = Prisma.PaymentGetPayload<{
  include: {
    tenant: { select: { id: true; name: true; slug: true } };
    paymentAllocations: {
      include: { invoice: { select: { id: true; number: true; status: true } } };
    };
    tenantCredits: true;
  };
}>;

export function serializePayment(p: PaymentFull) {
  const payload = p.providerPayload as PlannedPayload | null;
  return {
    id: p.id,
    tenant: p.tenant,
    amount: num(p.amount),
    currency: p.currency,
    method: p.method,
    reference: p.reference,
    paidAt: isoOf(p.paidAt),
    status: p.status,
    provider: p.provider,
    attachmentFileId: p.attachmentFileId,
    note: p.note,
    recordedBy: p.recordedBy,
    validatedBy: p.validatedBy,
    validatedAt: p.validatedAt?.toISOString() ?? null,
    reversedBy: p.reversedBy,
    reversedAt: p.reversedAt?.toISOString() ?? null,
    reversalReason: p.reversalReason,
    receiptNumber: p.receiptNumber,
    declarationId: payload?.declarationId ?? null,
    plannedAllocations: (payload?.allocations ?? []).map((a) => ({
      invoiceId: a.invoiceId,
      amount: Number(a.amount),
    })),
    allocations: p.paymentAllocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoice.number,
      invoiceStatus: a.invoice.status,
      amount: num(a.amount),
    })),
    credit: p.tenantCredits.reduce((s, c) => s + num(c.amount), 0),
    createdAt: p.createdAt.toISOString(),
  };
}

/** Signed URL of the receipt PDF (rendered on demand when missing). */
export async function receiptUrl(services: Services, paymentId: string, tenantId?: string) {
  const p = await services.admin.payment.findFirst({
    where: { id: paymentId, ...(tenantId ? { tenantId } : {}) },
  });
  if (!p) throw notFound('Payment');
  if (!p.receiptNumber) throw precondition('Payment has no receipt yet');
  let file = await findDocumentFile(services, p.tenantId, p.receiptNumber);
  if (!file) {
    const id = await renderReceiptPdf(services, p.id);
    file = id ? { id, key: '' } : null;
  }
  if (!file)
    throw new AppError('SERVICE_UNAVAILABLE', undefined, { detail: 'Receipt unavailable' });
  return {
    url: await signedFileUrl(services, p.tenantId, file.id),
    receiptNumber: p.receiptNumber,
  };
}
