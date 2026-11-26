import type { FolioLineType, Prisma } from '@hm/database';
import { AppError, notFound } from '../../lib/errors.js';
import { PermissionService } from '../../core/permissions.js';
import {
  assertPropertyAccess,
  conflict,
  formatDay,
  invalid,
  must,
  num,
  parseDay,
} from '../property/common.js';
import { parseNightPrices } from '../availability/pricing.js';
import { formatSequence, nextSequence, sequenceScope } from '../sequences/service.js';
import type { RCtx } from '../reservations/context.js';
import { TX_OPTS } from '../reservations/service.js';
import { publishFolioChanged } from './events.js';
import {
  advisoryLock,
  assertDayOpen,
  assertOpen,
  breakdown,
  dayClosed,
  DEPT,
  lastClosedDate,
  folioSums,
  isLive,
  lineInclude,
  loadProperty,
  lockFolio,
  refreshBalance,
  SRC,
  taxesByCode,
  toLine,
  toPayment,
  type Db,
  type FolioRow,
  type LineRow,
  type Tx,
} from './repository.js';
import {
  computeTaxes,
  mulDivRound,
  splitProportional,
  TaxMathError,
  type FolioTaxSpec,
} from './tax-math.js';

export type FCtx = RCtx;

const DAY_MS = 86_400_000;
export const addDays = (d: string, n: number) =>
  formatDay(new Date(parseDay(d).getTime() + n * DAY_MS));

// ───────────────────────────── folio resolution ─────────────────────────────

export type FolioKind = 'STAY' | 'GROUP' | 'COMPANY' | 'OTHER';

/** Company (city-ledger) accounts are numbered `CL-…`, other standalone folios `FO-…`. */
const COMPANY_PREFIX = 'CL-';

async function nextNumber(ctx: FCtx, tx: Tx, propertyId: string, key: 'folio' | 'city_ledger') {
  const p = await loadProperty(tx, propertyId);
  const year = Number(p.businessDate.slice(0, 4));
  if (key === 'city_ledger') {
    const seq = await nextSequence(tx, sequenceScope(ctx.tenantId, propertyId), key);
    return formatSequence(`${COMPANY_PREFIX}{seq:6}`, seq);
  }
  const seq = await nextSequence(tx, sequenceScope(ctx.tenantId, propertyId), key, { year });
  return formatSequence('FO-{YYYY}-{seq:6}', seq, year);
}

interface RoomRef {
  id: string;
  propertyId: string;
  reservationId: string;
  reservationNumber: string;
  status: string;
  stayId: string | null;
  ordinal: number;
}

