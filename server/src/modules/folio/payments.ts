import type { FolioPaymentMethod } from '@hm/database';
import { AppError } from '../../lib/errors.js';
import { renderPdf } from '../notifications/jobs.js';
import { notificationDeps } from '../notifications/deps.js';
import { conflict, formatDay, invalid, must, num } from '../property/common.js';
import { TX_OPTS } from '../reservations/service.js';
import { openSessionOf } from '../cashier/service.js';
import { rateFor } from '../cashier/exchange-rates.js';
import { FOLIO_EVENTS, publishFinance, publishFolioChanged } from './events.js';
import { customerParty, defaultCustomer, METHOD_LABELS, sellerParty } from './parties.js';
import {
  advisoryLock,
  assertOpen,
  DEPT,
  folioSums,
  lineInclude,
  loadProperty,
  lockFolio,
  refreshBalance,
  SRC,
  toPayment,
  type Db,
  type FolioRow,
  type Tx,
} from './repository.js';
import {
  companyAccountWhere,
  ensureCompanyFolio,
  getFolio,
  loadFolio,
  writeReversal,
  type FCtx,
} from './service.js';
import { folioSettings } from './settings.js';
import { convertMinor, TaxMathError } from './tax-math.js';

export interface PaymentInput {
  method: FolioPaymentMethod;
  /** Amount applied to the folio, in the folio currency. */
  amount?: number | undefined;
  tenderedCurrency?: string | undefined;
  tenderedAmount?: number | undefined;
  reference?: string | undefined;
  isDeposit?: boolean | undefined;
  /** CITY_LEDGER: company account the balance is transferred to. */
  companyId?: string | undefined;
}

const setting = <T>(ctx: FCtx, def: { key: string; default: T }, propertyId: string) =>
  ctx.services.settings.get(def as never, { tenantId: ctx.tenantId, propertyId }) as Promise<T>;

const notInPlan = (feature: string) =>
  new AppError('FEATURE_NOT_IN_PLAN', undefined, {
    detail: `Feature ${feature} is not included in your subscription`,
    meta: { feature },
  });

export const changeReason = (paymentId: string) => `Rendu de monnaie — paiement ${paymentId}`;

async function checkReference(
  ctx: FCtx,
  tx: Tx,
  propertyId: string,
  method: FolioPaymentMethod,
  reference: string,
) {
  const patterns = await setting(ctx, folioSettings.referencePatterns, propertyId);
  const re = patterns[method];
  if (re && !new RegExp(re).test(reference))
    throw invalid('reference', `Invalid ${method} reference format`, 'REFERENCE_FORMAT');
  await advisoryLock(tx, `payref:${method}:${reference}`);
  const dup = await tx.folioPayment.findFirst({
    where: { method, reference, status: { not: 'REVERSED' }, amount: { gt: 0n } },
    select: { id: true, folioId: true },
  });
  if (dup)
    throw conflict(`Reference ${reference} is already used by another ${method} payment`, {
      reason: 'DUPLICATE_REFERENCE',
      paymentId: dup.id,
    });
}

/** Is a folio pre-arrival (reservation folio without stay)? Its payments are deposits. */
const isReservationFolio = (f: FolioRow) => !f.stayId && !f.groupId && !f.companyId;

async function companyBalance(tx: Tx, companyId: string) {
  const accounts = await tx.folio.findMany({ where: companyAccountWhere(companyId), select: { id: true } });
  let total = 0n;
  for (const a of accounts) total += (await folioSums(tx, a.id)).balance;
  return total;
}

