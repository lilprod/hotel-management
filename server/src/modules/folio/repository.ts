import type { Prisma, TransactionClient } from '@hm/database';
import { AppError } from '../../lib/errors.js';
import { conflict, formatDay, must, num } from '../property/common.js';
import { parsePercent } from './tax-math.js';

export type Tx = TransactionClient;

/** Typed view of the RLS app client with the transaction-client delegates (same models). */
export const asTx = (db: unknown): Tx => db as Tx;
/** Read-only access shared by the tenant client and a transaction client. */
export type Db = Pick<
  TransactionClient,
  | 'folio'
  | 'folioLine'
  | 'folioPayment'
  | 'property'
  | 'tax'
  | 'reservation'
  | 'reservationRoom'
  | 'company'
  | 'group'
  | 'invoice'
>;

/** `source_type` values of folio lines. */
export const SRC = {
  roomNight: 'room_night',
  /** Tax line of a charge: `source_id` = the charge line. */
  tax: 'tax',
  /** Discount of a charge: `source_id` = the discounted line. */
  discount: 'discount',
  product: 'product',
  manual: 'manual',
  /** City-ledger transfer posted on a company account: `source_id` = the guest folio payment. */
  transfer: 'city_ledger_transfer',
  /** No-show penalty (night audit): `source_id` = the reservation room. */
  noShow: 'no_show',
} as const;

/** Department codes of generated lines (account mappings key on them). */
export const DEPT = {
  room: 'ROOM',
  discount: 'DISCOUNT',
  cityLedger: 'CITY_LEDGER',
  noShow: 'NO_SHOW',
} as const;

export const lineInclude = { reversal: { select: { id: true } } } as const;
export type LineRow = Prisma.FolioLineGetPayload<{ include: typeof lineInclude }>;
export type PaymentRow = Prisma.FolioPaymentGetPayload<object>;
export type FolioRow = Prisma.FolioGetPayload<object>;

/** Payment statuses counted in the balance (pending portal declarations are not). */
export const COUNTED_PAYMENT_STATUSES = ['CONFIRMED', 'REVERSED'] as const;

export const isLive = (l: Pick<LineRow, 'reversalOfId' | 'reversal'>) =>
  !l.reversalOfId && !l.reversal;

export async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS l`;
}

/** Locks the folio row until the end of the transaction (postings are serialised per folio). */
export async function lockFolio(tx: Tx, id: string): Promise<FolioRow> {
  await tx.$queryRaw`SELECT id FROM folios WHERE id = ${id}::uuid FOR UPDATE`;
  return must(await tx.folio.findUnique({ where: { id } }), 'Folio');
}

export function assertOpen(f: FolioRow): void {
  if (f.status !== 'OPEN')
    throw new AppError('CONFLICT', undefined, {
      detail: 'The folio is closed (invoiced): issue a credit note to reopen it',
      meta: { reason: 'FOLIO_CLOSED', folioId: f.id },
    });
}

// ─────────────────────────────── closed days ───────────────────────────────

/**
 * Last business date closed by a night audit (`night_audits.summary.locked = true`), or null.
 * Postings dated on or before it are refused; corrections are reversals dated in the open day.
 */
export async function lastClosedDate(
  db: Pick<TransactionClient, 'nightAudit'>,
  propertyId: string,
): Promise<string | null> {
  const a = await db.nightAudit.findFirst({
    where: { propertyId, summary: { path: ['locked'], equals: true } },
    orderBy: { businessDate: 'desc' },
    select: { businessDate: true },
  });
  return a ? formatDay(a.businessDate) : null;
}

export function dayClosed(date: string, closed: string | null): AppError {
  return new AppError('CONFLICT', undefined, {
    detail: `The business day ${date} is closed by the night audit: post a correction in the open day`,
    meta: { reason: 'DAY_CLOSED', businessDate: date, closedDate: closed },
  });
}

/** Advisory key of a property's business day: postings hold it shared, the day closing exclusive. */
export const dayLockKey = (propertyId: string) => `business_day:${propertyId}`;

/**
 * Refuses a posting dated in a closed business day. Holds the day lock in shared mode until the
 * end of the posting transaction, so the night audit closes the day only once in-flight postings
 * are committed (and later ones see the closing).
 */
export async function assertDayOpen(
  db: Pick<TransactionClient, 'nightAudit' | '$queryRaw'>,
  propertyId: string,
  date: string,
): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${dayLockKey(propertyId)}, 0))::text AS l`;
  const closed = await lastClosedDate(db, propertyId);
  if (closed && date <= closed) throw dayClosed(date, closed);
}