async function roomRef(db: Db, reservationRoomId: string): Promise<RoomRef> {
  const rr = must(
    await db.reservationRoom.findFirst({
      where: { id: reservationRoomId },
      include: { reservation: { select: { number: true } }, stay: { select: { id: true } } },
    }),
    'Reservation room',
  );
  const siblings = await db.reservationRoom.findMany({
    where: { reservationId: rr.reservationId },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return {
    id: rr.id,
    propertyId: rr.propertyId,
    reservationId: rr.reservationId,
    reservationNumber: rr.reservation.number,
    status: rr.status,
    stayId: rr.stay?.id ?? null,
    ordinal: siblings.findIndex((s) => s.id === rr.id) + 1,
  };
}

/**
 * Folios of a reservation room (`folios.reservation_room_id`, set from the first deposit, before
 * check-in), main folio first then the split folios; once the stay exists the main folio also
 * carries `stay_id`. Stay folios are numbered `<reservation number>-<room #>-<n>`.
 */
async function roomFolios(db: Db, ref: RoomRef): Promise<FolioRow[]> {
  return db.folio.findMany({
    where: { reservationRoomId: ref.id, kind: 'STAY' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function createFolio(
  ctx: FCtx,
  tx: Tx,
  data: {
    propertyId: string;
    number: string;
    kind: FolioKind;
    stayId?: string | null;
    groupId?: string | null;
    companyId?: string | null;
    reservationId?: string | null;
    reservationRoomId?: string | null;
  },
): Promise<FolioRow> {
  const p = await loadProperty(tx, data.propertyId);
  const f = await tx.folio.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: data.propertyId,
      number: data.number,
      kind: data.kind,
      stayId: data.stayId ?? null,
      groupId: data.groupId ?? null,
      companyId: data.companyId ?? null,
      reservationId: data.reservationId ?? null,
      reservationRoomId: data.reservationRoomId ?? null,
      currency: p.currency,
    },
  });
  await publishFolioChanged(tx, f, 'created');
  await ctx.audit({ action: 'folio.create', entity: 'folio', entityId: f.id, after: { number: f.number } });
  return f;
}

/** Main folio of a reservation room, created at first need. */
export async function ensureRoomFolio(ctx: FCtx, tx: Tx, reservationRoomId: string) {
  const ref = await roomRef(tx, reservationRoomId);
  assertPropertyAccess(ctx, ref.propertyId);
  await advisoryLock(tx, `folio:rr:${ref.id}`);
  const existing = await roomFolios(tx, ref);
  const main = existing[0];
  if (main) {
    if (ref.stayId && !main.stayId)
      return tx.folio.update({ where: { id: main.id }, data: { stayId: ref.stayId } });
    return main;
  }
  return createFolio(ctx, tx, {
    propertyId: ref.propertyId,
    number: `${ref.reservationNumber}-${ref.ordinal}-1`,
    kind: 'STAY',
    stayId: ref.stayId,
    reservationId: ref.reservationId,
    reservationRoomId: ref.id,
  });
}

export async function ensureGroupFolio(ctx: FCtx, tx: Tx, groupId: string) {
  await advisoryLock(tx, `folio:group:${groupId}`);
  const g = must(await tx.group.findFirst({ where: { id: groupId } }), 'Group');
  assertPropertyAccess(ctx, g.propertyId);
  if (g.masterFolioId) return must(await tx.folio.findUnique({ where: { id: g.masterFolioId } }), 'Folio');
  const f = await createFolio(ctx, tx, {
    propertyId: g.propertyId,
    number: await nextNumber(ctx, tx, g.propertyId, 'folio'),
    kind: 'GROUP',
    groupId: g.id,
  });
  await tx.group.update({ where: { id: g.id }, data: { masterFolioId: f.id } });
  return f;
}

/**
 * City-ledger account of a company at a property: one per company and property (partial UNIQUE
 * `folios_company_account_key`; the lock serialises the creation and its gap-free number).
 */
export async function ensureCompanyFolio(ctx: FCtx, tx: Tx, companyId: string, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  must(await tx.company.findFirst({ where: { id: companyId, deletedAt: null } }), 'Company');
  await advisoryLock(tx, `folio:company:${companyId}:${propertyId}`);
  const f = await tx.folio.findFirst({ where: companyAccountWhere(companyId, propertyId) });
  if (f) return f;
  return createFolio(ctx, tx, {
    propertyId,
    number: await nextNumber(ctx, tx, propertyId, 'city_ledger'),
    kind: 'COMPANY',
    companyId,
  });
}

export const companyAccountWhere = (companyId?: string, propertyId?: string) => ({
  kind: 'COMPANY' as const,
  ...(companyId ? { companyId } : {}),
  ...(propertyId ? { propertyId } : {}),
});

export type ResolveInput =
  | { reservationRoomId: string }
  | { reservationId: string }
  | { groupId: string }
  | { companyId: string; propertyId: string };

async function firstRoomOf(db: Db, reservationId: string) {
  const r = must(
    await db.reservation.findFirst({
      where: { id: reservationId },
      include: { reservationRooms: { select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 } },
    }),
    'Reservation',
  );
  const rr = r.reservationRooms[0];
  if (!rr) throw conflict('The reservation has no room line');
  return rr.id;
}

export async function resolveFolioTx(ctx: FCtx, tx: Tx, input: ResolveInput) {
  if ('reservationRoomId' in input) return ensureRoomFolio(ctx, tx, input.reservationRoomId);
  if ('reservationId' in input)
    return ensureRoomFolio(ctx, tx, await firstRoomOf(tx, input.reservationId));
  if ('groupId' in input) return ensureGroupFolio(ctx, tx, input.groupId);
  return ensureCompanyFolio(ctx, tx, input.companyId, input.propertyId);
}

/** Main folio of a stay / reservation / group / company account, auto-created (OP-90). */
export async function resolveFolio(ctx: FCtx, input: ResolveInput) {
  const f = await ctx.db.$transaction((tx) => resolveFolioTx(ctx, tx, input), TX_OPTS);
  return getFolio(ctx, f.id);
}

/** Additional (split) folio of a reservation room or a group. */
export async function createSplitFolio(
  ctx: FCtx,
  input: { reservationRoomId: string } | { groupId: string },
) {
  const f = await ctx.db.$transaction(async (tx) => {
    if ('groupId' in input) {
      const g = must(await tx.group.findFirst({ where: { id: input.groupId } }), 'Group');
      assertPropertyAccess(ctx, g.propertyId);
      await ensureGroupFolio(ctx, tx, g.id);
      return createFolio(ctx, tx, {
        propertyId: g.propertyId,
        number: await nextNumber(ctx, tx, g.propertyId, 'folio'),
        kind: 'GROUP',
        groupId: g.id,
      });
    }
    const main = await ensureRoomFolio(ctx, tx, input.reservationRoomId);
    const ref = await roomRef(tx, input.reservationRoomId);
    await advisoryLock(tx, `folio:rr:${ref.id}`);
    const all = await roomFolios(tx, ref);
    return createFolio(ctx, tx, {
      propertyId: main.propertyId,
      number: `${ref.reservationNumber}-${ref.ordinal}-${all.length + 1}`,
      kind: 'STAY',
      stayId: ref.stayId,
      reservationId: ref.reservationId,
      reservationRoomId: ref.id,
    });
  }, TX_OPTS);
  return getFolio(ctx, f.id);
}

// ───────────────────────────── read model ─────────────────────────────

export interface FolioLinks {
  kind: FolioKind;
  reservationId: string | null;
  reservationNumber: string | null;
  reservationRoomId: string | null;
}

/** Links of a folio, from its columns (`kind`, `reservation_id`, `reservation_room_id`). */
export async function linksOf(db: Db, f: FolioRow): Promise<FolioLinks> {
  const r = f.reservationId
    ? await db.reservation.findFirst({ where: { id: f.reservationId }, select: { number: true } })
    : null;
  return {
    kind: f.kind,
    reservationId: f.reservationId,
    reservationNumber: r?.number ?? null,
    reservationRoomId: f.reservationRoomId,
  };
}

export const toFolioHeader = (f: FolioRow, links: FolioLinks) => ({
  id: f.id,
  propertyId: f.propertyId,
  number: f.number,
  status: f.status,
  currency: f.currency,
  balance: num(f.balance),
  stayId: f.stayId,
  groupId: f.groupId,
  companyId: f.companyId,
  closedAt: f.closedAt?.toISOString() ?? null,
  createdAt: f.createdAt.toISOString(),
  ...links,
});

export async function loadFolio(ctx: FCtx, id: string): Promise<FolioRow> {
  const f = must(await ctx.db.folio.findFirst({ where: { id } }), 'Folio');
  assertPropertyAccess(ctx, f.propertyId);
  return f;
}

export async function getFolio(ctx: FCtx, id: string) {
  const f = await loadFolio(ctx, id);
  const db = ctx.db as unknown as Db;
  const [lines, payments, taxes, sums, links] = await Promise.all([
    db.folioLine.findMany({
      where: { folioId: id },
      include: lineInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.folioPayment.findMany({ where: { folioId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    taxesByCode(db, f.propertyId),
    folioSums(db, id),
    linksOf(db, f),
  ]);
  return {
    ...toFolioHeader(f, links),
    balance: num(sums.balance),
    chargesTotal: num(sums.charges),
    paymentsTotal: num(sums.payments),
    taxBreakdown: breakdown(lines, taxes),
    lines: lines.map(toLine),
    payments: payments.map(toPayment),
  };
}
export type FolioDto = Awaited<ReturnType<typeof getFolio>>;

export interface ListFoliosQuery {
  propertyId?: string | undefined;
  reservationId?: string | undefined;
  reservationRoomId?: string | undefined;
  groupId?: string | undefined;
  companyId?: string | undefined;
  status?: 'OPEN' | 'CLOSED' | undefined;
  limit: number;
  cursor?: string | undefined;
}

export async function listFolios(ctx: FCtx, q: ListFoliosQuery) {
  const db = ctx.db as unknown as Db;
  const where: Prisma.FolioWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.propertyId ? { propertyId: q.propertyId } : {}),
    ...(q.groupId ? { groupId: q.groupId } : {}),
    ...(q.companyId ? { companyId: q.companyId } : {}),
  };
  if (q.propertyId) assertPropertyAccess(ctx, q.propertyId);
  else if (!ctx.grants.permissions.includes('*')) where.propertyId = { in: ctx.grants.propertyIds };
  if (q.reservationRoomId) {
    await roomRef(db, q.reservationRoomId);
    where.reservationRoomId = q.reservationRoomId;
  } else if (q.reservationId) {
    must(await db.reservation.findFirst({ where: { id: q.reservationId } }), 'Reservation');
    where.reservationId = q.reservationId;
  }
  const rows = await db.folio.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > q.limit;
  const items = more ? rows.slice(0, q.limit) : rows;
  const out = [];
  for (const f of items) out.push(toFolioHeader(f, await linksOf(db, f)));
  return { items: out, nextCursor: more ? (items[items.length - 1]?.id ?? null) : null };
}

// ───────────────────────────── postings ─────────────────────────────

interface ChargeSpec {
  type: FolioLineType;
  label: string;
  departmentCode: string | null;
  /** Quantity in thousandths (1 = 1000). */
  qtyMilli: bigint;
  gross: bigint;
  taxes: readonly FolioTaxSpec[];
  persons?: number;
  withFixed?: boolean;
  productId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  businessDate: string;
}

const qtyString = (milli: bigint) => {
  const neg = milli < 0n;
  const a = neg ? -milli : milli;
  return `${neg ? '-' : ''}${a / 1000n}.${(a % 1000n).toString().padStart(3, '0')}`;
};

function taxFailure(e: unknown): never {
  if (e instanceof TaxMathError) throw invalid('taxes', e.message, 'TAX_CONFIG');
  throw e;
}

/** Writes a charge line and its tax lines (one line per tax, linked by `source_id`). */
async function insertCharge(ctx: FCtx, tx: Tx, folio: FolioRow, spec: ChargeSpec): Promise<LineRow> {
  let c;
  try {
    c = computeTaxes(spec.gross, spec.taxes, { persons: spec.persons ?? 1, withFixed: spec.withFixed ?? false });
  } catch (e) {
    taxFailure(e);
  }
  await assertDayOpen(tx, folio.propertyId, spec.businessDate);
  const taxTotal = c.taxes.reduce((s, t) => s + t.amount, 0n);
  const day = parseDay(spec.businessDate);
  const base = await tx.folioLine.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: folio.propertyId,
      folioId: folio.id,
      productId: spec.productId ?? null,
      businessDate: day,
      type: spec.type,
      departmentCode: spec.departmentCode,
      label: spec.label,
      qty: qtyString(spec.qtyMilli),
      currency: folio.currency,
      unitAmount: spec.qtyMilli === 0n ? c.net : mulDivRound(c.net, 1000n, spec.qtyMilli),
      amount: c.net,
      taxAmount: taxTotal,
      sourceType: spec.sourceType,
      sourceId: spec.sourceId ?? null,
      createdBy: ctx.actorId,
    },
    include: lineInclude,
  });
  for (const t of c.taxes)
    await tx.folioLine.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        businessDate: day,
        type: 'TAX',
        departmentCode: t.tax.code,
        label: t.tax.name,
        qty: String(t.qty),
        currency: folio.currency,
        unitAmount: t.unitAmount,
        amount: t.amount,
        sourceType: SRC.tax,
        sourceId: base.id,
        createdBy: ctx.actorId,
      },
    });
  return base;
}