/** Guest payment on a folio (OP-91, EX-21). Idempotency is handled by the route. */
export async function recordPayment(ctx: FCtx, folioId: string, input: PaymentInput) {
  const f0 = await loadFolio(ctx, folioId);
  const ent = (k: string) => ctx.services.entitlements.has(ctx.tenantId, k);
  if (input.method === 'LOYALTY_POINTS') {
    if (!(await ent('loyalty'))) throw notInPlan('loyalty');
    throw new AppError('PRECONDITION_FAILED', undefined, {
      detail: 'Loyalty points redemption is not available yet',
      meta: { reason: 'NOT_IMPLEMENTED' },
    });
  }
  if (input.method === 'CITY_LEDGER') {
    if (!(await ent('city_ledger'))) throw notInPlan('city_ledger');
    if (!input.companyId) throw invalid('companyId', 'companyId is required for CITY_LEDGER');
    if (input.tenderedAmount !== undefined)
      throw invalid('tenderedAmount', 'A city-ledger transfer has no tender');
  }
  const reference = input.reference?.trim() || null;
  const out = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, f0.id);
    assertOpen(folio);
    const prop = await loadProperty(tx, folio.propertyId);
    const session = await openSessionOf(tx, ctx.userId, folio.propertyId);
    if (input.method === 'CASH' && !session)
      throw new AppError('PRECONDITION_FAILED', undefined, {
        detail: 'Open a cash session before taking cash',
        meta: { reason: 'NO_OPEN_CASH_SESSION' },
      });
    const { balance } = await folioSums(tx, folio.id);
    let applied: bigint;
    let tender: { currency: string; amount: bigint; rate: string; converted: bigint } | null = null;
    if (input.tenderedAmount !== undefined) {
      const currency = input.tenderedCurrency ?? folio.currency;
      const rate =
        currency === folio.currency
          ? '1'
          : await rateFor(
              tx,
              currency,
              folio.currency,
              prop.businessDate,
              await setting(ctx, folioSettings.fxMaxRateAgeDays, folio.propertyId),
            );
      const rounding = await setting(ctx, folioSettings.fxRounding, folio.propertyId);
      let converted: bigint;
      try {
        converted = convertMinor(BigInt(input.tenderedAmount), rate, currency, folio.currency, rounding);
      } catch (e) {
        if (e instanceof TaxMathError) throw invalid('tenderedAmount', e.message);
        throw e;
      }
      applied =
        input.amount !== undefined
          ? BigInt(input.amount)
          : balance > 0n && converted > balance
            ? balance
            : converted;
      if (converted < applied)
        throw invalid('tenderedAmount', `The tender (${converted} ${folio.currency}) is below the amount`, 'TENDER_TOO_LOW');
      tender = { currency, amount: BigInt(input.tenderedAmount), rate, converted };
    } else if (input.amount !== undefined) {
      applied = BigInt(input.amount);
    } else if (input.method === 'CITY_LEDGER') {
      applied = balance;
    } else {
      throw invalid('amount', 'amount or tenderedAmount is required');
    }
    if (applied <= 0n) throw invalid('amount', 'Nothing to pay', 'NOTHING_TO_PAY');
    const change = tender ? tender.converted - applied : 0n;
    if (change > 0n && input.method !== 'CASH')
      throw invalid('tenderedAmount', 'Change can only be given on a cash payment', 'NO_CHANGE');
    if (reference) await checkReference(ctx, tx, folio.propertyId, input.method, reference);

    let company: Awaited<ReturnType<typeof ensureCompanyFolio>> | null = null;
    if (input.method === 'CITY_LEDGER') {
      if (folio.companyId && folio.number.startsWith('CL-'))
        throw invalid('method', 'A company account cannot be transferred to the city ledger');
      if (applied > balance)
        throw invalid('amount', 'A city-ledger transfer cannot exceed the balance', 'TOO_LARGE');
      const c = must(await tx.company.findFirst({ where: { id: input.companyId!, deletedAt: null } }), 'Company');
      if (c.creditLimit !== null) {
        const current = await companyBalance(tx, c.id);
        if (current + applied > c.creditLimit)
          throw conflict('The company credit limit would be exceeded', {
            reason: 'CREDIT_LIMIT_EXCEEDED',
            creditLimit: num(c.creditLimit),
            balance: num(current),
          });
      }
      company = await ensureCompanyFolio(ctx, tx, c.id, folio.propertyId);
    }

    const p = await tx.folioPayment.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        cashSessionId: session?.id ?? null,
        currency: folio.currency,
        amount: applied,
        method: input.method,
        reference,
        isDeposit: input.isDeposit ?? isReservationFolio(folio),
        tenderedCurrency: tender?.currency ?? null,
        tenderedAmount: tender?.amount ?? null,
        rate: tender?.rate ?? null,
        createdBy: ctx.actorId,
      },
    });
    if (change > 0n)
      await tx.cashMovement.create({
        data: {
          tenantId: ctx.tenantId,
          cashSessionId: session!.id,
          type: 'OUT',
          currency: folio.currency,
          amount: change,
          reason: changeReason(p.id),
          createdBy: ctx.actorId,
        },
      });
    if (company) {
      const account = await lockFolio(tx, company.id);
      assertOpen(account);
      await tx.folioLine.create({
        data: {
          tenantId: ctx.tenantId,
          propertyId: account.propertyId,
          folioId: account.id,
          businessDate: new Date(`${prop.businessDate}T00:00:00.000Z`),
          type: 'ADJUSTMENT',
          departmentCode: DEPT.cityLedger,
          label: `Transfert du folio ${folio.number}`,
          qty: '1',
          currency: account.currency,
          unitAmount: applied,
          amount: applied,
          sourceType: SRC.transfer,
          sourceId: p.id,
          createdBy: ctx.actorId,
        },
      });
      await refreshBalance(tx, account.id);
      await publishFolioChanged(tx, account, 'city_ledger_transfer_in', { sourceFolioId: folio.id });
    }
    await refreshBalance(tx, folio.id);
    await publishFolioChanged(tx, folio, 'payment_recorded', { paymentId: p.id });
    await publishFinance(tx, FOLIO_EVENTS.paymentRecorded, {
      propertyId: folio.propertyId,
      folioId: folio.id,
      paymentId: p.id,
      method: p.method,
      amount: num(p.amount),
    });
    await ctx.audit({
      action: 'folio.payment.record',
      entity: 'folio_payment',
      entityId: p.id,
      after: { ...toPayment(p), change: num(change), companyFolioId: company?.id ?? null },
    });
    return { p, change, converted: tender?.converted ?? applied, companyFolioId: company?.id ?? null };
  }, TX_OPTS);
  return {
    payment: toPayment(out.p),
    convertedAmount: num(out.converted),
    change: num(out.change),
    changeCurrency: f0.currency,
    companyFolioId: out.companyFolioId,
    folio: await getFolio(ctx, f0.id),
  };
}

