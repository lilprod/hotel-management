import type { Prisma, TransactionClient } from '@hm/database';
import { publishEvent } from '../../core/events.js';

export const RESERVATION_EVENTS = {
  /** Live planning refresh, emitted to the property room `t:{tid}:p:{pid}`. */
  planningChanged: 'planning.changed',
  /** Nights given back to the inventory (cancel, shorten, move, no-show, expiry, release). */
  inventoryReleased: 'inventory.released',
  created: 'reservation.created',
  updated: 'reservation.updated',
  confirmed: 'reservation.confirmed',
  /** Carries the computed penalty (posted on the folio by the billing lot). */
  cancelled: 'reservation.cancelled',
  noShow: 'reservation.no_show',
  waitlistOffered: 'waitlist.offered',
} as const;

type Tx = Pick<TransactionClient, 'outboxEvent'>;

export interface PlanningChange {
  propertyId: string;
  reservationId: string;
  action: string;
  from: string;
  to: string;
  reservationRoomIds?: string[];
}

export function publishPlanningChanged(tx: Tx, change: PlanningChange) {
  return publishEvent(
    tx,
    RESERVATION_EVENTS.planningChanged,
    change as unknown as Prisma.InputJsonValue,
  );
}

export interface InventoryRelease {
  propertyId: string;
  roomTypeIds: string[];
  from: string;
  to: string;
  cause: string;
}

export function publishInventoryReleased(tx: Tx, r: InventoryRelease) {
  return publishEvent(
    tx,
    RESERVATION_EVENTS.inventoryReleased,
    r as unknown as Prisma.InputJsonValue,
  );
}

export function publish(tx: Tx, type: string, payload: Record<string, unknown>) {
  return publishEvent(tx, type, payload as Prisma.InputJsonValue);
}