async function taxSpecs(
  db: Pick<Db, 'tax'>,
  where: Prisma.TaxWhereInput,
): Promise<{ specs: FolioTaxSpec[]; childrenExempt: Set<string> }> {
  const rows = await db.tax.findMany({
    where: { ...where, deletedAt: null },
    include: { taxRule: { select: { exemptions: true } } },
    orderBy: { code: 'asc' },
  });
  const childrenExempt = new Set<string>();
  for (const t of rows) {
    const ex = t.taxRule?.exemptions as { children?: unknown } | null | undefined;
    if (ex && ex.children === true) childrenExempt.add(t.id);
  }
  return {
    specs: rows.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      type: t.type,
      value: t.value.toString(),
      inclusive: t.inclusive,
    })),
    childrenExempt,
  };
}

async function finishPosting(ctx: FCtx, tx: Tx, folio: FolioRow, action: string, extra: Record<string, unknown> = {}) {
  const balance = await refreshBalance(tx, folio.id);
  await publishFolioChanged(tx, folio, action, extra);
  return balance;
}

export interface ChargeInput {
  productId?: string | undefined;
  qty: number;
  /** Manual charge: price as priced (TTC when its taxes are inclusive). */
  amount?: number | undefined;
  label?: string | undefined;
  departmentCode?: string | undefined;
  taxIds?: string[] | undefined;
  type?: 'EXTRA' | 'ADJUSTMENT' | 'PENALTY' | undefined;
}

