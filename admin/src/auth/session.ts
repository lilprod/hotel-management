import { create } from 'zustand';

import { createApiClient, useSessionStore } from '@hm/ui';
import type { TokenResponse } from '@hm/ui';

export const PLATFORM_ROLES = ['SUPER_ADMIN', 'FINANCE', 'SUPPORT', 'READ_ONLY'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** `GET /api/v1/admin/auth/me`. */
export interface PlatformMe {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

export interface AuthResult extends Partial<TokenResponse> {
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  challengeToken?: string;
  backupCodes?: string[];
}

const READS = [
  'tenants',
  'plans',
  'invoices',
  'payments',
  'reports',
  'announcements',
  'support',
  'impersonations',
  'audit',
].map((m) => `platform.${m}.read`);

/**
 * Navigation entitlements derived from the platform role. This only drives what the UI shows:
 * every `/api/v1/admin/*` route enforces the role server side (platformRole guard).
 */
export function permissionsForRole(role: PlatformRole): string[] {
  switch (role) {
    case 'SUPER_ADMIN':
      return ['*'];
    case 'SUPPORT':
      return [
        'platform.tenants.read',
        'platform.support.read',
        'platform.impersonations.read',
        'platform.impersonations.start',
        'platform.audit.read',
      ];
    case 'FINANCE':
      return [
        'platform.tenants.read',
        'platform.plans.read',
        'platform.invoices.read',
        'platform.payments.read',
        'platform.payments.review',
        'platform.reports.read',
        'platform.audit.read',
      ];
    default:
      return READS;
  }
}

interface MeState {
  me: PlatformMe | null;
}
export const useMeStore = create<MeState>()(() => ({ me: null }));

export function endSession(): void {
  apiClient.setAccessToken(null, null);
  useMeStore.setState({ me: null });
  useSessionStore.getState().clearSession();
}

export const apiClient = createApiClient({
  baseUrl: '/api/v1/admin',
  refreshPath: '/auth/refresh',
  onAuthFailure: () => endSession(),
});

export function applyMe(me: PlatformMe): void {
  useMeStore.setState({ me });
  useSessionStore.getState().setSession({
    status: 'authenticated',
    user: { name: me.name, email: me.email },
    features: ['*'],
    permissions: permissionsForRole(me.role),
    mustChangePassword: false,
    legalBlocked: false,
    impersonation: null,
  });
}

export async function loadMe(): Promise<PlatformMe> {
  const me = await apiClient.get<PlatformMe>('/auth/me');
  applyMe(me);
  return me;
}

export function adoptTokens(r: Partial<TokenResponse>): boolean {
  if (!r.accessToken) return false;
  apiClient.setAccessToken(r.accessToken, r.csrfToken ?? null);
  return true;
}

let booting: Promise<void> | null = null;

/** First load: silent refresh from the cookie, then `/auth/me`. */
export function bootstrapSession(): Promise<void> {
  booting ??= (async () => {
    try {
      if (!(await apiClient.refresh())) {
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
