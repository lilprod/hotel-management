import type { Prisma } from '@hm/database';
import type { InvoiceData } from '@hm/templates';
import type { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { providerSettings } from '../../lib/providers/index.js';
import { renderPdf } from '../notifications/jobs.js';
import { notificationDeps } from '../notifications/deps.js';
import { assertPropertyAccess, conflict, formatDay, invalid, must, num, parseDay } from '../property/common.js';
import { sendGuestNotice } from '../reservations/context.js';
import { TX_OPTS } from '../reservations/service.js';
import { formatSequence, nextSequence, sequenceScope } from '../sequences/service.js';
import { FOLIO_EVENTS, publishFinance, publishFolioChanged } from '../folio/events.js';
import {
  companySnapshot,
  customerParty,
  defaultCustomer,
  guestSnapshot,
  METHOD_LABELS,
  sellerParty,
  type CustomerSnapshot,
} from '../folio/parties.js';
import {
  asTx,
  breakdown,
  COUNTED_PAYMENT_STATUSES,
  folioSums,
  isLive,
  lineInclude,
  loadProperty,
  lockFolio,
  rateLabel,
  refreshBalance,
  SRC,
  taxesByCode,
  type Breakdown,
  type LineRow,
  type Tx,
} from '../folio/repository.js';
import { addDays, lineGroup, linksOf, loadFolio, writeReversal, type FCtx } from '../folio/service.js';
import type { creditNoteBody, customerInput, issueBody, listQuery } from './schemas.js';
import { invoicingSettings } from './settings.js';

const setting = <T>(ctx: FCtx, def: { key: string; default: T }, propertyId: string) =>
  ctx.services.settings.get(def as never, { tenantId: ctx.tenantId, propertyId }) as Promise<T>;

interface InvoiceLineJson {
  lineId: string;
  description: string;
  /** Night of a room-night line (ISO day): formatted per locale when the document is rendered. */
  nightDate?: string;
  quantity: number;
  unitAmount: number;
  net: number;
  taxRate: string;
}

interface InvoiceTotals {
  /** Every folio line covered by the document (charges, taxes, reversals). */
  lineIds: string[];
  lines: InvoiceLineJson[];
  breakdown: Breakdown;
  payments: { method: string; label: string; amount: number }[];
  stay: {
    reservation: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    /** Nights actually on the invoice; lower than `nights` for an interim invoice. */
    invoicedNights?: number;
  } | null;
  notes: string[];
  reason?: string;
}

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: { fiscalDocuments: true } }>;

const toInvoice = (i: InvoiceRow) => {
  const fd = [...i.fiscalDocuments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    id: i.id,
    propertyId: i.propertyId,
    folioId: i.folioId,
    number: i.number,
    kind: i.kind === 'CREDIT_NOTE' ? ('CREDIT_NOTE' as const) : ('INVOICE' as const),
    /** Stored kind: INTERIM (folio stays open), FINAL, COMPANY (city-ledger account), CREDIT_NOTE. */
    documentKind: i.kind,
    creditNoteOfId: i.creditNoteOfId,
    issueDate: formatDay(i.issueDate),
    customer: i.customerSnapshot as unknown as CustomerSnapshot,
    currency: i.currency,
    subtotal: num(i.subtotal),
    taxTotal: num(i.taxTotal),
    total: num(i.total),
    status: i.status,
    /** Part payable through the city ledger (settled by allocations of company settlements). */
    ledgerAmount: num(i.ledgerAmount),
    pdfFileId: i.pdfFileId,
    totals: i.totals as Record<string, unknown>,
    fiscal: fd
      ? { provider: fd.provider, status: fd.status, fiscalNumber: fd.fiscalNumber, qrCode: fd.qrCode }
      : null,
    createdAt: i.createdAt.toISOString(),
  };
};
export type InvoiceDto = ReturnType<typeof toInvoice>;

