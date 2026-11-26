import type { DailyStatsProperty, Prisma } from '@hm/database';
import { formatDay, num, parseDay } from '../property/common.js';
import { COUNTED_PAYMENT_STATUSES, DEPT, SRC, taxesByCode, type Tx } from '../folio/repository.js';
import { mulDivRound } from '../folio/tax-math.js';

export interface DayStats {
  businessDate: string;
  currency: string;
  roomsAvailable: number;
  roomsSold: number;
  /** Occupancy in percent with one decimal, as text ("66.7"). */
  occupancy: string;
  /** Occupancy in basis points (6 667 = 66.67 %). */
  occupancyBp: number;
  roomRevenue: number;
  totalRevenue: number;
  adr: number;
  revpar: number;
  /** Net revenue (HT, discounts and reversals of the day included) per department code. */
  revenueByDept: Record<string, number>;
  taxes: { code: string; name: string; kind: 'VAT' | 'TOURIST'; amount: number }[];
  vatTotal: number;
  touristTaxTotal: number;
  payments: { method: string; amount: number }[];
  paymentsTotal: number;
  arrivals: number;
  departures: number;
  inHouse: number;
  noShows: number;
  /** Window of the time-stamped facts (check-ins, check-outs): previous closing → this one. */
  window: { from: string; to: string };
}

const ratio = (a: bigint, b: bigint) => (b === 0n ? 0n : mulDivRound(a, 1n, b));

