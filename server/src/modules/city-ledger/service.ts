import type { FolioPaymentMethod } from '@hm/database';
import type { z } from 'zod';
import { assertPropertyAccess, formatDay, must, num, parseDay } from '../property/common.js';
import { TX_OPTS } from '../reservations/service.js';
import { recordPayment } from '../folio/payments.js';
import {
  asTx,
  COUNTED_PAYMENT_STATUSES,
  folioSums,
  loadProperty,
  type FolioRow,
} from '../folio/repository.js';
import { companyAccountWhere, ensureCompanyFolio, getFolio, type FCtx } from '../folio/service.js';
import { allocateSettlements, ledgerInvoices } from '../folio/ledger.js';
import { lockFolio } from '../folio/repository.js';
import { conflict, invalid } from '../property/common.js';
import type { agingQuery, accountsQuery, statementQuery } from './schemas.js';

const DAY_MS = 86_400_000;

function propertyScope(ctx: FCtx, propertyId: string | undefined) {
  if (propertyId) {
    assertPropertyAccess(ctx, propertyId);
    return { propertyId };
  }
  return ctx.grants.permissions.includes('*') ? {} : { propertyId: { in: ctx.grants.propertyIds } };
}

async function accountsOf(ctx: FCtx, companyId: string | undefined, propertyId: string | undefined) {
  return ctx.db.folio.findMany({
    where: {
      ...companyAccountWhere(companyId),
      ...propertyScope(ctx, propertyId),
    },
    include: { company: { select: { id: true, name: true, taxId: true, creditLimit: true, currency: true } } },
    orderBy: [{ number: 'asc' }],
  });
}

/** Company accounts (OP-96) with their balance and credit limit. */
export async function listAccounts(ctx: FCtx, q: z.infer<typeof accountsQuery>) {
  const rows = await accountsOf(ctx, undefined, q.propertyId);
  const items = [];
  for (const f of rows) {
    const s = await folioSums(asTx(ctx.db), f.id);
    items.push({
      folioId: f.id,
      number: f.number,
      propertyId: f.propertyId,
      companyId: f.companyId!,
      companyName: f.company?.name ?? '',
      taxId: f.company?.taxId ?? null,
      currency: f.currency,
      creditLimit: f.company?.creditLimit === null || f.company?.creditLimit === undefined ? null : num(f.company.creditLimit),
      charges: num(s.charges),
      settlements: num(s.payments),
      balance: num(s.balance),
    });
  }
  return { items };
}

/** Account of a company at a property (created at first need). */
export async function getAccount(ctx: FCtx, companyId: string, propertyId: string) {
  const f = await ctx.db.$transaction((tx) => ensureCompanyFolio(ctx, tx, companyId, propertyId), TX_OPTS);
  return getFolio(ctx, f.id);
}

interface Entry {
  date: string;
  at: string;
  kind: 'CHARGE' | 'SETTLEMENT';
  label: string;
  reference: string | null;
  debit: number;
  credit: number;
}

async function entriesOf(ctx: FCtx, f: FolioRow): Promise<Entry[]> {
  const [lines, payments] = await Promise.all([
    ctx.db.folioLine.findMany({ where: { folioId: f.id } }),
    ctx.db.folioPayment.findMany({ where: { folioId: f.id, status: { in: [...COUNTED_PAYMENT_STATUSES] } } }),
  ]);
  const out: Entry[] = [
    ...lines.map((l) => ({
      date: formatDay(l.businessDate),
      at: l.createdAt.toISOString(),
      kind: 'CHARGE' as const,
      label: l.label,
      reference: null,
      debit: l.amount > 0n ? num(l.amount) : 0,
      credit: l.amount < 0n ? num(-l.amount) : 0,
    })),
    ...payments.map((p) => ({
      date: formatDay(p.paidAt),
      at: p.createdAt.toISOString(),
      kind: 'SETTLEMENT' as const,
      label: `Règlement ${p.method}${p.amount < 0n ? ' (annulation)' : ''}`,
      reference: p.reference,
      debit: p.amount < 0n ? num(-p.amount) : 0,
      credit: p.amount > 0n ? num(p.amount) : 0,
    })),
  ];
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
}

/** Statement of account over a period: opening balance, entries with running balance, closing. */
export async function statement(ctx: FCtx, companyId: string, q: z.infer<typeof statementQuery>) {
  const company = must(await ctx.db.company.findFirst({ where: { id: companyId } }), 'Company');
  const accounts = await accountsOf(ctx, companyId, q.propertyId);
  const all: (Entry & { folioNumber: string })[] = [];
  for (const f of accounts) all.push(...(await entriesOf(ctx, f)).map((e) => ({ ...e, folioNumber: f.number })));
  all.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  let opening = 0;
  const rows = [];
  let running = 0;
  for (const e of all) {
    if (q.from && e.date < q.from) {
      opening += e.debit - e.credit;
      running = opening;
      continue;
    }
    if (q.to && e.date > q.to) continue;
    running += e.debit - e.credit;
    rows.push({ ...e, balance: running });
  }
  return {
    company: { id: company.id, name: company.name, taxId: company.taxId },
    from: q.from ?? null,
    to: q.to ?? null,
    openingBalance: opening,
    entries: rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
    closingBalance: running,
  };
}

