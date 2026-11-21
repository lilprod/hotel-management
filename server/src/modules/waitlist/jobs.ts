import type { Services } from '../../core/container.js';
import type { DomainEvent } from '../../core/module.js';
import { defineJob, enqueueForTenant } from '../../jobs/context.js';
import { queuesOf, systemCtx } from '../reservations/context.js';
import type { InventoryRelease } from '../reservations/events.js';
import { matchWaitlist } from './service.js';

export const RESERVATIONS_QUEUE = 'reservations';

export interface WaitlistMatchData {
  tenantId: string;
  propertyId: string;
  /** ISO instant (tests / replays); defaults to the clock. */
  now?: string;
}

/** `waitlist-match`: offers released inventory to the first compatible waitlisted guests. */
export const waitlistMatchJob = defineJob<WaitlistMatchData>({
  name: 'waitlist-match',
  queue: RESERVATIONS_QUEUE,
  options: { attempts: 3 },
  handler: (data, { services, tenantId }) =>
    matchWaitlist(
      systemCtx(services, tenantId!),
      data.propertyId,
      ...(data.now ? [new Date(data.now)] : []),
    ),
});

/** `inventory.released` handler (domain-events worker, tenant context set). */
export async function onInventoryReleased(event: DomainEvent, services: Services): Promise<void> {
  const payload = event.payload as Partial<InventoryRelease>;
  if (typeof payload.propertyId !== 'string') return;
  await enqueueForTenant(
    queuesOf(services),
    waitlistMatchJob,
    { propertyId: payload.propertyId },
    // A re-delivered event enqueues the match once (job id per event).
    { jobId: `waitlist-match-${event.id}` },
  );
}
