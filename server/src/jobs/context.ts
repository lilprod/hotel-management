import { requireTenantId, runWithTenant } from '@hm/database';
import type { Job, JobsOptions } from 'bullmq';
import type { Services } from '../core/container.js';
import { requestContext } from '../lib/request-context.js';
import type { QueueFactory } from './queue.js';

/** Every tenant-scoped job carries the tenant id it was enqueued for. */
export interface TenantJobData {
  tenantId: string;
}

export interface JobContext {
  job: Job;
  services: Services;
  /** Present for tenant-scoped jobs; the handler already runs inside runWithTenant. */
  tenantId?: string;
}

export interface JobDefinition<D = unknown> {
  /** Job name (unique in its queue). */
  name: string;
  queue: string;
  /** Tenant jobs must carry `tenantId` and run inside runWithTenant (RLS context). */
  tenantScoped: boolean;
  handler: (data: D, ctx: JobContext) => Promise<unknown>;
  options?: JobsOptions;
}

/** Any job definition, whatever its data type (handlers are contravariant in their data). */
export type AnyJobDefinition = JobDefinition<never>;

export function defineJob<D extends TenantJobData>(
  def: Omit<JobDefinition<D>, 'tenantScoped'> & { tenantScoped?: true },
): JobDefinition<D>;
export function defineJob<D>(
  def: Omit<JobDefinition<D>, 'tenantScoped'> & { tenantScoped: false },
): JobDefinition<D>;
export function defineJob<D>(
  def: Omit<JobDefinition<D>, 'tenantScoped'> & { tenantScoped?: boolean },
) {
  return Object.freeze({ ...def, tenantScoped: def.tenantScoped ?? true }) as JobDefinition<D>;
}

/**
 * Runs a job handler with its context: request context (job id for logs) and, for tenant
 * jobs, runWithTenant(job.data.tenantId) so the app client is RLS-scoped again.
 */
export function runJob<D>(def: JobDefinition<D>, job: Job, services: Services): Promise<unknown> {
  const data = job.data as D;
  return requestContext.run(
    { requestId: `job:${job.id ?? job.name}`, jobId: String(job.id) },
    () => {
      if (!def.tenantScoped) return def.handler(data, { job, services });
      const tenantId = (data as Partial<TenantJobData> | undefined)?.tenantId;
      if (!tenantId) throw new Error(`Job ${def.name} requires data.tenantId`);
      return runWithTenant(tenantId, () => def.handler(data, { job, services, tenantId }));
    },
  );
}

/**
 * Enqueues a tenant job for the tenant of the current context (never a client-supplied id).
 */
export function enqueueForTenant<D extends TenantJobData>(
  queues: QueueFactory,
  def: JobDefinition<D>,
  data: Omit<D, 'tenantId'>,
  opts: JobsOptions = {},
) {
  const tenantId = requireTenantId();
  return queues.queue(def.queue).add(def.name, { ...data, tenantId }, { ...def.options, ...opts });
}

/** Enqueues a platform (non tenant-scoped) job. */
export function enqueue<D>(
  queues: QueueFactory,
  def: JobDefinition<D>,
  data: D,
  opts: JobsOptions = {},
) {
  return queues.queue(def.queue).add(def.name, data, { ...def.options, ...opts });
}
