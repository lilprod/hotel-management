import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiErrorKeys, createApiClient } from './api';
import { evaluateGuard, hasPermission } from './nav';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

interface Call {
  url: string;
  init: RequestInit;
}
let calls: Call[];

function stubFetch(handler: (c: Call, n: number) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, init };
      calls.push(call);
      return handler(call, calls.length);
    }),
  );
}
const bearer = (c: Call) => (c.init.headers as Record<string, string>)['Authorization'];

beforeEach(() => {
  document.cookie = 'hm_csrf=; Max-Age=0; path=/';
});
afterEach(() => vi.unstubAllGlobals());

describe('createApiClient', () => {
  it('reports every failed request to onError with its method and code', async () => {
    stubFetch(() => json(402, { title: 'Suspended', code: 'SUBSCRIPTION_SUSPENDED' }));
    const onError = vi.fn();
    const api = createApiClient({ baseUrl: '/api/v1/t', onError });
    await expect(api.post('/guests', {})).rejects.toBeInstanceOf(ApiError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({
      status: 402,
      code: 'SUBSCRIPTION_SUSPENDED',
    });
    expect(onError.mock.calls[0]![1]).toEqual({ method: 'POST', path: '/guests' });
  });

  it('sends the in-memory bearer token and never touches storage', async () => {
    stubFetch(() => json(200, { ok: true }));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const api = createApiClient({ baseUrl: '/api/v1/t' });
    api.setAccessToken('tok-1');
    await api.get('/auth/me');
    expect(calls[0]?.url).toBe('/api/v1/t/auth/me');
    expect(bearer(calls[0]!)).toBe('Bearer tok-1');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('refreshes once on 401 with X-CSRF-Token then replays the request', async () => {
    stubFetch((c) => {
      if (c.url.endsWith('/auth/refresh'))
        return json(200, { accessToken: 'tok-2', csrfToken: 'csrf-2' });
      return bearer(c) === 'Bearer tok-2'
        ? json(200, { n: 1 })
        : json(401, { code: 'UNAUTHENTICATED' });
    });
    const api = createApiClient({ baseUrl: '/api/v1/t' });
    api.setAccessToken('expired', 'csrf-1');
    await expect(api.get('/iam/users')).resolves.toEqual({ n: 1 });
    const refresh = calls.find((c) => c.url.endsWith('/auth/refresh'))!;
    expect((refresh.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1');
    expect(api.getAccessToken()).toBe('tok-2');
    expect(calls).toHaveLength(3);
  });

  it('reads the CSRF value from the hm_csrf cookie when none is known', async () => {
    document.cookie = 'hm_csrf=from-cookie; path=/';
    stubFetch(() => json(200, { accessToken: 'a' }));
    const api = createApiClient({ baseUrl: '/api/v1/t' });
    await api.refresh();
    expect((calls[0]!.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('from-cookie');
  });

  it('single-flights concurrent refreshes', async () => {
    let release: (r: Response) => void = () => undefined;
    stubFetch((c) => {
      if (c.url.endsWith('/auth/refresh'))
        return new Promise<Response>((res) => {
          release = res;
        });
      return bearer(c) === 'Bearer fresh' ? json(200, { ok: 1 }) : json(401, {});
    });
    const api = createApiClient({ baseUrl: '/api/v1/t' });
    api.setAccessToken('old');
    const all = Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1),
    );
    release(json(200, { accessToken: 'fresh' }));
    await all;
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(calls).toHaveLength(7); // 3 first attempts + 1 refresh + 3 replays
  });

  it('logs out (onAuthFailure) when the refresh fails', async () => {
    stubFetch((c) =>
      c.url.endsWith('/auth/refresh') ? json(401, { code: 'UNAUTHENTICATED' }) : json(401, {}),
    );
    const onAuthFailure = vi.fn();
    const api = createApiClient({ baseUrl: '/api/v1/t', onAuthFailure });
    api.setAccessToken('old');
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(api.getAccessToken()).toBeNull();
  });

  it('does not refresh nor send the bearer on public calls (skipAuth)', async () => {
    stubFetch(() => json(401, { code: 'UNAUTHENTICATED', title: 'Bad credentials' }));
    const api = createApiClient({ baseUrl: '/api/v1/t' });
    api.setAccessToken('tok');
    await expect(api.post('/auth/login', {}, { skipAuth: true })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(calls).toHaveLength(1);
    expect(bearer(calls[0]!)).toBeUndefined();
  });

  it('parses RFC 7807 problems (code, meta.reason, field errors)', async () => {
    stubFetch(() =>
      json(403, {
        title: 'Legal acceptance required',
        detail: 'Accept the terms',
        code: 'FORBIDDEN',
        meta: { reason: 'LEGAL_ACCEPTANCE_REQUIRED' },
        errors: [{ path: 'email', message: 'bad' }],
        requestId: 'r1',
      }),
    );
    const err = await createApiClient({ baseUrl: '/x' })
      .get('/y')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect([e.status, e.code, e.reason, e.message, e.requestId]).toEqual([
      403,
      'FORBIDDEN',
      'LEGAL_ACCEPTANCE_REQUIRED',
      'Accept the terms',
      'r1',
    ]);
    expect(e.errors).toEqual([{ path: 'email', message: 'bad' }]);
    expect(apiErrorKeys(e)[0]).toBe('errors:reason.LEGAL_ACCEPTANCE_REQUIRED');
    expect(apiErrorKeys(new TypeError('x'))[0]).toBe('errors:network');
  });

  it('returns undefined on 204 and extracts the download file name', async () => {
    stubFetch((c) =>
      c.url.endsWith('/export')
        ? new Response('a,b', {
            headers: { 'Content-Disposition': 'attachment; filename="audit.csv"' },
          })
        : json(204, null),
    );
    const api = createApiClient({ baseUrl: '/api/v1/t' });
    await expect(api.delete('/z')).resolves.toBeUndefined();
    const d = await api.download('/export');
    expect(d.filename).toBe('audit.csv');
  });
});

describe('guards', () => {
  const base = {
    status: 'authenticated' as const,
    user: { name: 'A' },
    features: ['spa'],
    permissions: ['guests.*'],
    mustChangePassword: false,
    legalBlocked: false,
    impersonation: null,
  };
  it('covers wildcards like the server', () => {
    expect(hasPermission(['guests.*'], 'guests.read')).toBe(true);
    expect(hasPermission(['hr.*'], 'hr.timeclock.edit')).toBe(true);
    expect(hasPermission(['guests.read'], 'guests.create')).toBe(false);
  });
  it('orders loading, login, password change, legal, then entitlements', () => {
    expect(evaluateGuard({ ...base, status: 'unknown' })).toEqual({ type: 'loading' });
    expect(evaluateGuard({ ...base, status: 'anonymous' })).toEqual({
      type: 'redirect',
      to: '/login',
    });
    expect(evaluateGuard({ ...base, mustChangePassword: true, legalBlocked: true })).toEqual({
      type: 'redirect',
      to: '/change-password',
    });
    expect(evaluateGuard({ ...base, legalBlocked: true })).toEqual({
      type: 'redirect',
      to: '/legal',
    });
    expect(evaluateGuard({ ...base, legalBlocked: true }, { allowWhilePending: true })).toEqual({
      type: 'ok',
    });
    expect(evaluateGuard(base, { permission: 'guests.read' })).toEqual({ type: 'ok' });
    expect(evaluateGuard(base, { permission: 'users.read' })).toEqual({ type: 'forbidden' });
    expect(evaluateGuard(base, { feature: 'billing.core' })).toEqual({ type: 'forbidden' });
  });
});
