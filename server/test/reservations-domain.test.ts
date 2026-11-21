import { describe, expect, it } from 'vitest';
import { addDays, localDay, nightsOf } from '../src/modules/availability/dates.js';
import { buildInventory, checkDemands, freeOn } from '../src/modules/availability/inventory.js';
import {
  computePenalty,
  guardTransition,
  RESERVATION_STATUSES,
  TRANSITIONS,
  type ReservationStatusName,
} from '../src/modules/reservations/lifecycle.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('lifecycle guard (table)', () => {
  const facts = {
    businessDate: '2026-12-01',
    arrival: '2026-12-01',
    departure: '2026-12-03',
    allRoomsAssigned: true,
    folioSettled: true,
  };
  const allowed: [ReservationStatusName, ReservationStatusName][] = [
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'CANCELLED'],
    ['CONFIRMED', 'CHECKED_IN'],
    ['CONFIRMED', 'CANCELLED'],
    ['CONFIRMED', 'NO_SHOW'],
    ['CHECKED_IN', 'CHECKED_OUT'],
    ['CHECKED_OUT', 'COMPLETED'],
  ];
  for (const from of RESERVATION_STATUSES)
    for (const to of RESERVATION_STATUSES) {
      const ok = allowed.some(([a, b]) => a === from && b === to);
      it(`${from} → ${to}: ${ok ? 'allowed' : 'refused'}`, () => {
        const g = guardTransition(from, to, facts);
        expect(g.ok).toBe(ok);
        if (!ok) expect(g).toMatchObject({ reason: 'INVALID_TRANSITION' });
      });
    }

  it('graph matches the table', () => {
    const n = Object.values(TRANSITIONS).reduce((s, l) => s + l.length, 0);
    expect(n).toBe(allowed.length);
  });

  it.each([
    ['CHECKED_IN', { arrival: '2026-12-02' }, 'TOO_EARLY'],
    ['CHECKED_IN', { allRoomsAssigned: false }, 'ROOM_NOT_ASSIGNED'],
    ['CHECKED_IN', { departure: '2026-12-01' }, 'STAY_OVER'],
    ['NO_SHOW', { arrival: '2026-12-05', departure: '2026-12-06' }, 'TOO_EARLY'],
  ] as const)('CONFIRMED → %s refused when %o (%s)', (to, over, reason) => {
    expect(guardTransition('CONFIRMED', to, { ...facts, ...over })).toMatchObject({
      ok: false,
      reason,
    });
  });

  it('COMPLETED needs a settled folio', () => {
    expect(
      guardTransition('CHECKED_OUT', 'COMPLETED', { ...facts, folioSettled: false }),
    ).toMatchObject({ ok: false, reason: 'FOLIO_NOT_SETTLED' });
  });
});

describe('cancellation penalty', () => {
  const rules = {
    tiers: [
      { daysBefore: 7, penaltyPercent: 0 },
      { daysBefore: 2, penaltyPercent: 50 },
    ],
    noShowPercent: 100,
    firstNightMinimum: false,
  };
  const base = { arrival: '2026-12-20', stayTotal: 90_000, firstNight: 30_000 };
  it.each([
    ['2026-12-01', 0, 7],
    ['2026-12-13', 0, 7],
    ['2026-12-14', 50, 2],
    ['2026-12-18', 50, 2],
    ['2026-12-19', 100, null],
    ['2026-12-20', 100, null],
  ] as const)('cancel on %s → %i%% (tier %s)', (today, percent, tier) => {
    const p = computePenalty(rules, { ...base, today });
    expect(p.percent).toBe(percent);
    expect(p.tier).toBe(tier);
    expect(p.amount).toBe((90_000 * percent) / 100);
    expect(Number.isInteger(p.amount)).toBe(true);
  });
  it('no-show applies the no-show rate', () => {
    expect(computePenalty(rules, { ...base, today: '2026-12-01', noShow: true }).amount).toBe(
      90_000,
    );
  });
  it('first night minimum and rounding half up', () => {
    const r = { ...rules, tiers: [{ daysBefore: 0, penaltyPercent: 10 }], firstNightMinimum: true };
    expect(computePenalty(r, { ...base, today: '2026-12-19' }).amount).toBe(30_000);
    const odd = computePenalty(
      { ...rules, tiers: [{ daysBefore: 0, penaltyPercent: 33 }] },
      { ...base, stayTotal: 10_001, today: '2026-12-19' },
    );
    expect(odd.amount).toBe(3300);
  });
  it('no policy → no penalty', () => {
    expect(computePenalty(null, { ...base, today: '2026-12-19' }).amount).toBe(0);
  });
});

