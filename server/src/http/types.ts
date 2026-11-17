import type { AccessClaims, TokenScope } from '../lib/jwt.js';
import type { HostKind, ResolvedTenant } from '../core/tenants.js';
import type { UserGrants } from '../core/permissions.js';
import type { Services } from '../core/container.js';

/** API surface of a route: staff (/api/v1/t), portal (/api/v1/portal), admin (/api/v1/admin). */
export type Surface = 't' | 'portal' | 'admin';

export interface AuthContext {
  scope: TokenScope;
  userId: string;
  tenantId?: string;
  sessionId: string;
  permVer: number;
  /** Platform user id when a support agent impersonates the tenant. */
  impersonatedBy?: string;
  /** Second factor verified for this session. */
  mfa: boolean;
  /** Password expired / reset by an admin: only /auth and /legal are usable. */
  mustChangePassword: boolean;
  claims: AccessClaims;
}

/** Platform user loaded by the platform guard on /api/v1/admin. */
export interface PlatformPrincipal {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'FINANCE' | 'SUPPORT' | 'READ_ONLY';
}

export interface ValidatedInput {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      services: Services;
      hostKind?: HostKind;
      /** API surface derived from the path (undefined outside /api/v1/{t,portal,admin}). */
      surface?: Surface;
      /** Tenant resolved from the Host header (server side only). */
      tenant?: ResolvedTenant;
      auth?: AuthContext;
      /** Set by the platform guard for platform tokens. */
      platformUser?: PlatformPrincipal;
      /** Staff grants, loaded lazily by can() and cached per perm_ver. */
      grants?: UserGrants;
      /** Zod-parsed request parts (set by validate()). */
      valid: ValidatedInput;
    }
  }
}

export {};