const toMilli = (qty: number) => BigInt(Math.round(qty * 1000));

/** Extra / product charge or manual charge with a department code (OP-90). */
export async function postCharge(ctx: FCtx, folioId: string, input: ChargeInput) {
  const f0 = await loadFolio(ctx, folioId);
  const lineId = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, f0.id);
    assertOpen(folio);
    const prop = await loadProperty(tx, folio.propertyId);
    const qtyMilli = toMilli(input.qty);
    let spec: ChargeSpec;
    if (input.productId) {
      const p = must(
        await tx.product.findFirst({ where: { id: input.productId, propertyId: folio.propertyId, deletedAt: null } }),
        'Product',
      );
      if (!p.isActive) throw invalid('productId', 'Inactive product');
      if (p.currency !== folio.currency) throw invalid('productId', 'Product currency differs from the folio');
      const taxes = p.taxId ? (await taxSpecs(tx, { id: p.taxId })).specs : [];
      spec = {
        type: input.type ?? 'EXTRA',
        label: input.label ?? p.name,
        departmentCode: p.departmentCode ?? input.departmentCode ?? 'EXTRA',
        qtyMilli,
        gross: mulDivRound(p.price, qtyMilli, 1000n),
        taxes,
        productId: p.id,
        sourceType: SRC.product,
        sourceId: p.id,
        businessDate: prop.businessDate,
      };
    } else {
      if (input.amount === undefined) throw invalid('amount', 'amount is required without productId');
      if (!input.label) throw invalid('label', 'label is required without productId');
      if (!input.departmentCode) throw invalid('departmentCode', 'departmentCode is required');
      const ids = input.taxIds ?? [];
      const taxes = ids.length
        ? (await taxSpecs(tx, { id: { in: ids }, propertyId: folio.propertyId })).specs
        : [];
      if (taxes.length !== new Set(ids).size) throw invalid('taxIds', 'Unknown tax for this property');
      if (taxes.some((t) => t.type !== 'PERCENT'))
        throw invalid('taxIds', 'Only percentage taxes apply to a manual charge');
      spec = {
        type: input.type ?? 'EXTRA',
        label: input.label,
        departmentCode: input.departmentCode,
        qtyMilli,
        gross: mulDivRound(BigInt(input.amount), qtyMilli, 1000n),
        taxes,
        sourceType: SRC.manual,
        businessDate: prop.businessDate,
      };
    }
    const line = await insertCharge(ctx, tx, folio, spec);
    await finishPosting(ctx, tx, folio, 'line_posted', { lineId: line.id });
    await ctx.audit({ action: 'folio.line.post', entity: 'folio_line', entityId: line.id, after: toLine(line) });
    return line.id;
  }, TX_OPTS);
  return { lineId, folio: await getFolio(ctx, f0.id) };
}

