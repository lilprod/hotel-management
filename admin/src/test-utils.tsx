import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { useSessionStore } from '@hm/ui';

import { App } from './App';
import { apiClient, applyMe, useMeStore } from './auth/session';
import type { PlatformMe, PlatformRole } from './auth/session';

export const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const meOf = (role: PlatformRole): PlatformMe => ({
  id: 'pu-1',
  email: 'root@example.com',
  name: 'Root Admin',
  role,
  mfaEnabled: true,
  lastLoginAt: null,
});

export function signInAs(role: PlatformRole) {
  apiClient.setAccessToken('test-token', 'csrf');
  applyMe(meOf(role));
}

export function signOut() {
  apiClient.setAccessToken(null, null);
  useMeStore.setState({ me: null });
  useSessionStore.getState().clearSession();
}

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
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
