import { AppError } from '../../lib/errors.js';
import { getFolio, prepareCheckout, recordPayment } from '../folio/index.js';
import { issueInvoice } from '../invoicing/index.js';
import { conflict, formatDay, invalid, must } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import { publishPlanningChanged } from '../reservations/events.js';
import { requireProperty, TX_OPTS } from '../reservations/service.js';
import { addDays } from '../availability/dates.js';
import { primaryGuestId, requirePermission, resolveStay, setHkStatus } from './common.js';
import { FRONT_DESK_EVENTS, publishStayEvent } from './events.js';
import { sendStayNotice } from './notices.js';
import type { CheckoutInput } from './schemas.js';
import { earlyDeparture } from './stay-ops.js';

type Prepared = Awaited<ReturnType<typeof prepareCheckout>>;

/** Check-out preview (OP-23): nights are posted up to the business date, then balance + blockers. */
export async function previewCheckout(ctx: RCtx, id: string) {
  const { rr, stayId } = await resolveStay(ctx, id);
  const prep = await prepareCheckout(ctx, rr.id);
  const folios = [];
  const departments = new Map<string, number>();
  let charges = 0;
  let payments = 0;
  for (const f of prep.folios) {
    const full = await getFolio(ctx, f.id);
    charges += full.chargesTotal;
    payments += full.paymentsTotal;
    for (const l of full.lines) {
      const k = l.departmentCode ?? l.type;
      departments.set(k, (departments.get(k) ?? 0) + l.amount);
    }
    folios.push({
      id: f.id,
      number: f.number,
      status: f.status,
      balance: full.balance,
      currency: full.currency,
      chargesTotal: full.chargesTotal,
      paymentsTotal: full.paymentsTotal,
    });
  }
  const currency = folios[0]?.currency ?? rr.currency;
  const planned = formatDay(rr.departure);
  const minimum = addDays(formatDay(rr.arrival), 1);
  const effective = prep.businessDate > minimum ? prep.businessDate : minimum;
  return {
    stayId,
    reservationRoomId: rr.id,
    reservationId: rr.reservationId,
    reservationNumber: rr.reservation.number,
    roomNumber: rr.room?.number ?? null,
    businessDate: prep.businessDate,
    arrival: prep.arrival,
    departure: prep.departure,
    currency,
    earlyDeparture: planned > effective,
    postedNights: prep.postedNights.length,
    folios,
    summary: [...departments].map(([department, amount]) => ({ department, amount })),
    chargesTotal: charges,
    paymentsTotal: payments,
    balance: prep.balance,
    blockers: prep.blockers,
    canCheckout: prep.canCheckout,
    company: rr.reservation.companyId,
    primaryGuestId: primaryGuestId(rr),
  };
}

const settleable = (b: Prepared['blockers'][number]) =>
  b.code === 'UNPAID_BALANCE' || b.code === 'CREDIT_BALANCE';

/**
 * `POST /front-desk/stays/:id/checkout` (OP-23). Blockers (unpaid / credit balance, open POS
 * orders) refuse the check-out unless the balance goes to a company account (city ledger, NIF
 * required) or the user holds `front_desk.checkout_with_balance` and gives a reason (audited).
 */
