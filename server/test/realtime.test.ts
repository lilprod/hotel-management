import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRealtime, rooms, type Realtime } from '../src/realtime/socket.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.js';

let env: TestEnv;
let http: HttpServer;
let realtime: Realtime;
let emitterEnv: TestEnv;
let emitOnly: Realtime;
let url: string;
let A: TenantFixture;
let B: TenantFixture;
const sockets: Socket[] = [];

function open(host: string, token?: string): Socket {
  const s = connect(url, {
    transports: ['websocket'],
    extraHeaders: { host },
    auth: token ? { token } : {},
    reconnection: false,
    forceNew: true,
  });
  sockets.push(s);
  return s;
}

function connected(s: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
}

function refused(s: Socket): Promise<{ code?: string }> {
  return new Promise((resolve, reject) => {
    s.once('connect', () => reject(new Error('should not connect')));
    s.once('connect_error', (err: Error & { data?: { code?: string } }) => resolve(err.data ?? {}));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  env = createTestEnv();
  A = await createTenantFixture(env.services.admin, { label: 'ra' });
  B = await createTenantFixture(env.services.admin, { label: 'rb' });
  http = createServer();
  realtime = createRealtime(env.services, http);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  // Second, emit-only instance (as in the worker): broadcasts go through the Redis adapter.
  emitterEnv = createTestEnv();
  emitOnly = createRealtime(emitterEnv.services);
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await emitOnly?.close();
  await realtime?.close();
  await emitterEnv?.close();
  await env?.close();
});

describe('Socket.io isolation', () => {
  it('refuses a connection without token, with a token of another tenant, or on an unknown host', async () => {
    expect((await refused(open(A.host))).code).toBe('UNAUTHENTICATED');
    const tokenB = await mintToken(env.services.config, { sub: B.userId, tid: B.tenantId });
    expect((await refused(open(A.host, tokenB))).code).toBe('TENANT_MISMATCH');
    expect((await refused(open('nope.hm.test', tokenB))).code).toBe('NOT_FOUND');
  });

  it('a tenant A client never receives tenant B emissions', async () => {
    const tokenA = await mintToken(env.services.config, { sub: A.userId, tid: A.tenantId });
    const tokenB = await mintToken(env.services.config, { sub: B.userId, tid: B.tenantId });
    const sa = open(A.host, tokenA);
    const sb = open(B.host, tokenB);
    await Promise.all([connected(sa), connected(sb)]);

    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    sa.on('ping:test', (d: unknown) => gotA.push(d));
    sb.on('ping:test', (d: unknown) => gotB.push(d));
    // Client-side attempts to reach another room are ignored: rooms are server-side only.
    sa.emit('join', rooms.tenant(B.tenantId));

    const { emitter } = emitOnly;
    emitter.emitToTenant(B.tenantId, 'ping:test', { to: 'B-tenant' });
    emitter.emitToUser(B.tenantId, B.userId, 'ping:test', { to: 'B-user' });
    emitter.emitToProperty(B.tenantId, B.propertyId, 'ping:test', { to: 'B-property' });
    emitter.emitToTenant(A.tenantId, 'ping:test', { to: 'A-tenant' });
    emitter.emitToUser(A.tenantId, A.userId, 'ping:test', { to: 'A-user' });

    for (let i = 0; i < 50 && (gotA.length < 2 || gotB.length < 3); i++) await sleep(20);
    await sleep(100);
    expect(gotA).toEqual([{ to: 'A-tenant' }, { to: 'A-user' }]);
    expect(gotB).toEqual([{ to: 'B-tenant' }, { to: 'B-user' }, { to: 'B-property' }]);
  });

  it('portal clients do not join the staff room', async () => {
    const portal = await mintToken(env.services.config, {
      sub: crypto.randomUUID(),
      tid: A.tenantId,
      scope: 'portal',
    });
    const s = open(A.host, portal);
    await connected(s);
    const got: unknown[] = [];
    s.on('ping:test', (d: unknown) => got.push(d));
    emitOnly.emitter.emitToTenant(A.tenantId, 'ping:test', { staffOnly: true });
    await sleep(200);
    expect(got).toEqual([]);
  });
});
