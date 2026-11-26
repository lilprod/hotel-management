/** Types of the `/api/v1/t/iam` and `/audit` payloads (server/src/modules/{iam,audit}). */
export type UserStatus = 'INVITED' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';

export interface IamUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  status: UserStatus;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { id: string; name: string; isSystem: boolean }[];
  propertyIds: string[];
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

export interface PermissionCatalog {
  modules: { module: string; permissions: string[] }[];
}

export type MfaMode = 'OFF' | 'OPTIONAL' | 'REQUIRED_FOR_ROLES' | 'REQUIRED_ALL';

export interface SecurityPolicy {
  pwdMinLength: number;
  pwdRequireClasses: number;
  pwdExpiryDays: number | null;
  pwdHistory: number;
  mfaMode: MfaMode;
  mfaRoles: string[];
  sessionIdleMinutes: number;
  maxSessions: number | null;
  lockoutThreshold: number;
  lockoutMinutes: number;
  ipAllowlist: string[];
  allowImpersonation: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  userId: string | null;
  impersonatedBy?: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ImpersonationEvent {
  id: string;
  action: string;
  at: string;
  platformUserId: string | null;
  userId: string | null;
  sessionId: string | null;
  details: { reason?: string; platformUser?: { name?: string; email?: string } } | null;
}

/** Expands wildcards (`*`, `module.*`) into concrete catalog permissions. */
export function expandPermissions(granted: readonly string[], all: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of all) {
    if (
      granted.some(
        (g) =>
          g === '*' ||
          g === p ||
          (g.endsWith('.*') && (p === g.slice(0, -2) || p.startsWith(g.slice(0, -1)))),
      )
    ) {
      out.add(p);
    }
  }
  return out;
}
