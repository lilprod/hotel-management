import { create } from 'zustand';

import { createApiClient, useSessionStore } from '@hm/ui/core';
import type { TokenResponse } from '@hm/ui/core';

/** `GET /api/v1/portal/auth/me`. */
export interface PortalMe {
  account: {
    id: string;
    email: string;
    locale: string;
    emailVerified: boolean;
    lastLoginAt: string | null;
  };
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  };
  tenant: { id: string; slug: string; name: string };
}

export const useMeStore = create<{ me: PortalMe | null }>()(() => ({ me: null }));

export function endSession(): void {
  apiClient.setAccessToken(null, null);
  useMeStore.setState({ me: null });
  useSessionStore.getState().clearSession();
}

/** Shared API client (access token in memory, single-flight refresh via the guest cookie). */
export const apiClient = createApiClient({
  baseUrl: '/api/v1/portal',
  refreshPath: '/auth/refresh',
  onAuthFailure: () => endSession(),
});

export function applyMe(me: PortalMe): void {
  useMeStore.setState({ me });
  useSessionStore.getState().setSession({
    status: 'authenticated',
    user: { name: `${me.guest.firstName} ${me.guest.lastName}`.trim(), email: me.account.email },
    features: ['*'],
    permissions: [],
    mustChangePassword: false,
    legalBlocked: false,
    impersonation: null,
  });
}

export async function loadMe(): Promise<PortalMe> {
  const me = await apiClient.get<PortalMe>('/auth/me');
  applyMe(me);
  return me;
}

export function adoptTokens(r: Partial<TokenResponse>): boolean {
  if (!r.accessToken) return false;
  apiClient.setAccessToken(r.accessToken, r.csrfToken ?? null);
  return true;
}

let booting: Promise<void> | null = null;

/** First load: silent refresh from the cookie, then `/auth/me` (anonymous when there is no session). */
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