/** Local midnight of `day` in `timeZone`, as an instant. */
export function zonedMidnight(day: string, timeZone: string): Date {
  const utc = new Date(`${day}T00:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utc);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return new Date(utc.getTime() - (asUtc - utc.getTime()));
}

/** Occupancy of a day as basis points and as "66.7" text. */
function occupancyOf(sold: number, available: number) {
  const occupancyBp = available ? Number(mulDivRound(BigInt(sold), 10_000n, BigInt(available))) : 0;
  const occ10 = available ? Number(mulDivRound(BigInt(sold), 1_000n, BigInt(available))) : 0;
  return { occupancyBp, occupancy: `${Math.trunc(occ10 / 10)}.${occ10 % 10}` };
}

/**
 * Daily KPIs of business date `D` (OP-100: occupancy, ADR, RevPAR; X13 aggregates). Postings and
 * payments are taken by `business_date = D` (the day is locked, so final); check-ins and
 * check-outs carry no business date and are taken in the `window` between two closings.
 */
export async function computeDayStats(
  tx: Tx,
  input: {
    propertyId: string;
    currency: string;
    businessDate: string;
    window: { from: Date; to: Date };
    noShows: number;
  },
): Promise<DayStats> {
  const { propertyId, businessDate: D } = input;
  const day = parseDay(D);
  const [rooms, blocked, lines, taxes, payments, arrivals, departures, inHouse] = await Promise.all([
    tx.room.count({ where: { propertyId, isActive: true, deletedAt: null } }),
    tx.roomBlock.findMany({
      where: {
        room: { propertyId, isActive: true, deletedAt: null },
        fromDate: { lte: day },
        toDate: { gt: day },
      },
      select: { roomId: true },
      distinct: ['roomId'],
    }),
    tx.folioLine.findMany({
      where: { propertyId, businessDate: day },
      select: {
        id: true,
        type: true,
        amount: true,
        departmentCode: true,
        label: true,
        sourceType: true,
        sourceId: true,
        reversalOfId: true,
        reversal: { select: { id: true } },
      },
    }),
    taxesByCode(tx, propertyId),
    tx.folioPayment.groupBy({
      by: ['method'],
      where: {
        propertyId,
        status: { in: [...COUNTED_PAYMENT_STATUSES] },
        businessDate: day,
      },
      _sum: { amount: true },
    }),
    tx.stay.count({ where: { propertyId, checkedInAt: { gt: input.window.from, lte: input.window.to } } }),
    tx.stay.count({ where: { propertyId, checkedOutAt: { gt: input.window.from, lte: input.window.to } } }),
    tx.reservationRoom.count({ where: { propertyId, status: 'CHECKED_IN' } }),
  ]);

  const byDept = new Map<string, bigint>();
  const byTax = new Map<string, bigint>();
  const sold = new Set<string>();
  for (const l of lines) {
    if (l.type === 'TAX') {
      const code = l.departmentCode ?? l.label;
      byTax.set(code, (byTax.get(code) ?? 0n) + l.amount);
      continue;
    }
    // A city-ledger transfer moves a receivable, it is not revenue.
    if (l.departmentCode === DEPT.cityLedger) continue;
    const code = l.departmentCode ?? 'OTHER';
    byDept.set(code, (byDept.get(code) ?? 0n) + l.amount);
    if (l.type === 'ROOM' && l.sourceType === SRC.roomNight && l.sourceId && !l.reversalOfId && !l.reversal)
      sold.add(l.sourceId);
  }

  const available = Math.max(0, rooms - blocked.length);
  const roomRevenue = byDept.get(DEPT.room) ?? 0n;
  const totalRevenue = [...byDept.values()].reduce((s, x) => s + x, 0n);
  const taxRows = [...byTax.entries()]
    .map(([code, amount]) => {
      const t = taxes.get(code);
      return {
        code,
        name: t?.name ?? code,
        kind: (t && t.type !== 'PERCENT' ? 'TOURIST' : 'VAT') as 'VAT' | 'TOURIST',
        amount: num(amount),
      };
    })
    .filter((t) => t.amount !== 0)
    .sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === 'VAT' ? -1 : 1));
  const pay = payments
    .map((p) => ({ method: p.method as string, amount: num(p._sum.amount ?? 0n) }))
    .filter((p) => p.amount !== 0)
    .sort((a, b) => a.method.localeCompare(b.method));
  const revenueByDept = Object.fromEntries(
    [...byDept.entries()].filter(([, v]) => v !== 0n).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, num(v)]),
  );
  return {
    businessDate: D,
    currency: input.currency,
    roomsAvailable: available,
    roomsSold: sold.size,
    ...occupancyOf(sold.size, available),
    roomRevenue: num(roomRevenue),
    totalRevenue: num(totalRevenue),
    adr: num(ratio(roomRevenue, BigInt(sold.size))),
    revpar: num(ratio(roomRevenue, BigInt(available))),
    revenueByDept,
    taxes: taxRows,
    vatTotal: taxRows.filter((t) => t.kind === 'VAT').reduce((s, t) => s + t.amount, 0),
    touristTaxTotal: taxRows.filter((t) => t.kind === 'TOURIST').reduce((s, t) => s + t.amount, 0),
    payments: pay,
    paymentsTotal: pay.reduce((s, p) => s + p.amount, 0),
    arrivals,
    departures,
    inHouse,
    noShows: input.noShows,
    window: { from: input.window.from.toISOString(), to: input.window.to.toISOString() },
  };
}

/** Writes the X13 aggregates of the day (idempotent: upserts, stale departments removed). */
export async function writeDailyStats(tx: Tx, tenantId: string, propertyId: string, s: DayStats) {
  const day = parseDay(s.businessDate);
  const data = {
    currency: s.currency,
    occupied: s.roomsSold,
    available: s.roomsAvailable,
    revenueRoom: BigInt(s.roomRevenue),
    revenueByDept: s.revenueByDept as Prisma.InputJsonValue,
    adr: BigInt(s.adr),
    revpar: BigInt(s.revpar),
    revenueTotal: BigInt(s.totalRevenue),
    vatTotal: BigInt(s.vatTotal),
    touristTaxTotal: BigInt(s.touristTaxTotal),
    taxes: s.taxes as unknown as Prisma.InputJsonValue,
    paymentsByMethod: s.payments as unknown as Prisma.InputJsonValue,
    paymentsTotal: BigInt(s.paymentsTotal),
    arrivals: s.arrivals,
    departures: s.departures,
    inHouse: s.inHouse,
    noShows: s.noShows,
  };
  await tx.dailyStatsProperty.upsert({
    where: { propertyId_businessDate: { propertyId, businessDate: day } },
    create: { tenantId, propertyId, businessDate: day, ...data },
    update: data,
  });
  const codes = Object.keys(s.revenueByDept);
  await tx.dailyStatsDepartment.deleteMany({
    where: { propertyId, businessDate: day, departmentCode: { notIn: codes } },
  });
  for (const code of codes) {
    const revenue = BigInt(s.revenueByDept[code]!);
    await tx.dailyStatsDepartment.upsert({
      where: { propertyId_businessDate_departmentCode: { propertyId, businessDate: day, departmentCode: code } },
      create: { tenantId, propertyId, businessDate: day, departmentCode: code, currency: s.currency, revenue },
      update: { revenue, currency: s.currency },
    });
  }
}

/** KPIs of a closed day read back from `daily_stats_property` (the stored source of truth). */
export function statsFromRow(r: DailyStatsProperty, window: { from: Date; to: Date }): DayStats {
  const revenueByDept = (r.revenueByDept ?? {}) as Record<string, number>;
  return {
    businessDate: formatDay(r.businessDate),
    currency: r.currency,
    roomsAvailable: r.available,
    roomsSold: r.occupied,
    ...occupancyOf(r.occupied, r.available),
    roomRevenue: num(r.revenueRoom),
    totalRevenue: num(r.revenueTotal),
    adr: num(r.adr),
    revpar: num(r.revpar),
    revenueByDept,
    taxes: r.taxes as DayStats['taxes'],
    vatTotal: num(r.vatTotal),
    touristTaxTotal: num(r.touristTaxTotal),
    payments: r.paymentsByMethod as DayStats['payments'],
    paymentsTotal: num(r.paymentsTotal),
    arrivals: r.arrivals,
    departures: r.departures,
    inHouse: r.inHouse,
    noShows: r.noShows,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
  };
}