/** Live lines attached to a charge: its tax lines, its discounts and their tax lines. */
export async function lineGroup(tx: Tx, folioId: string, root: LineRow): Promise<LineRow[]> {
  const children = await tx.folioLine.findMany({
    where: {
      folioId,
      reversalOfId: null,
      reversal: { is: null },
      OR: [
        { sourceType: SRC.tax, sourceId: root.id },
        { type: 'DISCOUNT', sourceType: SRC.discount, sourceId: root.id },
      ],
    },
    include: lineInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const out: LineRow[] = [root];
  for (const c of children) {
    out.push(c);
    if (c.type === 'DISCOUNT')
      out.push(
        ...(await tx.folioLine.findMany({
          where: { folioId, sourceType: SRC.tax, sourceId: c.id, reversalOfId: null, reversal: { is: null } },
          include: lineInclude,
        })),
      );
  }
  return out;
}

async function loadLine(tx: Tx, folioId: string, lineId: string): Promise<LineRow> {
  const l = await tx.folioLine.findFirst({ where: { id: lineId, folioId }, include: lineInclude });
  if (!l) throw notFound('Folio line not found');
  return l;
}

function assertReversible(l: LineRow) {
  if (l.reversalOfId) throw conflict('A reversal line cannot be reversed', { reason: 'IS_REVERSAL' });
  if (l.reversal) throw conflict('The line is already reversed', { reason: 'ALREADY_REVERSED' });
  if (l.type === 'TAX')
    throw conflict('Reverse the charge the tax belongs to', { reason: 'TAX_LINE' });
}

/** Parents are written before their tax lines so the new tax lines point to the new parent. */
function parentFirst(group: LineRow[]): LineRow[] {
  return [...group.filter((l) => l.type !== 'TAX'), ...group.filter((l) => l.type === 'TAX')];
}

/**
 * Reversal of a line group (immutability: never an UPDATE). Returns the map old id → reversal.
 * `labelPrefix` is prepended to each original label.
 */
export async function writeReversal(
  ctx: FCtx,
  tx: Tx,
  folio: FolioRow,
  group: LineRow[],
  labelPrefix: string,
  businessDate: string,
  /** Reason of the correction, stored on every reversal line (`folio_lines.reason`). */
  reason: string,
): Promise<Map<string, LineRow>> {
  await assertDayOpen(tx, folio.propertyId, businessDate);
  const map = new Map<string, LineRow>();
  for (const l of parentFirst(group)) {
    const sourceId = l.sourceId && map.has(l.sourceId) ? map.get(l.sourceId)!.id : l.sourceId;
    const r = await tx.folioLine.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        productId: l.productId,
        reversalOfId: l.id,
        orderId: l.orderId,
        businessDate: parseDay(businessDate),
        type: l.type,
        departmentCode: l.departmentCode,
        label: `${labelPrefix}${l.label}`.slice(0, 250),
        qty: l.qty,
        currency: l.currency,
        unitAmount: -l.unitAmount,
        amount: -l.amount,
        taxAmount: -l.taxAmount,
        sourceType: l.sourceType,
        sourceId,
        reason: reason.slice(0, 200),
        createdBy: ctx.actorId,
      },
      include: lineInclude,
    });
    map.set(l.id, r);
  }
  return map;
}

/** Correction by reversal only (folio.reverse, reason mandatory). */
export async function reverseLine(ctx: FCtx, folioId: string, lineId: string, reason: string) {
  const f0 = await loadFolio(ctx, folioId);
  const ids = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, f0.id);
    assertOpen(folio);
    const line = await loadLine(tx, folio.id, lineId);
    assertReversible(line);
    const group = await lineGroup(tx, folio.id, line);
    const prop = await loadProperty(tx, folio.propertyId);
    const map = await writeReversal(ctx, tx, folio, group, `Contre-passation (${reason}) : `, prop.businessDate, reason);
    await finishPosting(ctx, tx, folio, 'line_reversed', { lineId });
    await ctx.audit({
      action: 'folio.line.reverse',
      entity: 'folio_line',
      entityId: line.id,
      before: toLine(line),
      after: { reason, reversalIds: [...map.values()].map((r) => r.id) },
    });
    return [...map.values()].map((r) => r.id);
  }, TX_OPTS);
  return { reversalLineIds: ids, folio: await getFolio(ctx, f0.id) };
}

export interface DiscountInput {
  lineId: string;
  amount?: number | undefined;
  percent?: number | undefined;
  reason: string;
}

