import { getTenantId, runWithTenant } from '@hm/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTITLEMENTS_CHANGED } from '../src/core/entitlements.js';
import { publishEvent } from '../src/core/events.js';
import { defineModule } from '../src/core/module.js';
import {
  defineJob,
  enqueueForTenant,
  processDomainEvent,
  QUEUES,
  QueueFactory,
  registerRepeatable,
  relayOutbox,
  runJob,
} from '../src/jobs/index.js';
import type { RealtimeEmitter } from '../src/realtime/socket.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.js';

const seen: { type: string; tenantId: string | undefined }[] = [];
const sampleJob = defineJob<{ tenantId: string; n: number }>({
  name: 'sample',
  queue: 'test-sample',
  handler: async (data) => ({ ctxTenant: getTenantId(), n: data.n }),
});
const testModule = defineModule({
  key: 'jobtest',
  jobs: [sampleJob],
  events: [
    {
      type: 'room.cleaned',
      realtime: 'property',
      handler: (e) => void seen.push({ type: e.type, tenantId: getTenantId() }),
    },
  ],
});

let env: TestEnv;
let queues: QueueFactory;
let A: TenantFixture;
const emitted: { fn: string; args: unknown[] }[] = [];
const emitter: RealtimeEmitter = {
  emitToTenant: (...args) => void emitted.push({ fn: 'tenant', args }),
  emitToUser: (...args) => void emitted.push({ fn: 'user', args }),
  emitToProperty: (...args) => void emitted.push({ fn: 'property', args }),
  emitToGuest: (...args) => void emitted.push({ fn: 'guest', args }),
};

beforeAll(async () => {
  env = createTestEnv([testModule]);
  queues = new QueueFactory(env.services.config.REDIS_URL, `hmtest${Date.now()}`);
  A = await createTenantFixture(env.services.admin, { label: 'j', features: ['lodging.core'] });
});

afterAll(async () => {
  await queues?.close();
  await env?.close();
});

describe('job context', () => {
  it('enqueues with the context tenant and re-enters runWithTenant when running', async () => {
    const job = await runWithTenant(A.tenantId, () =>
      enqueueForTenant(queues, sampleJob, { n: 3 }),
    );
    expect(job.data).toEqual({ n: 3, tenantId: A.tenantId });
    expect(getTenantId()).toBeUndefined();
    const result = await runJob(sampleJob, job, env.services);
    expect(result).toEqual({ ctxTenant: A.tenantId, n: 3 });
  });

  it('refuses a tenant job without tenantId', () => {
    expect(() =>
      runJob(sampleJob, { id: '1', name: 'sample', data: { n: 1 } } as never, env.services),
    ).toThrow(/requires data.tenantId/);
  });

  it('registers repeatable jobs idempotently with a job scheduler', async () => {
    const q = queues.queue('test-repeat');
    await registerRepeatable(
      q,
      'every-minute',
      { pattern: '0 * * * *', tz: 'Africa/Lome' },
      { name: 'tick' },
    );
    await registerRepeatable(
      q,
      'every-minute',
      { pattern: '0 * * * *', tz: 'Africa/Lome' },
      { name: 'tick' },
    );
    const schedulers = await q.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.pattern).toBe('0 * * * *');
  });
});

describe('outbox relay', () => {
  it('relays outbox events to BullMQ + Socket.io, marks them processed, handlers run in tenant context', async () => {
    const { db, admin, entitlements } = env.services;
    await runWithTenant(A.tenantId, () =>
      db.$transaction(async (tx) => {
        await publishEvent(tx, 'room.cleaned', { propertyId: A.propertyId, roomId: 'r1' });
        await publishEvent(tx, ENTITLEMENTS_CHANGED, {});
      }),
    );
    // Prime the entitlements cache, then grant `spa` directly: cache is stale until the event.
    expect((await entitlements.resolve(A.tenantId)).features).not.toContain('spa');
    await admin.planFeature.create({ data: { planId: A.planId, featureKey: 'spa' } });
    expect((await entitlements.resolve(A.tenantId)).features).not.toContain('spa');

    const result = await relayOutbox(env.services, queues, { emitter });
    expect(result.relayed).toBeGreaterThanOrEqual(2);
    const pending = await admin.outboxEvent.count({
      where: { tenantId: A.tenantId, processedAt: null },
    });
    expect(pending).toBe(0);

    expect(emitted).toEqual([
      expect.objectContaining({
        fn: 'property',
        args: [
          A.tenantId,
          A.propertyId,
          'event',
          expect.objectContaining({ type: 'room.cleaned' }),
        ],
      }),
    ]);

    const jobs = await queues
      .queue(QUEUES.domainEvents)
      .getJobs(['waiting', 'delayed', 'prioritized']);
    const mine = jobs.filter((j) => (j.data as { tenantId: string }).tenantId === A.tenantId);
    expect(mine.map((j) => j.name).sort()).toEqual([ENTITLEMENTS_CHANGED, 'room.cleaned']);
    for (const job of mine) await processDomainEvent(env.services, job);

    expect(seen).toEqual([{ type: 'room.cleaned', tenantId: A.tenantId }]);
    expect((await entitlements.resolve(A.tenantId)).features).toContain('spa');

    // Re-running the relay does not duplicate anything.
    const again = await relayOutbox(env.services, queues, { emitter });
    expect(again.relayed).toBe(0);
  });
});
