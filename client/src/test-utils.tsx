import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { useSessionStore } from '@hm/ui';
import type { SessionData } from '@hm/ui';

import { App } from './App';
import { apiClient, useMeStore } from './auth/session';
import type { Me } from './auth/session';

export const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function signIn(over: Partial<SessionData> = {}) {
  apiClient.setAccessToken('test-token', 'csrf');
  useSessionStore.setState({
    status: 'authenticated',
    user: { name: 'Demo User', email: 'demo@example.com' },
    features: ['*'],
    permissions: ['*'],
    mustChangePassword: false,
    legalBlocked: false,
    impersonation: null,
    ...over,
  });
}

export function signOut() {
  apiClient.setAccessToken(null, null);
  useMeStore.setState({ me: null });
  useSessionStore.setState({
    status: 'anonymous',
    user: null,
    features: [],
    permissions: [],
    mustChangePassword: false,
    legalBlocked: false,
    impersonation: null,
  });
}

export const ME: Me = {
  user: {
    id: 'u1',
    email: 'demo@example.com',
    name: 'Demo User',
    phone: null,
    status: 'ACTIVE',
    mfaEnabled: false,
    mustChangePassword: false,
    lastLoginAt: null,
  },
  tenant: { id: 't1', slug: 'demo', name: 'Hôtel Démo' },
  properties: [{ id: 'p1', name: 'Hôtel Démo Lomé' }],
  permissions: ['*'],
  allProperties: true,
  permVer: 1,
  subscription: { status: 'ACTIVE' },
  entitlements: { planCode: 'PRO', features: ['*'], quotas: {} },
  session: { id: 's1', idleMinutes: 30, mfa: false },
  impersonation: null,
  legal: { blocked: false, canAccept: true, pending: [] },
};

/** Stubs `fetch` with a route table (`"METHOD /path-suffix"` → response factory). */
export function stubApi(routes: Record<string, (body: unknown) => Response>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      const key = Object.keys(routes).find((k) => {
        const [m, suffix] = k.split(' ') as [string, string];
        return m === method && url.split('?')[0]!.endsWith(suffix);
      });
      return key ? routes[key]!(body) : json(404, { title: 'Not found', code: 'NOT_FOUND' });
    }),
  );
  return calls;
}

export function renderApp(path = '/dashboard') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export function renderWithQuery(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