/** Discount on a charge (folio.discount, reason): reduces its HT base and its percentage taxes. */
export async function postDiscount(ctx: FCtx, folioId: string, input: DiscountInput) {
  const f0 = await loadFolio(ctx, folioId);
  const lineId = await ctx.db.$transaction(async (tx) => {
    const folio = await lockFolio(tx, f0.id);
    assertOpen(folio);
    const target = await loadLine(tx, folio.id, input.lineId);
    if (!isLive(target) || target.type === 'TAX' || target.type === 'DISCOUNT' || target.amount <= 0n)
      throw conflict('Only a live positive charge can be discounted', { reason: 'NOT_DISCOUNTABLE' });
    const taxes = await taxesByCode(tx, folio.propertyId);
    const group = await lineGroup(tx, folio.id, target);
    const own = group.filter((l) => l.type === 'TAX' && l.sourceId === target.id);
    const pct = own.filter((l) => taxes.get(l.departmentCode ?? '')?.type === 'PERCENT');
    const ttc = target.amount + pct.reduce((s, l) => s + l.amount, 0n);
    const already = group
      .filter((l) => l.type === 'DISCOUNT' || (l.type === 'TAX' && l.sourceId !== target.id))
      .reduce((s, l) => s + l.amount, 0n);
    const remaining = ttc + already;
    const amount =
      input.amount !== undefined
        ? BigInt(input.amount)
        : mulDivRound(ttc, BigInt(Math.round((input.percent ?? 0) * 100)), 10_000n);
    if (amount <= 0n) throw invalid('amount', 'The discount must be positive');
    if (amount > remaining)
      throw invalid('amount', `The discount exceeds the remaining amount of the line (${remaining})`, 'TOO_LARGE');
    const split = splitProportional(amount, { net: target.amount, taxes: pct.map((l) => l.amount) });
    const prop = await loadProperty(tx, folio.propertyId);
    await assertDayOpen(tx, folio.propertyId, prop.businessDate);
    const day = parseDay(prop.businessDate);
    const d = await tx.folioLine.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        businessDate: day,
        type: 'DISCOUNT',
        departmentCode: target.departmentCode ?? DEPT.discount,
        label: `Remise sur ${target.label} : ${input.reason}`.slice(0, 250),
        reason: input.reason.slice(0, 200),
        qty: '1',
        currency: folio.currency,
        unitAmount: -split.net,
        amount: -split.net,
        taxAmount: -split.taxes.reduce((s, x) => s + x, 0n),
        sourceType: SRC.discount,
        sourceId: target.id,
        createdBy: ctx.actorId,
      },
      include: lineInclude,
    });
    for (const [i, l] of pct.entries())
      if (split.taxes[i] !== 0n)
        await tx.folioLine.create({
          data: {
            tenantId: ctx.tenantId,
            propertyId: folio.propertyId,
            folioId: folio.id,
            businessDate: day,
            type: 'TAX',
            departmentCode: l.departmentCode,
            label: l.label,
            qty: '1',
            currency: folio.currency,
            unitAmount: -split.taxes[i]!,
            amount: -split.taxes[i]!,
            sourceType: SRC.tax,
            sourceId: d.id,
            createdBy: ctx.actorId,
          },
        });
    await finishPosting(ctx, tx, folio, 'discount_posted', { lineId: d.id });
    await ctx.audit({
      action: 'folio.discount',
      entity: 'folio_line',
      entityId: d.id,
      after: { ...toLine(d), reason: input.reason, targetLineId: target.id, ttc: num(amount) },
    });
    return d.id;
  }, TX_OPTS);
  return { lineId, folio: await getFolio(ctx, f0.id) };
}

/** Moves charges to another folio of the same property: reversal here, identical repost there. */
export async function moveLines(
  ctx: FCtx,
  folioId: string,
  input: { lineIds: string[]; targetFolioId: string; reason: string },
) {
  const f0 = await loadFolio(ctx, folioId);
  if (input.targetFolioId === f0.id) throw invalid('targetFolioId', 'Target is the source folio');
  const moved = await ctx.db.$transaction(async (tx) => {
    // Lock both folios in id order (no deadlock between opposite moves).
    const [a, b] = [f0.id, input.targetFolioId].sort();
    const fa = await lockFolio(tx, a!);
    const fb = await lockFolio(tx, b!);
    const src = fa.id === f0.id ? fa : fb;
    const dst = fa.id === f0.id ? fb : fa;
    assertPropertyAccess(ctx, dst.propertyId);
    if (dst.propertyId !== src.propertyId) throw invalid('targetFolioId', 'Folio of another property');
    if (dst.currency !== src.currency) throw invalid('targetFolioId', 'Folio currency differs');
    assertOpen(src);
    assertOpen(dst);
    const prop = await loadProperty(tx, src.propertyId);
    // A charge of a closed day is re-posted in the open day on the target folio.
    const closed = await lastClosedDate(tx, src.propertyId);
    const out: { from: string; to: string }[] = [];
    const seen = new Set<string>();
    for (const id of input.lineIds) {
      if (seen.has(id)) continue;
      const line = await loadLine(tx, src.id, id);
      assertReversible(line);
      if (line.type === 'DISCOUNT') throw conflict('Move the discounted charge instead', { reason: 'DISCOUNT_LINE' });
      const group = await lineGroup(tx, src.id, line);
      group.forEach((l) => seen.add(l.id));
      await writeReversal(ctx, tx, src, group, `Transfert vers ${dst.number} : `, prop.businessDate, input.reason);
      const map = new Map<string, string>();
      for (const l of parentFirst(group)) {
        const n = await tx.folioLine.create({
          data: {
            tenantId: ctx.tenantId,
            propertyId: dst.propertyId,
            folioId: dst.id,
            productId: l.productId,
            orderId: l.orderId,
            businessDate:
              closed && formatDay(l.businessDate) <= closed ? parseDay(prop.businessDate) : l.businessDate,
            type: l.type,
            departmentCode: l.departmentCode,
            label: l.label,
            qty: l.qty,
            currency: l.currency,
            unitAmount: l.unitAmount,
            amount: l.amount,
            taxAmount: l.taxAmount,
            sourceType: l.sourceType,
            sourceId: l.sourceId && map.has(l.sourceId) ? map.get(l.sourceId)! : l.sourceId,
            createdBy: ctx.actorId,
          },
        });
        map.set(l.id, n.id);
      }
      out.push({ from: line.id, to: map.get(line.id)! });
    }
    await finishPosting(ctx, tx, src, 'lines_moved_out', { targetFolioId: dst.id });
    await finishPosting(ctx, tx, dst, 'lines_moved_in', { sourceFolioId: src.id });
    await ctx.audit({
      action: 'folio.lines.move',
      entity: 'folio',
      entityId: src.id,
      after: { targetFolioId: dst.id, moved: out, reason: input.reason },
    });
    return out;
  }, TX_OPTS);
  return { moved, folio: await getFolio(ctx, f0.id) };
}

// ───────────────────────────── room nights ─────────────────────────────