export async function checkOut(ctx: RCtx, id: string, input: CheckoutInput) {
  const { rr, stayId } = await resolveStay(ctx, id);
  if (rr.status !== 'CHECKED_IN')
    throw conflict(`A ${rr.status} stay cannot be checked out`, {
      reason: 'NOT_IN_HOUSE',
      status: rr.status,
    });
  if (input.overrideReason)
    requirePermission(
      ctx,
      'front_desk.checkout_with_balance',
      'Checking out with a balance needs front_desk.checkout_with_balance',
    );
  const prop = await requireProperty(ctx, rr.propertyId);
  const warnings: string[] = [];

  // Early check-out: remaining nights are released first (the departure date follows).
  const planned = formatDay(rr.departure);
  const minimum = addDays(formatDay(rr.arrival), 1);
  const effective = prop.businessDate > minimum ? prop.businessDate : minimum;
  if (planned > effective) {
    if (!input.earlyDeparture)
      throw conflict(`The planned departure is ${planned}: confirm the early departure`, {
        reason: 'EARLY_DEPARTURE',
        plannedDeparture: planned,
        departure: effective,
      });
    await earlyDeparture(ctx, rr.id, effective);
  }

  let prep = await prepareCheckout(ctx, rr.id);

  // Unpaid balance → company account (city ledger); NIF mandatory (doc 09 §3 invoices).
  let transferred = 0;
  if (input.transferToCompanyId) {
    const company = must(
      await ctx.db.company.findFirst({ where: { id: input.transferToCompanyId, deletedAt: null } }),
      'Company',
    );
    if (!company.taxId?.trim())
      throw invalid(
        'transferToCompanyId',
        'The company needs a NIF (tax id) to receive a transfer',
        'NIF_REQUIRED',
      );
    requirePermission(ctx, 'folio.pay', 'Transferring a balance needs folio.pay');
    for (const f of prep.folios.filter((x) => x.balance > 0)) {
      await recordPayment(ctx, f.id, {
        method: 'CITY_LEDGER',
        companyId: company.id,
        amount: f.balance,
        isDeposit: false,
      });
      transferred += f.balance;
    }
    if (transferred) prep = await prepareCheckout(ctx, rr.id);
  }

  const blockers = prep.blockers.filter((b) => b.code !== 'NOT_IN_HOUSE');
  let overridden: Prepared['blockers'] = [];
  if (blockers.length) {
    if (!input.overrideReason)
      throw new AppError('CONFLICT', undefined, {
        detail: 'The check-out is blocked',
        meta: { reason: 'CHECKOUT_BLOCKED', blockers, balance: prep.balance },
      });
    overridden = blockers;
  }

  const settled = prep.folios.every((f) => f.balance === 0) && blockers.every((b) => !settleable(b));
  const now = new Date();
  const out = await ctx.db.$transaction(async (tx) => {
    const n = await tx.reservationRoom.updateMany({
      where: { id: rr.id, status: 'CHECKED_IN' },
      data: { status: 'CHECKED_OUT' },
    });
    if (n.count !== 1) throw conflict('The stay changed meanwhile, retry');
    await tx.stay.update({
      where: { id: stayId },
      data: { checkedOutAt: now, checkedOutBy: ctx.actorId },
    });
    const lines = await tx.reservationRoom.findMany({
      where: { reservationId: rr.reservationId },
      select: { id: true, status: true },
    });
    const live = lines.filter((l) => !['CANCELLED', 'NO_SHOW'].includes(l.status));
    const allOut = live.every((l) => ['CHECKED_OUT', 'COMPLETED'].includes(l.status));
    let reservationStatus: 'CHECKED_IN' | 'CHECKED_OUT' | 'COMPLETED' = 'CHECKED_IN';
    if (allOut) {
      reservationStatus = 'CHECKED_OUT';
      if (settled) {
        const unsettled = await tx.folio.count({
          where: {
            propertyId: rr.propertyId,
            stay: { reservationRoom: { reservationId: rr.reservationId } },
            balance: { not: 0n },
          },
        });
        if (!unsettled) reservationStatus = 'COMPLETED';
      }
      await tx.reservation.updateMany({
        where: { id: rr.reservationId, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } },
        data: { status: reservationStatus },
      });
      if (reservationStatus === 'COMPLETED')
        await tx.reservationRoom.updateMany({
          where: { reservationId: rr.reservationId, status: 'CHECKED_OUT' },
          data: { status: 'COMPLETED' },
        });
    }
    if (rr.roomId) await setHkStatus(ctx, tx, rr.roomId, 'DIRTY', `Départ — ${rr.reservation.number}`);
    await publishPlanningChanged(tx, {
      propertyId: rr.propertyId,
      reservationId: rr.reservationId,
      action: 'check_out',
      from: formatDay(rr.arrival),
      to: formatDay(rr.departure),
      reservationRoomIds: [rr.id],
    });
    await publishStayEvent(tx, FRONT_DESK_EVENTS.checkedOut, {
      propertyId: rr.propertyId,
      stayId,
      reservationId: rr.reservationId,
      reservationRoomId: rr.id,
      roomId: rr.roomId,
    });
    return reservationStatus;
  }, TX_OPTS);

  // Invoice(s): one per folio of the room; never undoes the check-out.
  const invoices: { id: string; number: string; folioId: string; total: number }[] = [];
  if (input.invoice?.issue) {
    for (const f of prep.folios) {
      if (f.balance !== 0 || f.status !== 'OPEN') {
        warnings.push(`INVOICE_SKIPPED: folio ${f.number} is not settled`);
        continue;
      }
      try {
        const inv = await issueInvoice(ctx, {
          folioId: f.id,
          ...(input.invoice.customer ? { customer: input.invoice.customer } : {}),
          sendEmail: input.invoice.sendEmail,
        });
        invoices.push({ id: inv.id, number: inv.number, folioId: f.id, total: inv.total });
      } catch (err) {
        const m = err instanceof AppError ? (err.detail ?? err.message) : (err as Error).message;
        warnings.push(`INVOICE_FAILED: ${f.number}: ${m}`);
      }
    }
  }

  let notified = false;
  const guestId = primaryGuestId(rr);
  if (input.notifyGuest && guestId) {
    const guest = await ctx.db.guest.findFirst({ where: { id: guestId } });
    if (guest)
      notified = await sendStayNotice(ctx, {
        template: 'post_stay',
        propertyId: rr.propertyId,
        guest: {
          id: guest.id,
          firstName: guest.firstName,
          lastName: guest.lastName,
          email: guest.email,
          phone: guest.phone,
        },
        hotel: { name: prop.name, phone: prop.phone },
        reservation: { roomNumber: rr.room?.number ?? '', checkOut: prep.departure },
        idempotencyKey: `stay:${stayId}:post_stay`,
      });
  }

  await ctx.audit({
    action: overridden.length ? 'front_desk.check_out.override' : 'front_desk.check_out',
    entity: 'stay',
    entityId: stayId,
    after: {
      reservationId: rr.reservationId,
      reservationRoomId: rr.id,
      balance: prep.balance,
      transferredToCityLedger: transferred,
      transferCompanyId: input.transferToCompanyId ?? null,
      reservationStatus: out,
      invoices: invoices.map((i) => i.number),
      ...(overridden.length
        ? { overrideReason: input.overrideReason, blockers: overridden.map((b) => b.code) }
        : {}),
    },
  });
  return {
    stayId,
    reservationRoomId: rr.id,
    reservationId: rr.reservationId,
    reservationStatus: out,
    balance: prep.balance,
    transferred,
    overridden: overridden.map((b) => b.code),
    invoices,
    notified,
    warnings,
  };
}

