import { runWithTenant, type AppClient } from '@hm/database';
import type { JsonCache } from '../lib/redis.js';

export type MfaMode = 'OFF' | 'OPTIONAL' | 'REQUIRED_FOR_ROLES' | 'REQUIRED_ALL';

/** Effective security policy of a tenant (doc 01 TN-12…TN-18), defaults when no row exists. */
export interface EffectivePolicy {
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

/** Same defaults as the `security_policies` columns. */
export const DEFAULT_POLICY: EffectivePolicy = Object.freeze({
  pwdMinLength: 10,
  pwdRequireClasses: 3,
  pwdExpiryDays: null,
  pwdHistory: 0,
  mfaMode: 'OPTIONAL',
  mfaRoles: [],
  sessionIdleMinutes: 30,
  maxSessions: null,
  lockoutThreshold: 5,
  lockoutMinutes: 15,
  ipAllowlist: [],
  allowImpersonation: false,
}) as EffectivePolicy;

const key = (tenantId: string) => `hm:secpol:${tenantId}`;

/** Reads `security_policies` through the RLS client, cached in Redis (invalidated on PUT). */
export class SecurityPolicyService {
  constructor(
    private readonly db: AppClient,
    private readonly cache: JsonCache,
    private readonly ttlSeconds = 300,
  ) {}

  get(tenantId: string): Promise<EffectivePolicy> {
    return this.cache.wrap(key(tenantId), this.ttlSeconds, () => this.fetch(tenantId));
  }

  async fetch(tenantId: string): Promise<EffectivePolicy> {
    const row = await runWithTenant(tenantId, () =>
      this.db.securityPolicy.findUnique({ where: { tenantId } }),
    );
    if (!row) return { ...DEFAULT_POLICY };
    return {
      pwdMinLength: row.pwdMinLength,
      pwdRequireClasses: row.pwdRequireClasses,
      pwdExpiryDays: row.pwdExpiryDays,
      pwdHistory: row.pwdHistory,
      mfaMode: row.mfaMode,
      mfaRoles: row.mfaRoles,
      sessionIdleMinutes: row.sessionIdleMinutes,
      maxSessions: row.maxSessions,
      lockoutThreshold: row.lockoutThreshold,
      lockoutMinutes: row.lockoutMinutes,
      ipAllowlist: row.ipAllowlist,
      allowImpersonation: row.allowImpersonation,
    };
  }

  async invalidate(tenantId: string): Promise<void> {
    await this.cache.del(key(tenantId));
  }
}
