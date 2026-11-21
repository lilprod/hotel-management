import { runWithTenant, type AppClient } from '@hm/database';
import type { Request } from 'express';
import type { Services } from '../../core/container.js';
import { QueueFactory } from '../../jobs/queue.js';
import { recordAudit, type AuditEntry } from '../../middleware/audit.js';
import { writeTenantAudit } from '../audit/service.js';
import { notify, type NotifyInput, type NotifyResult } from '../notifications/service.js';
import { withCtx, type Ctx } from '../property/common.js';

/** Service context of the reservation engine: request or job (system actor). */
export interface RCtx extends Ctx {
  /** Staff user, null for jobs. */
  actorId: string | null;
  /** Records an audit entry (after the response for HTTP, immediately for jobs). */
  audit(entry: AuditEntry): Promise<void>;
}

export async function withRCtx<T>(req: Request, fn: (ctx: RCtx) => Promise<T>): Promise<T> {
  return withCtx(req, (ctx) =>
    fn({
      ...ctx,
      actorId: ctx.userId,
      audit: (e) => {
        recordAudit(req, e);
        return Promise.resolve();
      },
    }),
  );
}

/** Context for jobs and event handlers: every permission, no user, immediate audit. */
export function systemCtx(services: Services, tenantId: string): RCtx {
  return {
    services,
    db: services.db as AppClient,
    tenantId,
    userId: '',
    actorId: null,
    grants: {
      userId: '',
      tenantId,
      name: 'system',
      email: '',
      permissions: ['*'],
      propertyIds: [],
    },
    audit: (e) => writeTenantAudit(services, { ...e, tenantId, userId: null }),
  };
}

export function runSystem<T>(
  services: Services,
  tenantId: string,
  fn: (ctx: RCtx) => Promise<T>,
): Promise<T> {
  return runWithTenant(tenantId, () => fn(systemCtx(services, tenantId)));
}

// ───────────────────────────── clock (test seam) ─────────────────────────────

let clock: () => Date = () => new Date();
export const now = (): Date => clock();
/** Test seam: fake clock for option expiry, offers and reminders. */
export function setReservationsClock(fn: (() => Date) | null): void {
  clock = fn ?? (() => new Date());
}

// ───────────────────────────── notifications seam ─────────────────────────────

export type GuestNotifier = (services: Services, input: NotifyInput) => Promise<NotifyResult[]>;

const queues = new WeakMap<Services, QueueFactory>();
export function queuesOf(services: Services): QueueFactory {
  let q = queues.get(services);
  if (!q) {
    q = new QueueFactory(services.config.REDIS_URL);
    queues.set(services, q);
  }
  return q;
}

/** Closes the queue factory opened for `services` (tests, graceful shutdown). */
export async function closeReservationQueues(services: Services): Promise<void> {
  const q = queues.get(services);
  queues.delete(services);
  await q?.close();
}

const defaultNotifier: GuestNotifier = (services, input) =>
  notify(services, queuesOf(services), input);
let notifier: GuestNotifier = defaultNotifier;

/** Test seam: captures guest notifications (confirmation, reminders, waitlist offers). */
export function overrideGuestNotifier(fn: GuestNotifier | null): void {
  notifier = fn ?? defaultNotifier;
}
export const sendGuestNotice = (services: Services, input: NotifyInput) =>
  notifier(services, input);
