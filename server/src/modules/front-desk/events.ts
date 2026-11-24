import type { Prisma, TransactionClient } from '@hm/database';
import { publishEvent } from '../../core/events.js';

export const FRONT_DESK_EVENTS = {
  checkedIn: 'stay.checked_in',
  checkedOut: 'stay.checked_out',
  roomChanged: 'stay.room_changed',
} as const;

export function publishStayEvent(
  tx: Pick<TransactionClient, 'outboxEvent'>,
  type: string,
  payload: Record<string, unknown>,
) {
  return publishEvent(tx, type, payload as Prisma.InputJsonValue);
}
