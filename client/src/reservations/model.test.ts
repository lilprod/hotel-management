import { describe, expect, it } from 'vitest';

import { computePenalty } from './penalty';
import { applyOp, buildPlanningModel, segmentFlags } from './planning-model';
import type { PlanningData } from './api';

describe('penalty preview (mirror of the server computePenalty)', () => {
  const rules = {
    tiers: [
      { daysBefore: 7, penaltyPercent: 0 },
      { daysBefore: 2, penaltyPercent: 50 },
    ],
    noShowPercent: 100,
    firstNightMinimum: true,
  };
  const base = { today: '2026-03-01', stayTotal: 100000, firstNight: 40000 };
  it('applies the tier reached, the late rate, the no-show rate and the first night minimum', () => {
    expect(computePenalty(rules, { ...base, arrival: '2026-03-10' }).amount).toBe(0);
    expect(computePenalty(rules, { ...base, arrival: '2026-03-04' }).amount).toBe(50000);
    expect(computePenalty(rules, { ...base, arrival: '2026-03-02' }).amount).toBe(100000);
    expect(computePenalty(rules, { ...base, arrival: '2026-03-10', noShow: true }).amount).toBe(
      100000,
    );
    expect(
      computePenalty(
        { ...rules, tiers: [{ daysBefore: 2, penaltyPercent: 10 }] },
        { ...base, arrival: '2026-03-04' },
      ).amount,
    ).toBe(40000);
    expect(computePenalty(null, { ...base, arrival: '2026-03-04' }).amount).toBe(0);
  });
});

const data: PlanningData = {
  propertyId: 'p',
  from: '2026-03-01',
  to: '2026-03-05',
  businessDate: '2026-03-01',
  roomTypes: [
    {
      id: 't1',
      code: 'S',
      name: 'Standard',
      rooms: [
        { id: 'a', number: '101', floor: null, building: null, hkStatus: 'CLEAN' },
        { id: 'b', number: '102', floor: null, building: null, hkStatus: 'CLEAN' },
      ],
      freeByNight: [],
    },
  ],
  segments: [
    seg('s1', 'a', '2026-03-01', '2026-03-03', 'CONFIRMED'),
    seg('s2', null, '2026-03-02', '2026-03-04', 'PENDING'),
    seg('s3', null, '2026-03-03', '2026-03-05', 'PENDING'),
    seg('s4', 'b', '2026-03-01', '2026-03-02', 'CHECKED_IN'),
  ],
  blocks: [
    {
      id: 'b1',
      roomId: 'b',
      fromDate: '2026-03-03',
      toDate: '2026-03-05',
      reason: 'MAINT',
      note: null,
    },
  ],
};

function seg(
  id: string,
  roomId: string | null,
  arrival: string,
  departure: string,
  status: string,
) {
  return {
    id,
    reservationId: `r-${id}`,
    number: id,
    roomId,
    roomTypeId: 't1',
    guestName: id,
    status,
    arrival,
    departure,
    adults: 1,
    children: 0,
    groupId: null,
    colorKey: status.toLowerCase(),
  };
}

describe('planning model', () => {
  it('builds resources with unassigned lanes, flags and occupancy per day', () => {
    const m = buildPlanningModel(data, { unassignedLabel: 'NA' });
    expect(m.resources.map((r) => r.id)).toEqual(['a', 'b', 'un:t1:0', 'un:t1:1']);
    // s2 (Mar 2-4) and s3 (Mar 3-5) overlap: two lanes
    expect(m.segments.find((s) => s.id === 's3')?.resourceId).toBe('un:t1:1');
    expect(m.blocks).toHaveLength(1);
    expect(m.occupancy.get('2026-03-03')).toBe(100); // s2, s3 on 2 rooms
    expect(m.occupancy.get('2026-03-01')).toBe(100); // s1 + s4
    // CHECKED_IN: only its departure can change; confirmed / pending: everything
    expect(segmentFlags({ status: 'CHECKED_IN', colorKey: 'checked_in' })).toEqual({
      draggable: false,
      resizable: true,
    });
    expect(segmentFlags({ status: 'CONFIRMED', colorKey: 'allotment' })).toEqual({
      draggable: false,
      resizable: false,
    });
  });

  it('filters by room type and patches optimistically', () => {
    expect(
      buildPlanningModel(data, { typeIds: ['other'], unassignedLabel: 'NA' }).resources,
    ).toHaveLength(0);
    const moved = applyOp(data, {
      kind: 'move',
      segmentId: 's2',
      roomId: 'b',
      arrival: '2026-03-02',
      departure: '2026-03-04',
    });
    expect(moved.segments.find((s) => s.id === 's2')?.roomId).toBe('b');
    const resized = applyOp(data, {
      kind: 'resize',
      segmentId: 's1',
      reservationId: 'r-s1',
      fromDeparture: '2026-03-03',
      departure: '2026-03-05',
    });
    expect(resized.segments.find((s) => s.id === 's1')?.departure).toBe('2026-03-05');
    expect(data.segments.find((s) => s.id === 's1')?.departure).toBe('2026-03-03'); // immutable
  });
});