export interface PostNightResult {
  date: string;
  posted: boolean;
  lineId: string | null;
  folioId: string;
}

async function postNightTx(ctx: FCtx, tx: Tx, reservationRoomId: string, date: string): Promise<PostNightResult> {
  const rr = must(
    await tx.reservationRoom.findFirst({
      where: { id: reservationRoomId },
      include: { room: { select: { number: true } }, roomType: { select: { name: true } } },
    }),
    'Reservation room',
  );
  assertPropertyAccess(ctx, rr.propertyId);
  if (rr.status !== 'CHECKED_IN')
    throw conflict('Room nights are posted for in-house stays only', { reason: 'NOT_IN_HOUSE', status: rr.status });
  const arrival = formatDay(rr.arrival);
  const departure = formatDay(rr.departure);
  if (date < arrival || date >= departure)
    throw invalid('businessDate', `The night ${date} is outside the stay ${arrival} → ${departure}`, 'OUT_OF_STAY');
  const folio0 = await ensureRoomFolio(ctx, tx, rr.id);
  await advisoryLock(tx, `night:${rr.id}:${date}`);
  const existing = await tx.folioLine.findFirst({
    where: {
      type: 'ROOM',
      sourceType: SRC.roomNight,
      sourceId: rr.id,
      businessDate: parseDay(date),
      reversalOfId: null,
      reversal: { is: null },
    },
  });
  if (existing) return { date, posted: false, lineId: existing.id, folioId: existing.folioId };
  const closed = await lastClosedDate(tx, rr.propertyId);
  if (closed && date <= closed) throw dayClosed(date, closed);
  const night = parseNightPrices(rr.dailyPrices).find((n) => n.date === date);
  if (!night) throw conflict(`No price snapshot for the night of ${date}`, { reason: 'NO_PRICE' });
  const folio = await lockFolio(tx, folio0.id);
  assertOpen(folio);
  if (rr.currency !== folio.currency) throw conflict('Stay currency differs from the folio currency');
  const { specs, childrenExempt } = await taxSpecs(tx, { propertyId: rr.propertyId, appliesTo: { has: 'LODGING' } });
  // Children exemption (tax_rules.exemptions.children) applies per tax.
  const persons = rr.adults + rr.children;
  const exemptChildren = specs.some((t) => t.type === 'FIXED_PER_PERSON_NIGHT' && childrenExempt.has(t.id));
  const room = rr.room ? ` — ch. ${rr.room.number}` : '';
  const line = await insertCharge(ctx, tx, folio, {
    type: 'ROOM',
    // The night date is not baked into the label: documents format `business_date` per locale.
    label: `Hébergement ${rr.roomType.name}${room}`,
    departmentCode: DEPT.room,
    qtyMilli: 1000n,
    gross: BigInt(night.total),
    taxes: specs,
    withFixed: true,
    persons: exemptChildren ? rr.adults : persons,
    sourceType: SRC.roomNight,
    sourceId: rr.id,
    businessDate: date,
  });
  await finishPosting(ctx, tx, folio, 'room_night_posted', { lineId: line.id, date });
  await ctx.audit({ action: 'folio.room_night.post', entity: 'folio_line', entityId: line.id, after: { reservationRoomId: rr.id, date, amount: num(line.amount) } });
  return { date, posted: true, lineId: line.id, folioId: folio.id };
}

/**
 * Posts the room night `businessDate` of an in-house stay (idempotent per night: a second call
 * returns the existing line). Uses the `daily_prices` snapshot and the LODGING taxes.
 */
export function postRoomNight(ctx: FCtx, reservationRoomId: string, businessDate: string) {
  return ctx.db.$transaction((tx) => postNightTx(ctx, tx, reservationRoomId, businessDate), TX_OPTS);
}

/** Posts every night of the stay up to `date` included (night audit, check-out). */
export async function postNightsUpTo(ctx: FCtx, reservationRoomId: string, date: string) {
  const rr = must(
    await ctx.db.reservationRoom.findFirst({ where: { id: reservationRoomId } }),
    'Reservation room',
  );
  assertPropertyAccess(ctx, rr.propertyId);
  const arrival = formatDay(rr.arrival);
  const departure = formatDay(rr.departure);
  const out: PostNightResult[] = [];
  for (let d = arrival; d <= date && d < departure; d = addDays(d, 1))
    try {
      out.push(await postRoomNight(ctx, rr.id, d));
    } catch (err) {
      // A night of a closed day that was never posted (late check-in) is not charged afterwards.
      if (err instanceof AppError && err.meta?.reason === 'DAY_CLOSED')
        continue;
      throw err;
    }
  return out;
}

/**
 * No-show penalty of a reservation room (night audit), posted once on its main folio in the
 * open business day (`source_type = no_show`, `source_id` = the room line). No tax is applied.
 */
