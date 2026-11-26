import { conflict, invalid, num } from '../property/common.js';
import { SRC, type Tx } from './repository.js';
import type { FCtx } from './service.js';

/**
 * City-ledger matching (`ledger_allocations`): a settlement recorded on a company account is
 * allocated to the invoices payable through the city ledger (`invoices.ledger_amount`), which
 * become PARTIALLY_PAID then PAID. The database guard refuses over-allocation; allocations are
 * append-only (a reversed settlement writes counter-allocations).
 */

export interface OpenLedgerInvoice {
  id: string;
  number: string;
  ledgerAmount: bigint;
  allocated: bigint;
  left: bigint;
}

/** Invoices of the guest folios transferred to this company account, oldest first. */
export async function ledgerInvoices(tx: Tx, companyFolioId: string): Promise<OpenLedgerInvoice[]> {
  const transfers = await tx.folioLine.findMany({
    where: { folioId: companyFolioId, sourceType: SRC.transfer, sourceId: { not: null } },
    select: { sourceId: true },
  });
  if (!transfers.length) return [];
  const payments = await tx.folioPayment.findMany({
    where: { id: { in: transfers.map((t) => t.sourceId!) } },
    select: { folioId: true },
  });
  const rows = await tx.invoice.findMany({
    where: {
      folioId: { in: [...new Set(payments.map((p) => p.folioId))] },
      kind: { not: 'CREDIT_NOTE' },
      ledgerAmount: { gt: 0n },
    },
    include: { ledgerAllocations: { select: { amount: true } } },
    orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((i) => {
    const allocated = i.ledgerAllocations.reduce((s, a) => s + a.amount, 0n);
    return {
      id: i.id,
      number: i.number,
      ledgerAmount: i.ledgerAmount,
      allocated,
      left: i.ledgerAmount - allocated,
    };
  });
}

async function settlementLeft(tx: Tx, settlementId: string, amount: bigint) {
  const a = await tx.ledgerAllocation.aggregate({
    where: { settlementId },
    _sum: { amount: true },
  });
  return amount - (a._sum.amount ?? 0n);
}

/** Payment status of a city-ledger invoice from its allocations (never touches a CREDITED one). */
async function refreshInvoiceStatus(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === 'CREDITED' || inv.ledgerAmount <= 0n) return;
  const a = await tx.ledgerAllocation.aggregate({ where: { invoiceId }, _sum: { amount: true } });
  const allocated = a._sum.amount ?? 0n;
  const status =
    allocated >= inv.ledgerAmount ? 'PAID' : allocated > 0n ? 'PARTIALLY_PAID' : 'ISSUED';
  if (status !== inv.status)
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
}

export interface AllocationInput {
  invoiceId: string;
  amount: number;
}

/**
 * Allocates settlements of a company account (folio locked by the caller). With `explicit`, the
 * given amounts are taken from `settlementIds[0]`; otherwise what is left on each settlement goes
 * to the oldest open invoices (FIFO).
 */
export async function allocateSettlements(
  ctx: FCtx,
  tx: Tx,
  companyFolioId: string,
  opts: { settlementIds?: string[]; explicit?: AllocationInput[] } = {},
) {
  const settlements = await tx.folioPayment.findMany({
    where: {
      folioId: companyFolioId,
      status: 'CONFIRMED',
      amount: { gt: 0n },
      ...(opts.settlementIds ? { id: { in: opts.settlementIds } } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const open = new Map((await ledgerInvoices(tx, companyFolioId)).map((i) => [i.id, i]));
  const out: { settlementId: string; invoiceId: string; amount: number }[] = [];
  const write = async (
    settlementId: string,
    currency: string,
    invoiceId: string,
    amount: bigint,
  ) => {
    await tx.ledgerAllocation.create({
      data: {
        tenantId: ctx.tenantId,
        settlementId,
        invoiceId,
        currency,
        amount,
        createdBy: ctx.actorId,
      },
    });
    const inv = open.get(invoiceId)!;
    inv.allocated += amount;
    inv.left -= amount;
    out.push({ settlementId, invoiceId, amount: num(amount) });
  };
  if (opts.explicit?.length) {
    const s = settlements[0];
    if (!s) throw invalid('settlementId', 'Unknown settlement of this account');
    let left = await settlementLeft(tx, s.id, s.amount);
    for (const [i, a] of opts.explicit.entries()) {
      const inv = open.get(a.invoiceId);
      if (!inv)
        throw invalid(
          `allocations.${i}.invoiceId`,
          'Not an invoice payable to this company account',
        );
      const amount = BigInt(a.amount);
      if (amount > inv.left || amount > left)
        throw conflict('The allocation exceeds what is left on the invoice or the settlement', {
          reason: 'OVER_ALLOCATION',
          invoiceId: inv.id,
          invoiceLeft: num(inv.left),
          settlementLeft: num(left),
        });
      await write(s.id, s.currency, inv.id, amount);
      left -= amount;
    }
  } else {
    for (const s of settlements) {
      let left = await settlementLeft(tx, s.id, s.amount);
      for (const inv of open.values()) {
        if (left <= 0n) break;
        if (inv.left <= 0n) continue;
        const amount = inv.left < left ? inv.left : left;
        await write(s.id, s.currency, inv.id, amount);
        left -= amount;
      }
    }
  }
  for (const id of new Set(out.map((a) => a.invoiceId))) await refreshInvoiceStatus(tx, id);
  return out;
}

/** A reversed settlement gives its allocations back (counter-allocations, invoice status). */
export async function reverseAllocations(ctx: FCtx, tx: Tx, settlementId: string) {
  const live = await tx.ledgerAllocation.findMany({
    where: { settlementId, reversalOfId: null, reversal: { is: null } },
  });
  for (const a of live)
    await tx.ledgerAllocation.create({
      data: {
        tenantId: ctx.tenantId,
        settlementId,
        invoiceId: a.invoiceId,
        currency: a.currency,
        amount: -a.amount,
        reversalOfId: a.id,
        createdBy: ctx.actorId,
      },
    });
  for (const id of new Set(live.map((a) => a.invoiceId))) await refreshInvoiceStatus(tx, id);
  return live.length;
}
