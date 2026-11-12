import { runWithTenant } from '@hm/database';
import type { Job } from 'bullmq';
import type { Services } from '../core/container.js';
import type { DomainEvent } from '../core/module.js';
import { requestContext } from '../lib/request-context.js';
import type { RealtimeEmitter } from '../realtime/socket.js';
import { QUEUES, type QueueFactory } from './queue.js';

export const OUTBOX_RELAY_JOB = 'outbox-relay';
export const OUTBOX_MAX_ATTEMPTS = 10;
/** Socket.io event name carrying relayed domain events. */
export const REALTIME_EVENT = 'event';

interface OutboxRow {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export interface RelayResult {
  relayed: number;
  failed: number;
}

function realtimeTargetId(payload: unknown, field: 'userId' | 'propertyId'): string | undefined {
  if (payload && typeof payload === 'object' && field in payload) {
    const v = (payload as Record<string, unknown>)[field];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

export function emitDomainEvent(
  services: Services,
  emitter: RealtimeEmitter | undefined,
  e: DomainEvent,
) {
  const target = services.modules.realtimeTarget(e.type);
  if (!target || !emitter) return;
  const message = { id: e.id, type: e.type, payload: e.payload, createdAt: e.createdAt };
  if (target === 'tenant') emitter.emitToTenant(e.tenantId, REALTIME_EVENT, message);
  else if (target === 'user') {
    const uid = realtimeTargetId(e.payload, 'userId');
    if (uid) emitter.emitToUser(e.tenantId, uid, REALTIME_EVENT, message);
  } else {
    const pid = realtimeTargetId(e.payload, 'propertyId');
    if (pid) emitter.emitToProperty(e.tenantId, pid, REALTIME_EVENT, message);
  }
}

/**
 * Outbox relay (cross-tenant, admin client): locks a batch of unprocessed events
 * (FOR UPDATE SKIP LOCKED, safe with several workers), enqueues each into `domain-events`
 * (jobId = event id, so a re-relay after a crash is deduplicated), emits the realtime ones,
 * and marks them processed. Failures increment `attempts` and keep `last_error`.
 */
export async function relayOutbox(
  services: Services,
  queues: QueueFactory,
  opts: { batch?: number; emitter?: RealtimeEmitter | undefined } = {},
): Promise<RelayResult> {
  const batch = opts.batch ?? services.config.OUTBOX_BATCH;
  const emitter = opts.emitter ?? services.realtime;
  const queue = queues.queue(QUEUES.domainEvents);

  return services.admin.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id::text AS id, tenant_id::text AS "tenantId", type, payload, created_at AS "createdAt"
        FROM outbox_events
        WHERE processed_at IS NULL AND attempts < ${OUTBOX_MAX_ATTEMPTS}
        ORDER BY created_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED`;
      const done: string[] = [];
      let failed = 0;
      for (const row of rows) {
        const event: DomainEvent = {
          id: row.id,
          tenantId: row.tenantId,
          type: row.type,
          payload: row.payload,
          createdAt: new Date(row.createdAt).toISOString(),
        };
        try {
          await queue.add(event.type, event, { jobId: event.id });
          emitDomainEvent(services, emitter, event);
          done.push(event.id);
        } catch (err) {
          failed++;
          services.logger.error('outbox relay failed', {
            eventId: event.id,
            type: event.type,
            err,
          });
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              lastError: String((err as Error).message ?? err).slice(0, 1000),
            },
          });
        }
      }
      if (done.length)
        await tx.outboxEvent.updateMany({
          where: { id: { in: done } },
          data: { processedAt: new Date(), attempts: { increment: 1 } },
        });
      return { relayed: done.length, failed };
    },
    { timeout: 30_000 },
  );
}

/** `domain-events` processor: runs module handlers inside runWithTenant(event.tenantId). */
export async function processDomainEvent(services: Services, job: Job): Promise<void> {
  const event = job.data as DomainEvent;
  const handlers = services.modules.events(event.type).filter((e) => e.handler);
  if (!handlers.length) return;
  await requestContext.run({ requestId: `event:${event.id}`, jobId: String(job.id) }, () =>
    runWithTenant(event.tenantId, async () => {
      for (const h of handlers) await h.handler!(event, services);
    }),
  );
}