export async function postNoShowPenalty(
  ctx: FCtx,
  reservationRoomId: string,
  amount: number,
  label: string,
): Promise<{ posted: boolean; lineId: string; folioId: string }> {
  return ctx.db.$transaction(async (tx) => {
    const folio0 = await ensureRoomFolio(ctx, tx, reservationRoomId);
    await advisoryLock(tx, `no_show:${reservationRoomId}`);
    const existing = await tx.folioLine.findFirst({
      where: { sourceType: SRC.noShow, sourceId: reservationRoomId, reversalOfId: null, reversal: { is: null } },
    });
    if (existing) return { posted: false, lineId: existing.id, folioId: existing.folioId };
    const folio = await lockFolio(tx, folio0.id);
    assertOpen(folio);
    const prop = await loadProperty(tx, folio.propertyId);
    const line = await insertCharge(ctx, tx, folio, {
      type: 'PENALTY',
      label,
      departmentCode: DEPT.noShow,
      qtyMilli: 1000n,
      gross: BigInt(amount),
      taxes: [],
      sourceType: SRC.noShow,
      sourceId: reservationRoomId,
      businessDate: prop.businessDate,
    });
    await finishPosting(ctx, tx, folio, 'line_posted', { lineId: line.id });
    await ctx.audit({
      action: 'folio.no_show_penalty.post',
      entity: 'folio_line',
      entityId: line.id,
      after: { reservationRoomId, amount },
    });
    return { posted: true, lineId: line.id, folioId: folio.id };
  }, TX_OPTS);
}

// ───────────────────────────── check-out ─────────────────────────────

export interface CheckoutBlocker {
  code: 'NOT_IN_HOUSE' | 'UNPAID_BALANCE' | 'CREDIT_BALANCE' | 'OPEN_POS_ORDERS';
  message: string;
  folioId?: string;
  amount?: number;
  count?: number;
}

/**
 * Check-out support (OP-23): posts the remaining nights, then returns the balance of every folio
 * of the room and the blockers. Nights posted: [arrival, min(departure, max(business date,
 * arrival + 1))) — an early departure does not pay the nights it does not use.
 */
export async function prepareCheckout(ctx: FCtx, reservationRoomId: string) {
  const rr = must(
    await ctx.db.reservationRoom.findFirst({ where: { id: reservationRoomId } }),
    'Reservation room',
  );
  assertPropertyAccess(ctx, rr.propertyId);
  const prop = await loadProperty(ctx.db as unknown as Db, rr.propertyId);
  const arrival = formatDay(rr.arrival);
  const departure = formatDay(rr.departure);
  const blockers: CheckoutBlocker[] = [];
  let posted: PostNightResult[] = [];
  if (rr.status === 'CHECKED_IN') {
    const last = [addDays(departure, -1), addDays(prop.businessDate, -1) < arrival ? arrival : addDays(prop.businessDate, -1)].sort()[0]!;
    posted = (await postNightsUpTo(ctx, rr.id, last)).filter((p) => p.posted);
  } else {
    blockers.push({ code: 'NOT_IN_HOUSE', message: `The stay is ${rr.status}` });
  }
  const db = ctx.db as unknown as Db;
  const folios = await roomFolios(db, await roomRef(db, rr.id));
  const out = [];
  let total = 0n;
  for (const f of folios) {
    const s = await folioSums(db, f.id);
    total += s.balance;
    out.push({ id: f.id, number: f.number, status: f.status, balance: num(s.balance) });
    if (s.balance > 0n)
      blockers.push({ code: 'UNPAID_BALANCE', message: `Folio ${f.number} has an unpaid balance`, folioId: f.id, amount: num(s.balance) });
    if (s.balance < 0n)
      blockers.push({ code: 'CREDIT_BALANCE', message: `Folio ${f.number} owes the guest a refund`, folioId: f.id, amount: num(-s.balance) });
  }
  const stay = await ctx.db.stay.findFirst({ where: { reservationRoomId: rr.id }, select: { id: true } });
  const openOrders = await ctx.db.order.count({
    where: {
      status: { in: ['OPEN', 'SENT', 'SERVED'] },
      OR: [{ folioId: { in: folios.map((f) => f.id) } }, ...(stay ? [{ stayId: stay.id }] : [])],
    },
  });
  if (openOrders)
    blockers.push({ code: 'OPEN_POS_ORDERS', message: 'Open restaurant/bar orders must be settled', count: openOrders });
  return {
    reservationRoomId: rr.id,
    businessDate: prop.businessDate,
    arrival,
    departure,
    postedNights: posted,
    folios: out,
    balance: num(total),
    blockers,
    canCheckout: blockers.length === 0,
  };
}

// ───────────────────────────── business date ─────────────────────────────

export async function getBusinessDate(ctx: FCtx, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  const p = await loadProperty(ctx.db as unknown as Db, propertyId);
  return { propertyId, businessDate: p.businessDate };
}

/** Admin-only setter (tests / demo) until the night audit advances the business date. */
export async function setBusinessDate(ctx: FCtx, propertyId: string, businessDate: string) {
  const before = await getBusinessDate(ctx, propertyId);
  const closed = await lastClosedDate(ctx.db as unknown as Tx, propertyId);
  if (closed && businessDate <= closed) throw dayClosed(businessDate, closed);
  await ctx.db.property.update({ where: { id: propertyId }, data: { businessDate: parseDay(businessDate) } });
  await ctx.audit({
    action: 'property.business_date.set',
    entity: 'property',
    entityId: propertyId,
    before,
    after: { propertyId, businessDate },
  });
  return { propertyId, businessDate };
}

export function hasPermission(ctx: FCtx, permission: string): boolean {
  return PermissionService.allows(ctx.grants, permission);
}

export function forbiddenWithout(ctx: FCtx, permission: string, detail: string) {
  if (!hasPermission(ctx, permission))
    throw new AppError('FORBIDDEN', undefined, { detail, meta: { permission } });
}
