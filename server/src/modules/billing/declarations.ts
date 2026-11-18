import type { Services } from '../../core/container.js';
import {
  BILLING_EVENTS,
  billingNow,
  emit,
  inTx,
  invalid,
  isoOf,
  notFound,
  num,
  precondition,
  tenantClock,
  type Actor,
} from './common.js';
import type { IsoDate } from './domain.js';
import { sendBillingNotice } from './notifier.js';
import { recordPayment, type PlatformMethod } from './payments.js';

export interface DeclarationInput {
  method: PlatformMethod;
  amount: number;
  currency?: string | undefined;
  reference?: string | undefined;
  paidAt: IsoDate;
  note?: string | undefined;
  attachmentFileId?: string | undefined;
}

type DeclarationRow = Awaited<
  ReturnType<Services['admin']['paymentDeclaration']['findUniqueOrThrow']>
>;

export function serializeDeclaration(d: DeclarationRow) {
  return {
    id: d.id,
    tenantId: d.tenantId,
    paymentId: d.paymentId,
    amount: num(d.amount),
    currency: d.currency,
    method: d.method,
    reference: d.reference,
    paidAt: isoOf(d.paidAt),
    attachmentFileId: d.attachmentFileId,
    note: d.note,
    status: d.status,
    submittedBy: d.submittedBy,
    reviewedBy: d.reviewedBy,
    reviewedAt: d.reviewedAt?.toISOString() ?? null,
    rejectReason: d.rejectReason,
    createdAt: d.createdAt.toISOString(),
  };
}

/** TN-31: the tenant declares a payment (SUBMITTED) for the Super Admin to review. */
export async function submitDeclaration(
  services: Services,
  tenantId: string,
  userId: string,
  input: DeclarationInput,
) {
  const clock = await tenantClock(services.admin, tenantId);
  if (input.paidAt > clock.today) throw invalid('paidAt', 'Payment date cannot be in the future');
  if (input.attachmentFileId) {
    const f = await services.admin.file.findFirst({
      where: { id: input.attachmentFileId, tenantId },
    });
    if (!f) throw invalid('attachmentFileId', 'Unknown attachment');
  }
  const tenant = await services.admin.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { defaultCurrency: true },
  });
  const d = await inTx(services, async (tx) => {
    const row = await tx.paymentDeclaration.create({
      data: {
        tenantId,
        amount: BigInt(input.amount),
        currency: input.currency ?? tenant.defaultCurrency,
        method: input.method,
        reference: input.reference?.trim() || null,
        paidAt: new Date(`${input.paidAt}T00:00:00.000Z`),
        attachmentFileId: input.attachmentFileId ?? null,
        note: input.note ?? null,
        submittedBy: userId,
      },
    });
    await emit(tx, tenantId, BILLING_EVENTS.declarationSubmitted, { declarationId: row.id });
    return row;
  });
  return serializeDeclaration(d);
}

async function submitted(services: Services, id: string) {
  const d = await services.admin.paymentDeclaration.findUnique({ where: { id } });
  if (!d) throw notFound('Declaration');
  if (d.status !== 'SUBMITTED')
    throw precondition('Declaration already reviewed', { status: d.status });
  return d;
}

/**
 * SA-36 approve: creates the CONFIRMED payment (same effects as a manual payment). The
 * declaration is claimed first (SUBMITTED → APPROVED) so a double click never pays twice.
 */
export async function approveDeclaration(services: Services, id: string, actor: Actor) {
  const d = await submitted(services, id);
  const claimed = await services.admin.paymentDeclaration.updateMany({
    where: { id, status: 'SUBMITTED' },
    data: { status: 'APPROVED', reviewedBy: actor.id, reviewedAt: billingNow() },
  });
  if (claimed.count !== 1) throw precondition('Declaration already reviewed');
  let payment;
  try {
    payment = await recordPayment(
      services,
      {
        tenantId: d.tenantId,
        amount: num(d.amount),
        currency: d.currency,
        method: d.method,
        reference: d.reference,
        paidAt: isoOf(d.paidAt),
        attachmentFileId: d.attachmentFileId,
        note: d.note,
      },
      actor,
      { declarationId: d.id, forceConfirm: true },
    );
  } catch (err) {
    await services.admin.paymentDeclaration.update({
      where: { id },
      data: { status: 'SUBMITTED', reviewedBy: null, reviewedAt: null },
    });
    throw err;
  }
  const row = await inTx(services, async (tx) => {
    const updated = await tx.paymentDeclaration.update({
      where: { id: d.id },
      data: { paymentId: payment.id },
    });
    await emit(tx, d.tenantId, BILLING_EVENTS.declarationReviewed, {
      declarationId: d.id,
      status: 'APPROVED',
      paymentId: payment.id,
    });
    return updated;
  });
  return { declaration: serializeDeclaration(row), payment };
}

/** SA-36 reject: reason mandatory, notified to the tenant. */
export async function rejectDeclaration(
  services: Services,
  id: string,
  reason: string,
  actor: Actor,
) {
  if (!reason.trim()) throw invalid('reason', 'A reason is required');
  const d = await submitted(services, id);
  const row = await inTx(services, async (tx) => {
    const updated = await tx.paymentDeclaration.update({
      where: { id: d.id },
      data: {
        status: 'REJECTED',
        rejectReason: reason.trim().slice(0, 1000),
        reviewedBy: actor.id,
        reviewedAt: billingNow(),
      },
    });
    await emit(tx, d.tenantId, BILLING_EVENTS.declarationReviewed, {
      declarationId: d.id,
      status: 'REJECTED',
    });
    return updated;
  });
  await sendBillingNotice(services, {
    tenantId: d.tenantId,
    templateCode: 'payment_declaration_rejected',
    idempotencyKey: `declaration-rejected:${d.id}`,
    data: { reason: row.rejectReason, declaration: { id: d.id } },
  });
  return serializeDeclaration(row);
}