export interface FolioSums {
  charges: bigint;
  payments: bigint;
  balance: bigint;
}

export async function folioSums(db: Pick<Db, 'folioLine' | 'folioPayment'>, folioId: string) {
  const [l, p] = await Promise.all([
    db.folioLine.aggregate({ where: { folioId }, _sum: { amount: true } }),
    db.folioPayment.aggregate({
      where: { folioId, status: { in: [...COUNTED_PAYMENT_STATUSES] } },
      _sum: { amount: true },
    }),
  ]);
  const charges = l._sum.amount ?? 0n;
  const payments = p._sum.amount ?? 0n;
  return { charges, payments, balance: charges - payments } satisfies FolioSums;
}

/** Recomputes the cached `folios.balance` (inside the posting transaction, folio locked). */
export async function refreshBalance(tx: Tx, folioId: string): Promise<bigint> {
  const s = await folioSums(tx, folioId);
  await tx.folio.update({ where: { id: folioId }, data: { balance: s.balance } });
  return s.balance;
}

export interface PropertyInfo {
  id: string;
  name: string;
  currency: string;
  businessDate: string;
  country: string;
}

export async function loadProperty(db: Pick<Db, 'property'>, id: string): Promise<PropertyInfo> {
  const p = must(
    await db.property.findFirst({ where: { id, deletedAt: null } }),
    'Property',
  );
  return {
    id: p.id,
    name: p.name,
    currency: p.currency,
    businessDate: formatDay(p.businessDate),
    country: p.country,
  };
}

// ─────────────────────────────── DTOs ───────────────────────────────

export const toLine = (l: LineRow) => ({
  id: l.id,
  folioId: l.folioId,
  businessDate: formatDay(l.businessDate),
  type: l.type,
  departmentCode: l.departmentCode,
  label: l.label,
  qty: Number(l.qty),
  currency: l.currency,
  unitAmount: num(l.unitAmount),
  amount: num(l.amount),
  taxAmount: num(l.taxAmount),
  productId: l.productId,
  sourceType: l.sourceType,
  sourceId: l.sourceId,
  reversalOfId: l.reversalOfId,
  reversedById: l.reversal?.id ?? null,
  createdAt: l.createdAt.toISOString(),
  createdBy: l.createdBy,
});
export type LineDto = ReturnType<typeof toLine>;

export const toPayment = (p: PaymentRow) => ({
  id: p.id,
  folioId: p.folioId,
  method: p.method,
  currency: p.currency,
  amount: num(p.amount),
  reference: p.reference,
  isDeposit: p.isDeposit,
  status: p.status,
  paidAt: p.paidAt.toISOString(),
  cashSessionId: p.cashSessionId,
  tenderedCurrency: p.tenderedCurrency,
  tenderedAmount: p.tenderedAmount === null ? null : num(p.tenderedAmount),
  rate: p.rate === null ? null : p.rate.toString(),
  reversedById: p.reversedById,
  reversedAt: p.reversedAt?.toISOString() ?? null,
  reversalReason: p.reversalReason,
  createdBy: p.createdBy,
});
export type PaymentDto = ReturnType<typeof toPayment>;

// ─────────────────────────────── tax breakdown ───────────────────────────────

