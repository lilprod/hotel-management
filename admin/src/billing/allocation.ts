import type { Invoice } from './common';

/** Invoices that can still receive a payment (balance > 0, not void / paid / draft). */
export function openInvoices(invoices: readonly Invoice[]): Invoice[] {
  return invoices
    .filter((i) => ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status) && i.balance > 0)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.issueDate.localeCompare(b.issueDate) ||
        a.number.localeCompare(b.number),
    );
}

export type Allocations = Record<string, number>;

/** Oldest-open-first pre-fill: each invoice takes min(balance, what is left of the payment). */
export function autoAllocate(amount: number, invoices: readonly Invoice[]): Allocations {
  const out: Allocations = {};
  let left = Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
  for (const i of openInvoices(invoices)) {
    if (left <= 0) break;
    const part = Math.min(i.balance, left);
    out[i.id] = part;
    left -= part;
  }
  return out;
}

export function allocatedTotal(allocations: Allocations): number {
  return Object.values(allocations).reduce((s, v) => s + (Number.isInteger(v) ? v : 0), 0);
}

export interface Split {
  allocated: number;
  /** Payment amount − allocated amount (negative = over-allocated, not allowed). */
  remainder: number;
  /** Surplus kept on the tenant's account (never lost): shown live under the table. */
  credit: number;
  overAllocated: boolean;
}

export function splitPayment(amount: number, allocations: Allocations): Split {
  const total = Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
  const allocated = allocatedTotal(allocations);
  const remainder = total - allocated;
  return {
    allocated,
    remainder,
    credit: Math.max(0, remainder),
    overAllocated: remainder < 0,
  };
}

/** Wire format of `allocations` (only positive lines). */
export function toPayload(allocations: Allocations): { invoiceId: string; amount: number }[] {
  return Object.entries(allocations)
    .filter(([, amount]) => Number.isInteger(amount) && amount > 0)
    .map(([invoiceId, amount]) => ({ invoiceId, amount }));
}
