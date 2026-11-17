import { create } from 'zustand';

import { createApiClient, useSessionStore } from '@hm/ui';
import type { ImpersonationInfo, TokenResponse } from '@hm/ui';

/** Shape of `GET /api/v1/t/auth/me` (server/src/modules/auth/schemas.ts). */
export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    status: string;
    mfaEnabled: boolean;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
  };
  tenant: { id: string; slug: string; name: string };
  properties: { id: string; name: string }[];
  permissions: string[];
  allProperties: boolean;
  permVer: number;
  subscription: { status: string };
  entitlements: {
    planCode: string | null;
    features: string[];
    quotas: Record<string, number | null>;
  };
  session: { id: string; idleMinutes: number; mfa: boolean };
  impersonation: { by: string } | null;
  legal: {
    blocked: boolean;
    canAccept: boolean;
    pending: { id: string; type: string; version: string }[];
  };
}

/** Response of login / mfa-verify / activate / password change. */
export interface AuthResult extends Partial<TokenResponse> {
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  challengeToken?: string;
  methods?: ('totp' | 'backup_code')[];
  backupCodes?: string[];
}

interface MeState {
  me: Me | null;
}
/** Full `/auth/me` payload (properties, tenant, 2FA state…); entitlements live in `useSessionStore`. */
export const useMeStore = create<MeState>()(() => ({ me: null }));

/** Details of a support session, handed over by the Super Admin app in the URL fragment. */
let handoff: ImpersonationInfo | null = null;

/** Clears the in-memory session; route guards then redirect to /login. */
export function endSession(): void {
  apiClient.setAccessToken(null, null);
  handoff = null;
  useMeStore.setState({ me: null });
  useSessionStore.getState().clearSession();
}

export const apiClient = createApiClient({
  baseUrl: '/api/v1/t',
  onAuthFailure: () => endSession(),
});

export function applyMe(me: Me): void {
  useMeStore.setState({ me });
  const impersonation: ImpersonationInfo | null = me.impersonation
    ? { ...me.impersonation, ...(handoff ?? {}), by: me.impersonation.by }
    : null;
  useSessionStore.getState().setSession({
    status: 'authenticated',
    user: { name: me.user.name, email: me.user.email },
    features: me.entitlements.features,
    permissions: me.permissions,
    mustChangePassword: me.user.mustChangePassword,
    legalBlocked: me.legal.blocked,
    impersonation,
  });
}

/** Loads `/auth/me` into the stores; ends the session when it cannot be read. */
export async function loadMe(): Promise<Me> {
  const me = await apiClient.get<Me>('/auth/me');
  applyMe(me);
  return me;
}

/** Stores the tokens of an authentication response (access token in memory only). */
export function adoptTokens(r: Partial<TokenResponse>): boolean {
  if (!r.accessToken) return false;
  apiClient.setAccessToken(r.accessToken, r.csrfToken ?? null);
  return true;
}

/**
 * Support hand-off: the Super Admin app opens `/#impersonate=<base64url JSON>` with
 * `{ accessToken, reason, expiresAt, by, byName }`. Fragments never reach any server, and the
 * token (non refreshable, ≤ 30 min) stays in memory.
 */
export function consumeImpersonationHandoff(hash: string = window.location.hash): boolean {
  const m = /^#impersonate=(.+)$/.exec(hash);
  if (!m?.[1]) return false;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as {
      accessToken?: string;
      reason?: string;
      expiresAt?: string;
      by?: string;
      byName?: string;
    };
    if (!data.accessToken) return false;
    apiClient.setAccessToken(data.accessToken, null);
    handoff = {
      by: data.by ?? '',
      ...(data.byName ? { byName: data.byName } : {}),
      ...(data.reason ? { reason: data.reason } : {}),
      ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
    };
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  } catch {
    return false;
  }
}

let booting: Promise<void> | null = null;

/** First load: support hand-off or silent refresh from the cookie, then `/auth/me`. */
export function bootstrapSession(): Promise<void> {
  booting ??= (async () => {
    try {
      const handed = consumeImpersonationHandoff();
      if (!handed && !(await apiClient.refresh())) {
        useSessionStore.getState().clearSession();
        return;
      }
      await loadMe();
    } catch {
      useSessionStore.getState().clearSession();
    } finally {
      booting = null;
    }
  })();
  return booting;
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/logout', undefined, { skipAuth: true });
  } catch {
    // the local session is dropped anyway
  }
  endSession();
}