export interface TaxInfo {
  code: string;
  name: string;
  type: 'PERCENT' | 'FIXED_PER_PERSON_NIGHT' | 'FIXED_PER_NIGHT';
  value: string;
}

export async function taxesByCode(
  db: Pick<Db, 'tax'>,
  propertyId: string,
): Promise<Map<string, TaxInfo>> {
  const rows = await db.tax.findMany({ where: { propertyId } });
  return new Map(
    rows.map((t) => [t.code, { code: t.code, name: t.name, type: t.type, value: t.value.toString() }]),
  );
}

export interface BreakdownRow {
  code: string;
  name: string;
  type: TaxInfo['type'];
  /** Percentage as a decimal string for PERCENT taxes, null for fixed taxes. */
  rate: string | null;
  base: number;
  amount: number;
}

export interface Breakdown {
  /** Charges excluding tax lines (HT). */
  net: number;
  /** Percentage taxes (TVA…). */
  percentTax: number;
  /** Fixed taxes (taxe de séjour…), shown separately on invoices. */
  fixedTax: number;
  total: number;
  rows: BreakdownRow[];
  /** HT amount of the charges carrying no percentage tax. */
  untaxedBase: number;
}

/** Normalised percentage label ("18", "7.5"). */
export function rateLabel(value: string): string {
  const scaled = parsePercent(value);
  const int = scaled / 10_000n;
  const frac = (scaled % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : `${int}`;
}

/**
 * Per-tax breakdown of a set of lines: a tax line (`source_type = tax`) belongs to the charge it
 * points to; the base of a tax is the HT amount of the charges it was computed on.
 */
export function breakdown(
  lines: readonly Pick<LineRow, 'id' | 'type' | 'amount' | 'sourceType' | 'sourceId' | 'departmentCode' | 'label'>[],
  taxes: ReadonlyMap<string, TaxInfo>,
): Breakdown {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const rows = new Map<string, { info: TaxInfo; base: bigint; amount: bigint; bases: Set<string> }>();
  const percentTaxed = new Set<string>();
  let net = 0n;
  let percentTax = 0n;
  let fixedTax = 0n;
  for (const l of lines) {
    if (l.type !== 'TAX') {
      net += l.amount;
      continue;
    }
    const code = l.departmentCode ?? l.label;
    const info: TaxInfo = taxes.get(code) ?? {
      code,
      name: l.label,
      type: 'PERCENT',
      value: '0',
    };
    let row = rows.get(code);
    if (!row) {
      row = { info, base: 0n, amount: 0n, bases: new Set() };
      rows.set(code, row);
    }
    row.amount += l.amount;
    if (info.type === 'PERCENT') percentTax += l.amount;
    else fixedTax += l.amount;
    const parent = l.sourceId ? byId.get(l.sourceId) : undefined;
    if (parent && !row.bases.has(parent.id)) {
      row.bases.add(parent.id);
      row.base += parent.amount;
      if (info.type === 'PERCENT') percentTaxed.add(parent.id);
    }
  }
  let untaxed = 0n;
  for (const l of lines) if (l.type !== 'TAX' && !percentTaxed.has(l.id)) untaxed += l.amount;
  return {
    net: num(net),
    percentTax: num(percentTax),
    fixedTax: num(fixedTax),
    total: num(net + percentTax + fixedTax),
    untaxedBase: num(untaxed),
    rows: [...rows.values()]
      .map((r) => ({
        code: r.info.code,
        name: r.info.name,
        type: r.info.type,
        rate: r.info.type === 'PERCENT' ? rateLabel(r.info.value) : null,
        base: num(r.base),
        amount: num(r.amount),
      }))
      .sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === 'PERCENT' ? -1 : 1)),
  };
}

export function noOpenSession(): AppError {
  return new AppError('PRECONDITION_FAILED', undefined, {
    detail: 'Open a cash session before taking cash',
    meta: { reason: 'NO_OPEN_CASH_SESSION' },
  });
}

export { conflict };