/** Invoices payable to a company account with what is allocated / left, and their status. */
async function ledgerView(ctx: FCtx, folioId: string) {
  const rows = await ledgerInvoices(asTx(ctx.db), folioId);
  const statuses = new Map(
    (await ctx.db.invoice.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, status: true } })).map(
      (i) => [i.id, i.status],
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: statuses.get(r.id) ?? 'ISSUED',
    ledgerAmount: num(r.ledgerAmount),
    allocated: num(r.allocated),
    left: num(r.left),
  }));
}

/**
 * Settlement (payment) against the company balance, matched to the invoices payable through the
 * city ledger (`ledger_allocations`): the given ones, or the oldest open ones first.
 */
export async function settle(
  ctx: FCtx,
  companyId: string,
  input: {
    propertyId: string;
    method: FolioPaymentMethod;
    amount: number;
    reference?: string | undefined;
    allocations?: { invoiceId: string; amount: number }[] | undefined;
  },
) {
  const f = await ctx.db.$transaction((tx) => ensureCompanyFolio(ctx, tx, companyId, input.propertyId), TX_OPTS);
  if (input.allocations?.length) {
    const open = new Map((await ledgerInvoices(asTx(ctx.db), f.id)).map((i) => [i.id, i]));
    let total = 0;
    for (const [i, a] of input.allocations.entries()) {
      const inv = open.get(a.invoiceId);
      if (!inv) throw invalid(`allocations.${i}.invoiceId`, 'Not an invoice payable to this company account');
      if (BigInt(a.amount) > inv.left)
        throw conflict('The allocation exceeds what is left on the invoice', {
          reason: 'OVER_ALLOCATION',
          invoiceId: inv.id,
          invoiceLeft: num(inv.left),
        });
      total += a.amount;
    }
    if (total > input.amount) throw invalid('allocations', 'The allocations exceed the settlement', 'OVER_ALLOCATION');
  }
  const out = await recordPayment(ctx, f.id, {
    method: input.method,
    amount: input.amount,
    reference: input.reference,
    isDeposit: false,
  });
  const allocations = await ctx.db.$transaction(async (tx) => {
    await lockFolio(tx, f.id);
    return allocateSettlements(ctx, tx, f.id, {
      settlementIds: [out.payment.id],
      ...(input.allocations?.length ? { explicit: input.allocations } : {}),
    });
  }, TX_OPTS);
  return { ...out, allocations };
}

/** Allocates what is left on the account's settlements (e.g. settlements recorded before invoicing). */
export async function allocate(ctx: FCtx, companyId: string, input: { propertyId: string; settlementId?: string | undefined }) {
  assertPropertyAccess(ctx, input.propertyId);
  const account = must(
    await ctx.db.folio.findFirst({ where: companyAccountWhere(companyId, input.propertyId) }),
    'Company account',
  );
  const allocations = await ctx.db.$transaction(async (tx) => {
    await lockFolio(tx, account.id);
    return allocateSettlements(ctx, tx, account.id, input.settlementId ? { settlementIds: [input.settlementId] } : {});
  }, TX_OPTS);
  if (allocations.length)
    await ctx.audit({ action: 'city_ledger.allocate', entity: 'folio', entityId: account.id, after: { allocations } });
  return { allocations, invoices: await ledgerView(ctx, account.id) };
}

const BUCKETS = [
  { key: 'current', max: 30 },
  { key: 'd31_60', max: 60 },
  { key: 'd61_90', max: 90 },
  { key: 'over90', max: Infinity },
] as const;
type BucketKey = (typeof BUCKETS)[number]['key'];

/**
 * Aging of company balances (by business date of the charge): settlements and credits are
 * allocated to the oldest charges first (FIFO).
 */
export async function aging(ctx: FCtx, q: z.infer<typeof agingQuery>) {
  const accounts = await accountsOf(ctx, undefined, q.propertyId);
  const today = q.asOf ?? (q.propertyId ? (await loadProperty(asTx(ctx.db), q.propertyId)).businessDate : formatDay(new Date()));
  const byCompany = new Map<string, { companyId: string; companyName: string; buckets: Record<BucketKey, number>; total: number }>();
  for (const f of accounts) {
    const entries = await entriesOf(ctx, f);
    let credit = entries.reduce((s, e) => s + e.credit, 0);
    const charges = entries.filter((e) => e.debit > 0);
    const row = byCompany.get(f.companyId!) ?? {
      companyId: f.companyId!,
      companyName: f.company?.name ?? '',
      buckets: { current: 0, d31_60: 0, d61_90: 0, over90: 0 },
      total: 0,
    };
    for (const c of charges) {
      const used = Math.min(credit, c.debit);
      credit -= used;
      const open = c.debit - used;
      if (!open) continue;
      const age = Math.floor((parseDay(today).getTime() - parseDay(c.date).getTime()) / DAY_MS);
      const b = BUCKETS.find((x) => age <= x.max)!;
      row.buckets[b.key] += open;
      row.total += open;
    }
    // Unallocated credit (overpayment) lowers the current bucket.
    if (credit > 0) {
      row.buckets.current -= credit;
      row.total -= credit;
    }
    byCompany.set(f.companyId!, row);
  }
  const items = [...byCompany.values()].sort((a, b) => b.total - a.total);
  const totals = { current: 0, d31_60: 0, d61_90: 0, over90: 0, total: 0 };
  for (const i of items) {
    for (const b of BUCKETS) totals[b.key] += i.buckets[b.key];
    totals.total += i.total;
  }
  return { asOf: today, items, totals };
}