/** Refund of a credit balance (overpayment, credit note): a negative payment. */
export async function recordRefund(
  ctx: FCtx,
  folioId: string,
  input: { method: FolioPaymentMethod; amount: number; reference?: string | undefined; reason: string },
) {
  if (input.method === 'CITY_LEDGER' || input.method === 'LOYALTY_POINTS')
    throw invalid('method', 'Refunds are paid in cash, card, transfer or mobile money');
  const f0 = await loadFolio(ctx, folioId);
  const p = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, f0.id);
    const session = await openSessionOf(tx, ctx.userId, folio.propertyId);
    if (input.method === 'CASH' && !session)
      throw new AppError('PRECONDITION_FAILED', undefined, {
        detail: 'Open a cash session before paying out cash',
        meta: { reason: 'NO_OPEN_CASH_SESSION' },
      });
    const { balance } = await folioSums(tx, folio.id);
    if (BigInt(input.amount) > -balance)
      throw invalid('amount', `The refund exceeds the credit balance (${-balance})`, 'TOO_LARGE');
    const row = await tx.folioPayment.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        cashSessionId: session?.id ?? null,
        currency: folio.currency,
        amount: -BigInt(input.amount),
        method: input.method,
        reference: input.reference?.trim() || null,
        createdBy: ctx.actorId,
      },
    });
    await refreshBalance(tx, folio.id);
    await publishFolioChanged(tx, folio, 'refund_recorded', { paymentId: row.id });
    await ctx.audit({
      action: 'folio.payment.refund',
      entity: 'folio_payment',
      entityId: row.id,
      after: { ...toPayment(row), reason: input.reason },
    });
    return row;
  }, TX_OPTS);
  return { payment: toPayment(p), folio: await getFolio(ctx, f0.id) };
}