describe('inventory math', () => {
  const rooms = [
    { id: 'r1', roomTypeId: 'STD', hkStatus: 'CLEAN' },
    { id: 'r2', roomTypeId: 'STD', hkStatus: 'DIRTY' },
    { id: 'r3', roomTypeId: 'STD', hkStatus: 'OUT_OF_ORDER' },
    { id: 'r4', roomTypeId: 'DLX', hkStatus: 'CLEAN' },
  ];
  const q = { from: '2026-12-01', to: '2026-12-04' };

  it('OOO, blocks, assigned nights and unassigned demand are deducted once per unit', () => {
    const inv = buildInventory(
      q,
      rooms,
      [{ roomId: 'r2', fromDate: d('2026-12-02'), toDate: d('2026-12-03') }],
      [
        // r3 is OOO and also holds a night: counted once.
        { unitId: 'r3', night: d('2026-12-01'), reservationRoomId: 'x' },
        { unitId: 'r1', night: d('2026-12-03'), reservationRoomId: 'y' },
      ],
      [{ roomTypeId: 'STD', arrival: d('2026-11-30'), departure: d('2026-12-02') }],
    );
    const std = inv.perType.get('STD')!;
    expect(std.map((n) => n.free)).toEqual([1, 1, 1]);
    expect(std[0]).toMatchObject({ total: 3, outOfOrder: 1, unassigned: 1, occupied: 0 });
    expect(std[1]).toMatchObject({ blocked: 1, unassigned: 0 });
    expect(std[2]).toMatchObject({ occupied: 1 });
    expect(freeOn(inv, 'DLX', '2026-12-02')).toBe(1);
  });

  it('departure day is reusable (departure excluded)', () => {
    const inv = buildInventory(
      q,
      [rooms[0]!],
      [],
      [{ unitId: 'r1', night: d('2026-12-01'), reservationRoomId: 'a' }],
      [],
    );
    const ok = checkDemands(inv, [
      { roomTypeId: 'STD', arrival: '2026-12-02', departure: '2026-12-04', roomId: 'r1' },
    ]);
    expect(ok).toEqual({ short: [], clashes: [] });
    const ko = checkDemands(inv, [
      { roomTypeId: 'STD', arrival: '2026-11-30', departure: '2026-12-02', roomId: 'r1' },
    ]);
    expect(ko.clashes).toEqual([
      { roomId: 'r1', date: '2026-12-01', reason: 'OCCUPIED', reservationRoomId: 'a' },
    ]);
  });

  it('overbooking allowance adds sellable units; demands of one request add up', () => {
    const inv = buildInventory({ ...q, allowance: 1 }, [rooms[0]!], [], [], []);
    expect(freeOn(inv, 'STD', '2026-12-01')).toBe(2);
    const r = checkDemands(inv, [
      { roomTypeId: 'STD', arrival: '2026-12-01', departure: '2026-12-02' },
      { roomTypeId: 'STD', arrival: '2026-12-01', departure: '2026-12-02' },
      { roomTypeId: 'STD', arrival: '2026-12-01', departure: '2026-12-02' },
    ]);
    expect(r.short).toEqual([{ roomTypeId: 'STD', date: '2026-12-01', free: 2, needed: 3 }]);
  });

  it('date helpers', () => {
    expect(nightsOf('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(localDay(new Date('2026-12-01T23:30:00Z'), 'Africa/Lome')).toBe('2026-12-01');
    expect(localDay(new Date('2026-12-01T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-12-02');
  });
});