async function loadInvoice(ctx: FCtx, id: string): Promise<InvoiceRow> {
  const i = await ctx.db.invoice.findFirst({ where: { id }, include: { fiscalDocuments: true } });
  if (!i) throw notFound('Invoice not found');
  assertPropertyAccess(ctx, i.propertyId);
  return i;
}

export const getInvoice = async (ctx: FCtx, id: string) => toInvoice(await loadInvoice(ctx, id));

export async function listInvoices(ctx: FCtx, q: z.infer<typeof listQuery>) {
  if (q.propertyId) assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.invoice.findMany({
    where: {
      ...(q.propertyId
        ? { propertyId: q.propertyId }
        : ctx.grants.permissions.includes('*')
          ? {}
          : { propertyId: { in: ctx.grants.propertyIds } }),
      ...(q.folioId ? { folioId: q.folioId } : {}),
      ...(q.kind === 'INVOICE'
        ? { kind: { not: 'CREDIT_NOTE' as const } }
        : q.kind === 'CREDIT_NOTE'
          ? { kind: 'CREDIT_NOTE' as const }
          : {}),
      ...(q.from || q.to
        ? { issueDate: { ...(q.from ? { gte: parseDay(q.from) } : {}), ...(q.to ? { lte: parseDay(q.to) } : {}) } }
        : {}),
    },
    include: { fiscalDocuments: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > q.limit;
  const items = more ? rows.slice(0, q.limit) : rows;
  return { items: items.map(toInvoice), nextCursor: more ? (items[items.length - 1]?.id ?? null) : null };
}

/** Line ids already covered by an invoice or a credit note of the folio. */
async function coveredIds(tx: Tx, folioId: string): Promise<Set<string>> {
  const docs = await tx.invoice.findMany({ where: { folioId }, select: { totals: true } });
  const out = new Set<string>();
  for (const d of docs) for (const id of ((d.totals as unknown as InvoiceTotals).lineIds ?? [])) out.add(id);
  return out;
}

/** Legacy labels carried the ISO night (`… — nuit du 2026-11-22`): dropped, the date is structured. */
const LEGACY_NIGHT = /\s*[—-]\s*nuit du \d{4}-\d{2}-\d{2}\s*$/;

/**
 * Invoice lines of a set of folio lines. `nightOf` gives the night of a room-night line when it
 * differs from its own business date (credit note reversals: the night of the reversed line).
 */
function invoiceLines(
  lines: readonly LineRow[],
  taxCodes: ReadonlyMap<string, { type: string; value: string }>,
  nightOf: ReadonlyMap<string, string> = new Map(),
) {
  const ids = new Set(lines.map((l) => l.id));
  // A charge and its reversal both in the document cancel out: neither is printed.
  const cancelled = new Set<string>();
  for (const l of lines)
    if (l.reversalOfId && ids.has(l.reversalOfId)) {
      cancelled.add(l.id);
      cancelled.add(l.reversalOfId);
    }
  const ratesOf = new Map<string, string[]>();
  for (const l of lines)
    if (l.type === 'TAX' && l.sourceId) {
      const t = taxCodes.get(l.departmentCode ?? '');
      if (t?.type !== 'PERCENT') continue;
      const list = ratesOf.get(l.sourceId) ?? [];
      const r = rateLabel(t.value);
      if (!list.includes(r)) list.push(r);
      ratesOf.set(l.sourceId, list);
    }
  return lines
    .filter((l) => l.type !== 'TAX' && !cancelled.has(l.id))
    .map((l) => ({
      lineId: l.id,
      ...(l.type === 'ROOM' && l.sourceType === SRC.roomNight
        ? {
            description: l.label.replace(LEGACY_NIGHT, ''),
            nightDate: nightOf.get(l.id) ?? formatDay(l.businessDate),
          }
        : { description: l.label }),
      quantity: Number(l.qty),
      unitAmount: num(l.unitAmount),
      net: num(l.amount),
      // Plain numbers: the template adds the unit ("18", "18 + 5"), never the stored data.
      taxRate: (ratesOf.get(l.id) ?? ['0']).join(' + '),
    }));
}

async function paymentSummary(tx: Tx, folioId: string) {
  const rows = await tx.folioPayment.groupBy({
    by: ['method'],
    where: { folioId, status: { in: [...COUNTED_PAYMENT_STATUSES] } },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ method: r.method, label: METHOD_LABELS[r.method] ?? r.method, amount: num(r._sum.amount ?? 0n) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.method.localeCompare(b.method));
}

async function explicitCustomer(tx: Tx, c: z.infer<typeof customerInput>): Promise<CustomerSnapshot> {
  if (c.type === 'guest')
    return guestSnapshot(must(await tx.guest.findFirst({ where: { id: c.guestId, deletedAt: null } }), 'Guest'));
  return companySnapshot(must(await tx.company.findFirst({ where: { id: c.companyId, deletedAt: null } }), 'Company'));
}

/**
 * Stay period of an invoice. Checked-out stay (checkout path): the period is what was actually
 * due (the nights invoiced, an early departure does not pay unused nights). In-house stay
 * (interim invoice): the planned period is kept and `invoicedNights` states how many nights the
 * document really covers, so the header never claims more than the lines show.
 */
export async function stayInfo(tx: Tx, reservationRoomId: string | null, lines: readonly LineRow[] = []) {
  if (!reservationRoomId) return null;
  const rr = await tx.reservationRoom.findFirst({
    where: { id: reservationRoomId },
    include: { reservation: { select: { number: true } } },
  });
  if (!rr) return null;
  const planned = Math.round((rr.departure.getTime() - rr.arrival.getTime()) / 86_400_000);
  const invoiced = lines.filter(
    (l) => l.type === 'ROOM' && l.sourceType === SRC.roomNight && l.sourceId === rr.id && isLive(l),
  ).length;
  const arrival = formatDay(rr.arrival);
  const base = { reservation: rr.reservation.number, checkIn: arrival };
  if (['CHECKED_OUT', 'COMPLETED'].includes(rr.status) && invoiced > 0 && invoiced <= planned)
    return { ...base, checkOut: addDays(arrival, invoiced), nights: invoiced, invoicedNights: invoiced };
  return { ...base, checkOut: formatDay(rr.departure), nights: planned, invoicedNights: Math.min(invoiced, planned) };
}

/**
 * Issues the invoice of a folio (OP-92): the balance must be zero (paid, or transferred to a
 * company account). Gap-free number per property and year, customer snapshot, tax breakdown per
 * rate, tourist tax apart, payment methods; the folio is closed. Never modified afterwards.
 */
export async function issueInvoice(ctx: FCtx, input: z.infer<typeof issueBody>) {
  const f0 = await loadFolio(ctx, input.folioId);
  // Read before the transaction: settings use their own connection.
  const pattern = await setting(ctx, invoicingSettings.invoicePattern, f0.propertyId);
  const issued = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, f0.id);
    if (folio.status !== 'OPEN')
      throw conflict('The folio is already invoiced', { reason: 'ALREADY_INVOICED' });
    const links = await linksOf(tx, folio);
    // Interim invoice: the stay is still in house, later nights are posted on the same folio.
    // Only the final (check-out) invoice closes the folio.
    const interim =
      links.kind === 'STAY' &&
      !!links.reservationRoomId &&
      (await tx.reservationRoom.findFirst({ where: { id: links.reservationRoomId }, select: { status: true } }))
        ?.status === 'CHECKED_IN';
    const sums = await folioSums(tx, folio.id);
    if (sums.balance !== 0n)
      throw conflict('The folio balance must be settled (or transferred to the city ledger) first', {
        reason: 'UNPAID_BALANCE',
        balance: num(sums.balance),
      });
    const covered = await coveredIds(tx, folio.id);
    const lines = (
      await tx.folioLine.findMany({
        where: { folioId: folio.id },
        include: lineInclude,
        orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
    ).filter((l) => !covered.has(l.id));
    if (!lines.length) {
      // Final invoice after interim ones that already cover everything: just close the folio.
      const last = covered.size && !interim
        ? await tx.invoice.findFirst({
            where: { folioId: folio.id, kind: { not: 'CREDIT_NOTE' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : null;
      if (!last) throw conflict('Nothing to invoice on this folio', { reason: 'NOTHING_TO_INVOICE' });
      await tx.folio.update({ where: { id: folio.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await publishFolioChanged(tx, folio, 'invoiced', { invoiceId: last.id });
      return { id: last.id, fresh: false };
    }
    const taxes = await taxesByCode(tx, folio.propertyId);
    const bd = breakdown(lines, taxes);
    if (bd.total < 0) throw conflict('A negative total is a credit note, not an invoice', { reason: 'NEGATIVE_TOTAL' });
    const customer = input.customer
      ? await explicitCustomer(tx, input.customer)
      : await defaultCustomer(tx, folio, links);
    if (customer.type === 'company' && !customer.taxId)
      throw invalid('customer', 'A company invoice requires the company NIF (tax id)', 'NIF_REQUIRED');
    const prop = await loadProperty(tx, folio.propertyId);
    const year = Number(prop.businessDate.slice(0, 4));
    const seq = await nextSequence(tx, sequenceScope(ctx.tenantId, folio.propertyId), 'invoice', { year });
    const number = formatSequence(pattern, seq, year);
    const payments = await paymentSummary(tx, folio.id);
    const totals: InvoiceTotals = {
      lineIds: lines.map((l) => l.id),
      lines: invoiceLines(lines, taxes),
      breakdown: bd,
      payments,
      stay: await stayInfo(tx, links.reservationRoomId, lines),
      notes: input.notes ?? [],
    };
    const ledgerAmount = payments
      .filter((p) => p.method === 'CITY_LEDGER' && p.amount > 0)
      .reduce((s, p) => s + p.amount, 0);
    const inv = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        number,
        kind: interim ? 'INTERIM' : links.kind === 'COMPANY' ? 'COMPANY' : 'FINAL',
        issueDate: parseDay(prop.businessDate),
        customerSnapshot: customer as unknown as Prisma.InputJsonValue,
        currency: folio.currency,
        subtotal: BigInt(bd.net),
        taxTotal: BigInt(bd.percentTax + bd.fixedTax),
        total: BigInt(bd.total),
        totals: totals as unknown as Prisma.InputJsonValue,
        // Paid at issue unless part of it is payable by a company (city ledger).
        ledgerAmount: BigInt(Math.min(ledgerAmount, Math.max(bd.total, 0))),
        status: ledgerAmount > 0 ? 'ISSUED' : 'PAID',
        createdBy: ctx.actorId,
      },
    });
    if (!interim)
      await tx.folio.update({ where: { id: folio.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await publishFolioChanged(tx, folio, interim ? 'invoiced_interim' : 'invoiced', { invoiceId: inv.id });
    await publishFinance(tx, FOLIO_EVENTS.invoiceIssued, {
      propertyId: folio.propertyId,
      invoiceId: inv.id,
      number,
      total: bd.total,
    });
    await ctx.audit({ action: 'invoice.issue', entity: 'invoice', entityId: inv.id, after: { number, total: bd.total, folioId: folio.id, customer, interim } });
    return { id: inv.id, fresh: true };
  }, TX_OPTS);
  const id = issued.id;
  if (!issued.fresh) return getInvoice(ctx, id);
  await afterIssue(ctx, id, 'INVOICE');
  if (input.sendEmail ?? (await setting(ctx, invoicingSettings.emailOnIssue, f0.propertyId)))
    await emailInvoice(ctx, id, {}).catch((err: unknown) =>
      ctx.services.logger.warn('invoice e-mail failed', { invoiceId: id, err: (err as Error).message }),
    );
  return getInvoice(ctx, id);
}

/** PDF rendering then the fiscal hook (EX-51); failures never undo the issued document. */
async function afterIssue(ctx: FCtx, id: string, type: 'INVOICE' | 'CREDIT_NOTE') {
  try {
    await renderInvoiceDocument(ctx, id);
  } catch (err) {
    ctx.services.logger.error('invoice PDF rendering failed', { invoiceId: id, err: (err as Error).message });
  }
  await submitFiscal(ctx, id, type);
}

async function submitFiscal(ctx: FCtx, id: string, type: 'INVOICE' | 'CREDIT_NOTE') {
  const inv = await loadInvoice(ctx, id);
  const name = (await setting(ctx, providerSettings.fiscal, inv.propertyId)) as string;
  const base = { tenantId: ctx.tenantId, invoiceId: inv.id, provider: name };
  try {
    const provider = notificationDeps(ctx.services).providers.fiscalProvider(name);
    const r = await provider.submit({
      tenantId: ctx.tenantId,
      documentType: type,
      number: inv.number,
      issuedAt: inv.issueDate,
      total: { amount: inv.total, currency: inv.currency },
      payload: { customer: inv.customerSnapshot, totals: inv.totals } as Record<string, unknown>,
    });
    const status =
      r.status === 'NOT_APPLICABLE' ? 'SKIPPED' : r.status === 'PENDING' ? 'SUBMITTED' : r.status;
    await ctx.db.fiscalDocument.create({
      data: {
        ...base,
        provider: r.provider,
        status,
        fiscalNumber: r.fiscalNumber ?? null,
        qrCode: r.qrCode ?? null,
        payload: r.status === 'NOT_APPLICABLE' ? { reason: 'NOT_APPLICABLE' } : { result: r.status },
        submittedAt: new Date(),
      },
    });
  } catch (err) {
    await ctx.db.fiscalDocument.create({
      data: { ...base, status: 'ERROR', error: (err as Error).message.slice(0, 500) },
    });
  }
}

async function renderInvoiceDocument(ctx: FCtx, id: string): Promise<{ fileId: string; key: string }> {
  const inv = await loadInvoice(ctx, id);
  const t = inv.totals as unknown as InvoiceTotals;
  const c = inv.customerSnapshot as unknown as CustomerSnapshot;
  const of = inv.creditNoteOfId
    ? await ctx.db.invoice.findFirst({ where: { id: inv.creditNoteOfId }, select: { number: true } })
    : null;
  const mentions = await setting(ctx, invoicingSettings.legalMentions, inv.propertyId);
  const fd = [...inv.fiscalDocuments].find((d) => d.fiscalNumber);
  const m = (amount: number) => ({ amount, currency: inv.currency });
  const percentRows = t.breakdown.rows.filter((r) => r.type === 'PERCENT');
  const data: InvoiceData = {
    number: inv.number,
    issuedOn: formatDay(inv.issueDate),
    seller: await sellerParty(ctx.services, asTx(ctx.db), ctx.tenantId, inv.propertyId),
    buyer: customerParty(c),
    ...(t.stay ? { stay: t.stay } : {}),
    lines: t.lines.map((l) => ({
      description: l.description,
      ...(l.nightDate ? { nightDate: l.nightDate } : {}),
      quantity: l.quantity,
      unitPrice: m(l.unitAmount),
      net: m(l.net),
      taxRate: l.taxRate,
    })),
    taxBreakdown: [
      ...percentRows.map((r) => ({ rate: r.rate ?? '0', base: m(r.base), tax: m(r.amount) })),
      ...(t.breakdown.untaxedBase ? [{ rate: '0', base: m(t.breakdown.untaxedBase), tax: m(0) }] : []),
    ],
    ...(t.breakdown.fixedTax ? { touristTax: m(t.breakdown.fixedTax) } : {}),
    totalNet: m(t.breakdown.net),
    totalTax: m(t.breakdown.percentTax),
    totalGross: m(t.breakdown.total),
    ...(t.payments.length
      ? { payments: t.payments.map((p) => ({ method: p.method, label: p.label, amount: m(p.amount) })) }
      : {}),
    notes: [
      ...t.notes,
      ...(t.reason ? [`Motif : ${t.reason}`] : []),
      ...mentions,
      ...(fd?.fiscalNumber ? [`N° fiscal : ${fd.fiscalNumber}`] : []),
    ],
    ...(of ? { creditNoteOf: of.number } : {}),
  };
  const out = await renderPdf(ctx.services, {
    type: 'invoice',
    data,
    fileName: `${inv.number}.pdf`,
    ...(ctx.actorId ? { createdBy: ctx.actorId } : {}),
  });
  // Allowed by the immutability trigger: pdf_file_id may be set on an issued document.
  await ctx.db.invoice.update({ where: { id: inv.id }, data: { pdfFileId: out.fileId } });
  return out;
}

/** Signed URL of the PDF (rendered on demand when missing). */
export async function invoicePdf(ctx: FCtx, id: string) {
  const inv = await loadInvoice(ctx, id);
  let key: string;
  let fileId: string;
  const file = inv.pdfFileId ? await ctx.db.file.findFirst({ where: { id: inv.pdfFileId } }) : null;
  if (file) {
    key = file.key;
    fileId = file.id;
  } else {
    const out = await renderInvoiceDocument(ctx, inv.id);
    key = out.key;
    fileId = out.fileId;
  }
  return { fileId, url: await notificationDeps(ctx.services).storage.signedUrl(key) };
}

/** E-mails the invoice to the customer (notify `invoice_issued`). */
export async function emailInvoice(ctx: FCtx, id: string, input: { email?: string | undefined }) {
  const inv = await loadInvoice(ctx, id);
  const c = inv.customerSnapshot as unknown as CustomerSnapshot;
  const to = input.email ?? c.email;
  if (!to) throw invalid('email', 'The customer has no e-mail address', 'NO_EMAIL');
  const prop = must(await ctx.db.property.findFirst({ where: { id: inv.propertyId } }), 'Property');
  const doc = await invoicePdf(ctx, inv.id);
  await sendGuestNotice(ctx.services, {
    tenantId: ctx.tenantId,
    channels: ['email'],
    to: { email: to },
    templateCode: 'invoice_issued',
    ...(c.type === 'guest' && c.id ? { guestId: c.id } : {}),
    data: {
      guest: { firstName: c.name.split(' ')[0] ?? c.name, lastName: c.name },
      hotel: { name: prop.name, phone: prop.phone ?? '' },
      invoice: {
        number: inv.number,
        total: { amount: num(inv.total), currency: inv.currency },
        dueDate: formatDay(inv.issueDate),
      },
      document: { url: doc.url },
    },
    idempotencyKey: `invoice:${inv.id}:${to}:${Date.now()}`,
  });
  await ctx.audit({ action: 'invoice.email', entity: 'invoice', entityId: inv.id, after: { to } });
  return { sent: true, to };
}

/**
 * Credit note (avoir) on an invoice, full or partial (selected charges with their taxes and
 * discounts): the charges are reversed on the folio, the folio reopens with the credited amount
 * as balance (refund or re-billing); fully credited invoices become CREDITED.
 */
export async function issueCreditNote(ctx: FCtx, invoiceId: string, input: z.infer<typeof creditNoteBody>) {
  const inv0 = await loadInvoice(ctx, invoiceId);
  if (inv0.creditNoteOfId) throw conflict('A credit note cannot be credited', { reason: 'IS_CREDIT_NOTE' });
  if (inv0.status === 'CREDITED') throw conflict('The invoice is already fully credited', { reason: 'ALREADY_CREDITED' });
  const pattern = await setting(ctx, invoicingSettings.creditNotePattern, inv0.propertyId);
  const id = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, inv0.folioId);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: inv0.id } });
    if (inv.status === 'CREDITED') throw conflict('The invoice is already fully credited', { reason: 'ALREADY_CREDITED' });
    const t = inv.totals as unknown as InvoiceTotals;
    const lines = await tx.folioLine.findMany({ where: { id: { in: t.lineIds } }, include: lineInclude });
    const live = lines.filter((l) => !l.reversalOfId && !l.reversal && l.type !== 'TAX' && l.type !== 'DISCOUNT');
    const selected = input.lineIds ? live.filter((l) => input.lineIds!.includes(l.id)) : live;
    if (input.lineIds && selected.length !== new Set(input.lineIds).size)
      throw invalid('lineIds', 'Only live charges of this invoice can be credited', 'NOT_CREDITABLE');
    if (!selected.length) throw conflict('Nothing left to credit on this invoice', { reason: 'NOTHING_TO_CREDIT' });
    const prop = await loadProperty(tx, folio.propertyId);
    const year = Number(prop.businessDate.slice(0, 4));
    const seq = await nextSequence(tx, sequenceScope(ctx.tenantId, folio.propertyId), 'credit_note', { year });
    const number = formatSequence(pattern, seq, year);
    const reversals: LineRow[] = [];
    const nightOf = new Map<string, string>();
    for (const l of selected) {
      const group = await lineGroup(tx, folio.id, l);
      const map = await writeReversal(ctx, tx, folio, group, `Avoir ${number} : `, prop.businessDate, input.reason);
      for (const [orig, rev] of map) {
        const o = group.find((g) => g.id === orig);
        if (o) nightOf.set(rev.id, formatDay(o.businessDate));
      }
      reversals.push(...map.values());
    }
    const taxes = await taxesByCode(tx, folio.propertyId);
    const bd = breakdown(reversals, taxes);
    const totals: InvoiceTotals = {
      lineIds: reversals.map((l) => l.id),
      lines: invoiceLines(reversals, taxes, nightOf),
      breakdown: bd,
      payments: [],
      stay: t.stay,
      notes: [],
      reason: input.reason,
    };
    const cn = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        creditNoteOfId: inv.id,
        kind: 'CREDIT_NOTE',
        number,
        issueDate: parseDay(prop.businessDate),
        customerSnapshot: inv.customerSnapshot as Prisma.InputJsonValue,
        currency: inv.currency,
        subtotal: BigInt(bd.net),
        taxTotal: BigInt(bd.percentTax + bd.fixedTax),
        total: BigInt(bd.total),
        totals: totals as unknown as Prisma.InputJsonValue,
        status: 'ISSUED',
        createdBy: ctx.actorId,
      },
    });
    if (selected.length === live.length)
      await tx.invoice.update({ where: { id: inv.id }, data: { status: 'CREDITED' } });
    await tx.folio.update({ where: { id: folio.id }, data: { status: 'OPEN', closedAt: null } });
    await refreshBalance(tx, folio.id);
    await publishFolioChanged(tx, folio, 'credit_note', { invoiceId: inv.id, creditNoteId: cn.id });
    await publishFinance(tx, FOLIO_EVENTS.creditNoteIssued, {
      propertyId: folio.propertyId,
      invoiceId: inv.id,
      creditNoteId: cn.id,
      number,
      total: bd.total,
    });
    await ctx.audit({
      action: 'invoice.credit_note',
      entity: 'invoice',
      entityId: cn.id,
      after: { number, invoiceId: inv.id, total: bd.total, reason: input.reason, full: selected.length === live.length },
    });
    return cn.id;
  }, TX_OPTS);
  await afterIssue(ctx, id, 'CREDIT_NOTE');
  return getInvoice(ctx, id);
}
