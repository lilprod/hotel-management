import {
  requireTenantId,
  type AdminClient,
  type Prisma,
  type TransactionClient,
} from '@hm/database';

/** Core event types. */
export const CORE_EVENTS = {
  entitlementsChanged: 'entitlements.changed',
  subscriptionChanged: 'subscription.changed',
  tenantDomainsChanged: 'tenant.domains.changed',
} as const;

type OutboxWriter = Pick<TransactionClient, 'outboxEvent'>;

/**
 * Writes a domain event to the outbox inside the caller's transaction (tenant from context).
 * The relay job forwards it to BullMQ (`domain-events`) and Socket.io.
 */
export function publishEvent(tx: OutboxWriter, type: string, payload: Prisma.InputJsonValue = {}) {
  return tx.outboxEvent.create({ data: { tenantId: requireTenantId(), type, payload } });
}

/**
 * Platform-plane variant (Super Admin services, admin client): the tenant id comes from the
 * server-side admin operation, never from tenant input.
 */
export function publishPlatformEvent(
  admin: Pick<AdminClient, 'outboxEvent'>,
  tenantId: string,
  type: string,
  payload: Prisma.InputJsonValue = {},
) {
  return admin.outboxEvent.create({ data: { tenantId, type, payload } });
}
