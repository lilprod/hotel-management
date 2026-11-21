import type { TimelineBlock, TimelineGroup, TimelineResource, TimelineSegment } from '@hm/ui';

import { addDays, nightsBetween } from './api';
import type { PlanningData, PlanningSegment } from './api';

/** Pure model of the planning page: server payload → timeline props, optimistic patches. */

export const UNASSIGNED_PREFIX = 'un:';

export const isUnassignedResource = (id: string) => id.startsWith(UNASSIGNED_PREFIX);
export const unassignedTypeOf = (id: string) => id.split(':')[1] ?? '';

export interface PlanningModel {
  resources: TimelineResource[];
  groups: TimelineGroup[];
  segments: TimelineSegment[];
  blocks: TimelineBlock[];
  /** Occupancy (0-100) per night of the range. */
  occupancy: Map<string, number>;
  totalRooms: number;
}

/** Statuses whose dates / room may still be edited by drag & drop (CHECKED_IN: departure only). */
export function segmentFlags(s: Pick<PlanningSegment, 'status' | 'colorKey'>) {
  const editable =
    s.colorKey !== 'allotment' && (s.status === 'PENDING' || s.status === 'CONFIRMED');
  const checkedIn = s.status === 'CHECKED_IN';
  return { draggable: editable, resizable: editable || checkedIn };
}

/** Greedy lane packing of the segments of a type that have no room yet. */
function packLanes(list: PlanningSegment[]): Map<string, number> {
  const lanes: string[] = [];
  const out = new Map<string, number>();
  for (const s of [...list].sort((a, b) => a.arrival.localeCompare(b.arrival))) {
    let lane = lanes.findIndex((end) => end <= s.arrival);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(s.departure);
    } else lanes[lane] = s.departure;
    out.set(s.id, lane);
  }
  return out;
}

export function buildPlanningModel(
  data: PlanningData,
  opts: { typeIds?: readonly string[]; unassignedLabel: string },
): PlanningModel {
  const wanted = opts.typeIds?.length ? new Set(opts.typeIds) : null;
  const types = data.roomTypes.filter((t) => !wanted || wanted.has(t.id));
  const resources: TimelineResource[] = [];
  const groups: TimelineGroup[] = [];
  const segments: TimelineSegment[] = [];
  const blocks: TimelineBlock[] = [];
  const roomType = new Map<string, string>();
  for (const t of data.roomTypes) for (const r of t.rooms) roomType.set(r.id, t.id);

  const byType = new Map<string, PlanningSegment[]>();
  for (const s of data.segments) {
    const list = byType.get(s.roomTypeId) ?? [];
    list.push(s);
    byType.set(s.roomTypeId, list);
  }

  for (const t of types) {
    groups.push({ id: t.id, label: `${t.name} (${t.rooms.length})` });
    for (const r of t.rooms)
      resources.push({
        id: r.id,
        group: t.id,
        label: r.number,
        sublabel: r.floor ?? undefined,
        ariaLabel: `${t.name} ${r.number}`,
      });
    const loose = (byType.get(t.id) ?? []).filter((s) => !s.roomId);
    const lanes = packLanes(loose);
    const laneCount = loose.length ? Math.max(...lanes.values()) + 1 : 0;
    for (let i = 0; i < laneCount; i++)
      resources.push({
        id: `${UNASSIGNED_PREFIX}${t.id}:${i}`,
        group: t.id,
        label: opts.unassignedLabel,
        ariaLabel: `${t.name} ${opts.unassignedLabel}`,
      });
    for (const s of byType.get(t.id) ?? []) {
      const lane = lanes.get(s.id);
      segments.push({
        id: s.id,
        resourceId: s.roomId ?? `${UNASSIGNED_PREFIX}${t.id}:${lane ?? 0}`,
        start: s.arrival,
        end: s.departure,
        label: s.guestName || s.number,
        ariaLabel: `${s.guestName || s.number}, ${s.arrival} - ${s.departure}`,
        colorKey: s.colorKey,
        ...segmentFlags(s),
        data: s,
      });
    }
  }
  const shown = new Set(resources.map((r) => r.id));
  for (const b of data.blocks)
    if (shown.has(b.roomId))
      blocks.push({
        id: b.id,
        resourceId: b.roomId,
        start: b.fromDate,
        end: b.toDate,
        label: b.reason,
      });

  // Occupancy per night: every segment of the payload holds a unit (cancelled / no-show excluded).
  const totalRooms = data.roomTypes.reduce((n, t) => n + t.rooms.length, 0);
  const counts = new Map<string, number>();
  for (const s of data.segments)
    for (let d = s.arrival; d < s.departure; d = addDays(d, 1))
      counts.set(d, (counts.get(d) ?? 0) + 1);
  const occupancy = new Map<string, number>();
  const nights = nightsBetween(data.from, data.to);
  for (let i = 0; i < nights; i++) {
    const day = addDays(data.from, i);
    occupancy.set(
      day,
      totalRooms ? Math.min(100, Math.round(((counts.get(day) ?? 0) / totalRooms) * 100)) : 0,
    );
  }
  return { resources, groups, segments, blocks, occupancy, totalRooms };
}

export type PlanningOp =
  | { kind: 'move'; segmentId: string; roomId: string | null; arrival: string; departure: string }
  | {
      kind: 'resize';
      segmentId: string;
      reservationId: string;
      fromDeparture: string;
      departure: string;
    };

/** Optimistic application of a drag operation to the cached planning. */
export function applyOp(data: PlanningData, op: PlanningOp): PlanningData {
  return {
    ...data,
    segments: data.segments.map((s) => {
      // Extend / shorten work on the dossier: every room leaving on the same day follows.
      if (op.kind === 'resize')
        return s.reservationId === op.reservationId && s.departure === op.fromDeparture
          ? { ...s, departure: op.departure }
          : s;
      if (s.id !== op.segmentId) return s;
      const type = op.roomId
        ? data.roomTypes.find((t) => t.rooms.some((r) => r.id === op.roomId))?.id
        : undefined;
      return {
        ...s,
        roomId: op.roomId,
        roomTypeId: type ?? s.roomTypeId,
        arrival: op.arrival,
        departure: op.departure,
      };
    }),
  };
}
