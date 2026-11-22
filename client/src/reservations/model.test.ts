import { describe, expect, it } from 'vitest';

import { applyOp, buildPlanningModel, segmentFlags, segmentName } from './planning-model';
import type { PlanningData } from './api';

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
    kind: 'reservation' as const,
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
      resizableStart: false,
    });
    expect(segmentFlags({ status: 'CONFIRMED', colorKey: 'allotment' })).toEqual({
      draggable: false,
      resizable: false,
      resizableStart: false,
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

describe('planning model: one segment per reservation_room', () => {
  it('an assigned segment sits on its room only, an unassigned one in a lane of its type only', () => {
    const m = buildPlanningModel(data, { unassignedLabel: 'NA' });
    expect(m.segments).toHaveLength(data.segments.length);
    expect(new Set(m.segments.map((s) => s.id)).size).toBe(data.segments.length);
    for (const s of data.segments) {
      const placed = m.segments.filter((x) => x.id === s.id);
      expect(placed).toHaveLength(1);
      if (s.roomId) expect(placed[0]!.resourceId).toBe(s.roomId);
      else expect(placed[0]!.resourceId.startsWith('un:t1:')).toBe(true);
    }
  });
});

describe('segment names', () => {
  it('an allotment is labelled by the client, never by the server', () => {
    const a = {
      ...seg('x', null, '2026-03-01', '2026-03-02', 'CONFIRMED'),
      guestName: '',
      kind: 'allotment' as const,
    };
    expect(segmentName(a, 'Bloc groupe')).toBe('Bloc groupe');
    expect(segmentName(seg('y', 'a', '2026-03-01', '2026-03-02', 'CONFIRMED'), 'Bloc groupe')).toBe(
      'y',
    );
  });
});
