import { runWithTenant } from '@hm/database';
import type { DocParty, InvoiceData, ReceiptData } from '@hm/templates';
import { PLATFORM_PAYMENT_METHODS, paymentMethodLabel } from '@hm/shared';
import type { Services } from '../../core/container.js';
import { renderPdf } from '../notifications/jobs.js';
import { notificationDeps } from '../notifications/deps.js';
import { isoOf, num } from './common.js';
import { loadBillingSettings, type BillingSettings } from './settings.js';

/** Platform documents carry the platform identity, never the hotel branding. */
function platformBranding(identity: BillingSettings['identity']) {
  return {
    displayName: identity.legalName,
    logoUrl: undefined,
    footerLegal: [
      [identity.legalName, identity.legalForm].filter(Boolean).join(' — '),
      [identity.taxId ? `NIF ${identity.taxId}` : '', identity.rccm ? `RCCM ${identity.rccm}` : '']
        .filter(Boolean)
        .join(' · '),
      identity.address ?? '',
    ].filter(Boolean),
  };
}

function seller(identity: BillingSettings['identity']): DocParty {
  return {
    name: identity.legalName,
    ...(identity.address ? { address: identity.address } : {}),
    ...(identity.phone ? { phone: identity.phone } : {}),
    ...(identity.email ? { email: identity.email } : {}),
    legalIds: {
      ...(identity.taxId ? { nif: identity.taxId } : {}),
      ...(identity.rccm ? { rccm: identity.rccm } : {}),
    },
  };
}

const methodLabel = (m: string) =>
  (PLATFORM_PAYMENT_METHODS as readonly string[]).includes(m)
    ? paymentMethodLabel(m as (typeof PLATFORM_PAYMENT_METHODS)[number])
    : m;

/** File name of a platform document (also the lookup key of receipts: one file per number). */
export const documentFileName = (number: string) => `${number}.pdf`;

/**
 * Renders the PDF of a platform invoice (renderPdf, stored in the tenant's files so the tenant
 * can download it through a signed URL) and records `pdf_file_id`.
 */
export async function renderInvoicePdf(services: Services, invoiceId: string): Promise<string> {
  const { admin } = services;
  const inv = await admin.platformInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      platformInvoiceLines: { orderBy: { createdAt: 'asc' } },
      tenant: { select: { name: true, legalName: true, email: true, phone: true } },
    },
  });
  const settings = await loadBillingSettings(admin);
  const cur = inv.currency;
  const m = (v: bigint) => ({ amount: num(v), currency: cur });
  const rate = settings.vat.enabled ? String(settings.vat.rateBps / 100) : '0';
  const data: InvoiceData = {
    number: inv.number,
    issuedOn: isoOf(inv.issueDate),
    dueOn: isoOf(inv.dueDate),
    seller: seller(settings.identity),
    buyer: {
      name: inv.tenant.legalName ?? inv.tenant.name,
      ...(inv.tenant.email ? { email: inv.tenant.email } : {}),
      ...(inv.tenant.phone ? { phone: inv.tenant.phone } : {}),
    },
    lines: inv.platformInvoiceLines.map((l) => ({
      description: l.label,
      quantity: l.qty,
      unitPrice: m(l.unitAmount),
      net: m(l.amount),
      taxRate: rate,
    })),
    taxBreakdown: [{ rate, base: m(inv.subtotal), tax: m(inv.tax) }],
    totalNet: m(inv.subtotal),
    totalTax: m(inv.tax),
    totalGross: m(inv.total),
    ...(inv.periodStart && inv.periodEnd
      ? { notes: [`Période du ${isoOf(inv.periodStart)} au ${isoOf(inv.periodEnd)} (exclu)`] }
      : {}),
  };
  const out = await runWithTenant(inv.tenantId, () =>
    renderPdf(services, {
      type: 'invoice',
      data,
      fileName: documentFileName(inv.number),
      branding: platformBranding(settings.identity),
    }),
  );
  await admin.platformInvoice.update({ where: { id: inv.id }, data: { pdfFileId: out.fileId } });
  return out.fileId;
}

/** Renders a payment receipt (or its cancellation receipt when `reversal`). */
export async function renderReceiptPdf(
  services: Services,
  paymentId: string,
  opts: { reversal?: boolean } = {},
): Promise<string | null> {
  const { admin } = services;
  const p = await admin.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      tenant: { select: { name: true, legalName: true } },
      paymentAllocations: { include: { invoice: { select: { number: true } } } },
    },
  });
  if (!p.receiptNumber) return null;
  const settings = await loadBillingSettings(admin);
  const number = opts.reversal ? `${p.receiptNumber}-ANNUL` : p.receiptNumber;
  const data: ReceiptData = {
    number,
    issuedAt: (opts.reversal ? (p.reversedAt ?? new Date()) : (p.validatedAt ?? p.createdAt))
      .toISOString()
      .slice(0, 10),
    seller: seller(settings.identity),
    payer: p.tenant.legalName ?? p.tenant.name,
    amount: { amount: opts.reversal ? -num(p.amount) : num(p.amount), currency: p.currency },
    method: methodLabel(p.method),
    ...(p.reference ? { reference: p.reference } : {}),
    ...(p.paymentAllocations.length
      ? { invoiceNumber: p.paymentAllocations.map((a) => a.invoice.number).join(', ') }
      : {}),
  };
  const out = await runWithTenant(p.tenantId, () =>
    renderPdf(services, {
      type: 'receipt',
      data,
      fileName: documentFileName(number),
      branding: platformBranding(settings.identity),
    }),
  );
  return out.fileId;
}

/** Latest file of a platform document number (receipts have no file column on `payments`). */
export async function findDocumentFile(services: Services, tenantId: string, number: string) {
  return services.admin.file.findFirst({
    where: { tenantId, originalName: documentFileName(number) },
    orderBy: { createdAt: 'desc' },
    select: { id: true, key: true },
  });
}

/** 5-minute signed URL of a tenant file (platform documents live in the tenant's storage). */
export async function signedFileUrl(
  services: Services,
  tenantId: string,
  fileId: string,
): Promise<string | null> {
  const file = await services.admin.file.findFirst({
    where: { id: fileId, tenantId },
    select: { key: true },
  });
  if (!file) return null;
  const { storage } = notificationDeps(services);
  return runWithTenant(tenantId, () => storage.signedUrl(file.key));
}
