import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeReservationQueues } from '../src/modules/reservations/index.js';
import { QueueFactory, relayOutbox } from '../src/jobs/index.js';
import { createRealtime, type Realtime } from '../src/realtime/socket.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import { seedLodging, type LodgingSeed } from './helpers/lodging-seed.js';

/**
 * End to end (real PostgreSQL + Redis): API write -> outbox row -> relay job -> Socket.io room of
 * the property (joined server side) -> `event` envelope of type `planning.changed`.
 */
let env: TestEnv;
let workerEnv: TestEnv;
let app: Express;
let http: HttpServer;
let realtime: Realtime;
let worker: Realtime;
let A: TenantFixture;
let S: LodgingSeed;
let tok: string;
let socket: Socket;
const received: { type: string; payload: Record<string, unknown> }[] = [];

const api = (method: 'get' | 'post', path: string) =>
  request(app)
    [method](`/api/v1/t${path}`)
    .set('Host', A.host)
    .set('Authorization', `Bearer ${tok}`);

const outbox = (type: string) =>
  env.services.admin.outboxEvent.findMany({ where: { tenantId: A.tenantId, type } });

/** What the worker does on every tick: relay the outbox, emitting through the Redis adapter. */
async function relayAll() {
  const queues = new QueueFactory(env.services.config.REDIS_URL);
  try {
    for (let i = 0; i < 20; i++)
      if ((await relayOutbox(env.services, queues, { emitter: worker.emitter })).relayed === 0)
        break;
  } finally {
    await queues.close();
  }
}

async function waitFor(action: string, reservationId: string) {
  for (let i = 0; i < 100; i++) {
    const hit = received.find(
      (m) =>
        m.type === 'planning.changed' &&
        m.payload.action === action &&
        m.payload.reservationId === reservationId,
    );
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 30));
  }
  return undefined;
}

beforeAll(async () => {
  env = createTestEnv([], {});
  ({ app } = createApp(env.services));
  const { admin, config } = env.services;
  A = await createTenantFixture(admin, { label: 'rt', features: ['lodging.core'] });
  S = await seedLodging(admin, A.tenantId, A.propertyId);
  tok = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  http = createServer();
  realtime = createRealtime(env.services, http);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  // Emit-only instance, as in the worker process: broadcasts travel through the Redis adapter.
  workerEnv = createTestEnv([], {});
  worker = createRealtime(workerEnv.services);
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  socket = connect(url, {
    transports: ['websocket'],
    extraHeaders: { host: A.host },
    auth: { token: tok },
    reconnection: false,
    forceNew: true,
  });
  socket.on('event', (m: { type: string; payload: Record<string, unknown> }) => received.push(m));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
});

afterAll(async () => {
  socket?.disconnect();
  await worker?.close();
  await realtime?.close();
  await workerEnv?.close();
  if (env) await closeReservationQueues(env.services);
  await env?.close();
});

describe('planning.changed end to end', () => {
  it('assign, move and cancel write the outbox event and reach the property room', async () => {
    const created = await api('post', '/reservations').send({
      propertyId: A.propertyId,
      arrival: '2027-03-01',
      departure: '2027-03-04',
      guest: { firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com' },
      rooms: [{ roomTypeId: S.std, ratePlanId: S.bar, adults: 2 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.reservation.id as string;
    const line = created.body.reservation.rooms[0].id as string;
    await relayAll(); // flush the creation event

    const steps: [string, () => Promise<request.Response>][] = [
      [
        'assign',
        () =>
          api('post', `/reservations/${id}/rooms/${line}/assign`).send({ roomId: S.rooms['101'] }),
      ],
      [
        'move',
        () =>
          api('post', `/reservations/${id}/rooms/${line}/move`).send({ roomId: S.rooms['102'] }),
      ],
      [
        'cancel',
        () => api('post', `/reservations/${id}/cancel`).send({ reasonCode: 'GUEST_REQUEST' }),
      ],
    ];
    for (const [action, run] of steps) {
      const res = await run();
      expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
      // 1. written in the outbox in the same transaction as the change
      const rows = (await outbox('planning.changed')).filter(
        (e) =>
          (e.payload as { reservationId: string; action: string }).reservationId === id &&
          (e.payload as { action: string }).action === action,
      );
      expect(rows, `${action} outbox`).toHaveLength(1);
      expect(rows[0]!.processedAt).toBeNull();
      // 2. relayed by the job, 3. received by the socket of the property room
      await relayAll();
      const msg = await waitFor(action, id);
      expect(msg, `${action} received`).toBeDefined();
      expect(msg!.payload).toMatchObject({ propertyId: A.propertyId, reservationId: id, action });
      expect((await outbox('planning.changed')).every((e) => e.processedAt !== null)).toBe(true);
    }
  });
});
