import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import type { Services } from '../core/container.js';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { createRedis, type Redis } from '../lib/redis.js';

/** Room names (doc 03 §4). Joined server side only; clients never choose a room. */
export const rooms = {
  /** Staff of the tenant. */
  tenant: (tid: string) => `t:${tid}`,
  user: (tid: string, uid: string) => `t:${tid}:u:${uid}`,
  property: (tid: string, pid: string) => `t:${tid}:p:${pid}`,
  /** Portal guest account (never joins the staff room). */
  guest: (tid: string, gid: string) => `t:${tid}:g:${gid}`,
} as const;

export interface RealtimeEmitter {
  emitToTenant(tenantId: string, event: string, data: unknown): void;
  emitToUser(tenantId: string, userId: string, event: string, data: unknown): void;
  emitToProperty(tenantId: string, propertyId: string, event: string, data: unknown): void;
  emitToGuest(tenantId: string, guestAccountId: string, event: string, data: unknown): void;
}

export function createIoEmitter(io: Server): RealtimeEmitter {
  return {
    emitToTenant: (tid, event, data) => void io.to(rooms.tenant(tid)).emit(event, data),
    emitToUser: (tid, uid, event, data) => void io.to(rooms.user(tid, uid)).emit(event, data),
    emitToProperty: (tid, pid, event, data) =>
      void io.to(rooms.property(tid, pid)).emit(event, data),
    emitToGuest: (tid, gid, event, data) => void io.to(rooms.guest(tid, gid)).emit(event, data),
  };
}

export interface SocketData {
  tenantId: string;
  userId: string;
  scope: 'staff' | 'portal';
  rooms: string[];
}

export interface Realtime {
  io: Server;
  emitter: RealtimeEmitter;
  close(): Promise<void>;
}

function handshakeToken(socket: Socket): string | undefined {
  const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');
  const header = socket.handshake.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

function socketError(err: AppError): Error & { data?: unknown } {
  return Object.assign(new Error(err.message), { data: { code: err.code, status: err.status } });
}

/**
 * Socket.io with the Redis adapter (multi-instance fan-out). Handshake: tenant from the Host
 * header, access token verified, `tid` must match the host's tenant, staff user must exist in
 * that tenant (RLS lookup). Rooms are joined here and nowhere else.
 * Without `httpServer` the instance is emit-only (used by the worker for outbox emissions).
 */
export function createRealtime(services: Services, httpServer?: HttpServer): Realtime {
  const pub: Redis = createRedis(services.config.REDIS_URL);
  const sub: Redis = pub.duplicate();
  const io = new Server<
    Record<string, never>,
    Record<string, (...args: unknown[]) => void>,
    Record<string, never>,
    SocketData
  >({
    adapter: createAdapter(pub, sub, { key: 'hm:sio' }),
    serveClient: false,
    cors: {
      credentials: true,
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (services.config.CORS_ORIGINS.includes(origin.toLowerCase())) return cb(null, true);
        services.tenants.isTenantOrigin(origin).then((ok) => cb(null, ok), cb);
      },
    },
  });

  io.use((socket, next) => {
    (async () => {
      const tenant = await services.tenants.resolveHost(socket.handshake.headers.host ?? '');
      if (!tenant) throw new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });
      const token = handshakeToken(socket);
      if (!token) throw new AppError('UNAUTHENTICATED');
      const claims = await verifyAccessToken(token, {
        secret: services.config.JWT_ACCESS_SECRET,
        issuer: services.config.JWT_ISSUER,
        audience: services.config.JWT_AUDIENCE,
      });
      if (claims.scope === 'platform')
        throw new AppError('FORBIDDEN', 'Platform tokens cannot connect');
      if (claims.tid !== tenant.id) throw new AppError('TENANT_MISMATCH');
      if (await services.revocations.isRevoked(claims.sid)) throw new AppError('UNAUTHENTICATED');

      const joined: string[] = [];
      if (claims.scope === 'staff') {
        const grants = await services.permissions.load(tenant.id, claims.sub, claims.perm_ver);
        if (!grants) throw new AppError('UNAUTHENTICATED', 'User not found or inactive');
        joined.push(rooms.tenant(tenant.id), rooms.user(tenant.id, claims.sub));
        for (const pid of grants.propertyIds) joined.push(rooms.property(tenant.id, pid));
      } else {
        joined.push(rooms.guest(tenant.id, claims.sub));
      }
      socket.data = { tenantId: tenant.id, userId: claims.sub, scope: claims.scope, rooms: joined };
    })().then(
      () => next(),
      (err: unknown) =>
        next(
          err instanceof AppError ? socketError(err) : socketError(new AppError('INTERNAL_ERROR')),
        ),
    );
  });

  io.on('connection', (socket) => {
    void socket.join(socket.data.rooms);
  });

  if (httpServer) io.attach(httpServer);

  return {
    io,
    emitter: createIoEmitter(io),
    async close() {
      // Attached: closes sockets, adapters and the HTTP server. Emit-only: no engine to close.
      if (httpServer) await io.close();
      else await io.of('/').adapter.close();
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
