import type { Prisma } from '@hm/database';
import type { Services } from '../../core/container.js';
import { dateOf, isoOf, isoOrNull, notFound, num } from './common.js';
import { renderInvoicePdf, signedFileUrl } from './documents.js';
import { serializePayment } from './payments.js';

type InvoiceRow = Prisma.PlatformInvoiceGetPayload<{
  include: { tenant: { select: { id: true; name: true; slug: true } } };
}>;

export function serializeInvoice(i: InvoiceRow, today?: string) {
  const balance = i.total - i.amountPaid;
  return {
    id: i.id,
    number: i.number,
    tenant: i.tenant,
    subscriptionId: i.subscriptionId,
    issueDate: isoOf(i.issueDate),
    dueDate: isoOf(i.dueDate),
    periodStart: isoOrNull(i.periodStart),
    periodEnd: isoOrNull(i.periodEnd),
    currency: i.currency,
    subtotal: num(i.subtotal),
    tax: num(i.tax),
    total: num(i.total),
    amountPaid: num(i.amountPaid),
    balance: num(balance),
    status: i.status,
    overdue: today !== undefined && balance > 0n && i.status !== 'VOID' && isoOf(i.dueDate) < today,
    pdfFileId: i.pdfFileId,
    createdAt: i.createdAt.toISOString(),
  };
}

export interface InvoiceFilter {
  tenantId?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  overdue?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

const tenantSelect = { select: { id: true, name: true, slug: true } } as const;

export function invoiceWhere(f: InvoiceFilter, today: string): Prisma.PlatformInvoiceWhereInput {
  return {
    ...(f.tenantId ? { tenantId: f.tenantId } : {}),
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.from || f.to
      ? {
          issueDate: {
            ...(f.from ? { gte: dateOf(f.from) } : {}),
            ...(f.to ? { lte: dateOf(f.to) } : {}),
          },
        }
      : {}),
    ...(f.q
      ? {
          OR: [
            { number: { contains: f.q, mode: 'insensitive' as const } },
            { tenant: { name: { contains: f.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
    ...(f.overdue
      ? {
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as never[] },
          dueDate: { lt: dateOf(today) },
        }
      : {}),
  };
}

export async function listInvoices(services: Services, f: InvoiceFilter, today: string) {
  const where = invoiceWhere(f, today);
  const [items, total] = await Promise.all([
    services.admin.platformInvoice.findMany({
      where,
      include: { tenant: tenantSelect },
      orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
      take: f.limit ?? 50,
      skip: f.offset ?? 0,
    }),
    services.admin.platformInvoice.count({ where }),
  ]);
  return { items: items.map((i) => serializeInvoice(i, today)), total };
}

export async function invoiceDetail(
  services: Services,
  id: string,
  today: string,
  tenantId?: string,
) {
  const i = await services.admin.platformInvoice.findFirst({
    where: { id, ...(tenantId ? { tenantId } : {}) },
    include: {
      tenant: tenantSelect,
      platformInvoiceLines: { orderBy: { createdAt: 'asc' } },
      paymentAllocations: {
        include: {
          payment: {
            select: { id: true, method: true, reference: true, status: true, receiptNumber: true },
          },
        },
      },
    },
  });
  if (!i) throw notFound('Invoice');
  return {
    ...serializeInvoice(i, today),
    lines: i.platformInvoiceLines.map((l) => ({
      id: l.id,
      label: l.label,
      qty: l.qty,
      unitAmount: num(l.unitAmount),
      amount: num(l.amount),
    })),
    allocations: i.paymentAllocations.map((a) => ({
      paymentId: a.paymentId,
      amount: num(a.amount),
      counted: a.payment.status === 'CONFIRMED',
      payment: a.payment,
    })),
  };
}

export async function invoicePdfUrl(services: Services, id: string, tenantId?: string) {
  const i = await services.admin.platformInvoice.findFirst({
    where: { id, ...(tenantId ? { tenantId } : {}) },
  });
  if (!i) throw notFound('Invoice');
  let fileId = i.pdfFileId;
  if (!fileId) {
    fileId = await renderInvoicePdf(services, i.id);
  }
  return { number: i.number, url: await signedFileUrl(services, i.tenantId, fileId) };
}

export interface PaymentFilter {
  tenantId?: string | undefined;
  method?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function paymentWhere(f: PaymentFilter): Prisma.PaymentWhereInput {
  return {
    ...(f.tenantId ? { tenantId: f.tenantId } : {}),
    ...(f.method ? { method: f.method as never } : {}),
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.from || f.to
      ? {
          paidAt: {
            ...(f.from ? { gte: dateOf(f.from) } : {}),
            ...(f.to ? { lte: dateOf(f.to) } : {}),
          },
        }
      : {}),
    ...(f.q
      ? {
          OR: [
            { reference: { contains: f.q, mode: 'insensitive' as const } },
            { receiptNumber: { contains: f.q, mode: 'insensitive' as const } },
            { tenant: { name: { contains: f.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}

const paymentInclude = {
  tenant: tenantSelect,
  paymentAllocations: {
    include: { invoice: { select: { id: true, number: true, status: true } } },
  },
  tenantCredits: true,
} as const;

export async function listPayments(services: Services, f: PaymentFilter) {
  const where = paymentWhere(f);
  const [items, total] = await Promise.all([
    services.admin.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: f.limit ?? 50,
      skip: f.offset ?? 0,
    }),
    services.admin.payment.count({ where }),
  ]);
  return { items: items.map(serializePayment), total };
}

export const PAYMENT_CSV_COLUMNS = [
  'paidAt',
  'receiptNumber',
  'tenant',
  'amount',
  'currency',
  'method',
  'reference',
  'status',
  'invoices',
  'credit',
  'recordedBy',
  'validatedBy',
  'reversalReason',
  'note',
] as const;

export async function paymentsCsvRows(services: Services, f: PaymentFilter) {
  const rows = await services.admin.payment.findMany({
    where: paymentWhere(f),
    include: paymentInclude,
    orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
    take: 50_000,
  });
  return rows.map((r) => {
    const p = serializePayment(r);
    return {
      ...p,
      tenant: p.tenant.name,
      invoices: p.allocations.map((a) => a.invoiceNumber).join(' '),
    };
  });
}
