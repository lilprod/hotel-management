import type { Prisma, TransactionClient } from '@hm/database';
import { publishEvent } from '../../core/events.js';

export const NIGHT_AUDIT_EVENTS = {
  /** Step progress of a running audit (property room, realtime). */
  progress: 'night_audit.progress',
  completed: 'night_audit.completed',
  failed: 'night_audit.failed',
} as const;

export function publishNightAudit(
  tx: Pick<TransactionClient, 'outboxEvent'>,
  type: string,
  payload: Record<string, unknown>,
) {
  return publishEvent(tx, type, payload as Prisma.InputJsonValue);
}
