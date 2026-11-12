import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request (or per-job) context used by the logger.
 * The tenant RLS context itself lives in @hm/database (runWithTenant).
 */
export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  jobId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}