/** Payment reversal (folio.reverse, reason): a counter-payment, the original is never deleted. */
export async function reversePayment(ctx: FCtx, folioId: string, paymentId: string, reason: string) {
  const f0 = await loadFolio(ctx, folioId);
  const rev = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, f0.id);
    assertOpen(folio);
    const p = await tx.folioPayment.findFirst({
      where: { id: paymentId, folioId: folio.id },
      include: { reversalOf: { select: { id: true } } },
    });
    if (!p) throw new AppError('NOT_FOUND', undefined, { detail: 'Payment not found' });
    if (p.reversalOf) throw conflict('A reversal cannot be reversed', { reason: 'IS_REVERSAL' });
    if (p.reversedById || p.status === 'REVERSED')
      throw conflict('The payment is already reversed', { reason: 'ALREADY_REVERSED' });
    if (p.status !== 'CONFIRMED') throw conflict('Only a confirmed payment can be reversed');
    const session = await openSessionOf(tx, ctx.userId, folio.propertyId);
    if (p.method === 'CASH' && !session)
      throw new AppError('PRECONDITION_FAILED', undefined, {
        detail: 'Open a cash session before reversing a cash payment',
        meta: { reason: 'NO_OPEN_CASH_SESSION' },
      });
    const r = await tx.folioPayment.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        cashSessionId: session?.id ?? null,
        currency: p.currency,
        amount: -p.amount,
        method: p.method,
        isDeposit: p.isDeposit,
        tenderedCurrency: p.tenderedCurrency,
        tenderedAmount: p.tenderedAmount === null ? null : -p.tenderedAmount,
        rate: p.rate,
        createdBy: ctx.actorId,
      },
    });
    await tx.folioPayment.update({
      where: { id: p.id },
      data: { status: 'REVERSED', reversedById: r.id, reversedAt: new Date(), reversalReason: reason },
    });
    // Change given on the original cash payment comes back into the drawer.
    const change = await tx.cashMovement.findFirst({ where: { reason: changeReason(p.id), type: 'OUT' } });
    if (change && session)
      await tx.cashMovement.create({
        data: {
          tenantId: ctx.tenantId,
          cashSessionId: session.id,
          type: 'IN',
          currency: change.currency,
          amount: change.amount,
          reason: `Annulation du rendu — paiement ${p.id}`,
          createdBy: ctx.actorId,
        },
      });
    if (p.method === 'CITY_LEDGER') {
      const line = await tx.folioLine.findFirst({
        where: { sourceType: SRC.transfer, sourceId: p.id, reversalOfId: null, reversal: { is: null } },
        include: lineInclude,
      });
      if (line) {
        const account = await lockFolio(tx, line.folioId);
        const prop = await loadProperty(tx, account.propertyId);
        await writeReversal(ctx, tx, account, [line], `Annulation (${reason}) : `, prop.businessDate);
        await refreshBalance(tx, account.id);
        await publishFolioChanged(tx, account, 'city_ledger_transfer_reversed', { paymentId: p.id });
      }
    }
    await refreshBalance(tx, folio.id);
    await publishFolioChanged(tx, folio, 'payment_reversed', { paymentId: p.id });
    await ctx.audit({
      action: 'folio.payment.reverse',
      entity: 'folio_payment',
      entityId: p.id,
      before: toPayment(p),
      after: { reversalId: r.id, reason },
    });
    return r;
  }, TX_OPTS);
  return { reversal: toPayment(rev), folio: await getFolio(ctx, f0.id) };
}

/** Receipt number of a payment (no column: derived from the immutable payment id). */
export const receiptNumber = (paymentId: string) =>
  `REC-${paymentId.replace(/-/g, '').slice(-10).toUpperCase()}`;

/** Receipt PDF of a payment: 80 mm ticket or A4 receipt, via renderPdf (stored as a file). */
export async function renderReceipt(
  ctx: FCtx,
  folioId: string,
  paymentId: string,
  format: 'ticket' | 'a4',
) {
  const folio = await loadFolio(ctx, folioId);
  const p = must(await ctx.db.folioPayment.findFirst({ where: { id: paymentId, folioId: folio.id } }), 'Payment');
  const db = ctx.db as unknown as Db & Parameters<typeof defaultCustomer>[0];
  const fdto = await getFolio(ctx, folio.id);
  const customer = await defaultCustomer(db, folio, fdto);
  const seller = await sellerParty(ctx.services, db, ctx.tenantId, folio.propertyId);
  const number = receiptNumber(p.id);
  const method = METHOD_LABELS[p.method] ?? p.method;
  const issuedAt = formatDay(p.paidAt);
  const money = { amount: num(p.amount), currency: p.currency };
  const out =
    format === 'ticket'
      ? await renderPdf(ctx.services, {
          type: 'ticket',
          data: {
            number,
            issuedAt,
            seller,
            lines: [{ description: `Paiement folio ${folio.number}${p.reference ? ` (${p.reference})` : ''}`, quantity: 1, total: money }],
            total: money,
            paymentMethod: method,
          },
          fileName: `${number}-ticket.pdf`,
          ...(ctx.actorId ? { createdBy: ctx.actorId } : {}),
        })
      : await renderPdf(ctx.services, {
          type: 'receipt',
          data: {
            number,
            issuedAt,
            seller,
            payer: customerParty(customer).name,
            amount: money,
            method,
            ...(p.reference ? { reference: p.reference } : {}),
          },
          fileName: `${number}.pdf`,
          ...(ctx.actorId ? { createdBy: ctx.actorId } : {}),
        });
  const url = await notificationDeps(ctx.services).storage.signedUrl(out.key);
  await ctx.audit({ action: 'folio.receipt.render', entity: 'folio_payment', entityId: p.id, after: { number, format, fileId: out.fileId } });
  return { number, format, fileId: out.fileId, url };
}
