/**
 * Fetch wrapper shared by the three apps (antd-free).
 * - the access token lives in memory only (never in storage);
 * - a 401 triggers ONE shared refresh (cookie + `X-CSRF-Token`), then the request is replayed;
 * - when the refresh fails the session is considered over (`onAuthFailure`);
 * - errors follow RFC 7807 and are exposed as `ApiError` (code, meta.reason, field errors).
 */

export interface FieldIssue {
  path: string;
  message: string;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | undefined = undefined,
    readonly reason: string | undefined = undefined,
    readonly errors: FieldIssue[] = [],
    readonly meta: Record<string, unknown> | undefined = undefined,
    readonly requestId: string | undefined = undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  /** Public endpoint (login, reset…): no bearer and no refresh-and-retry on 401. */
  skipAuth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface TokenResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  csrfToken?: string;
  mustChangePassword?: boolean;
}

export interface ApiClientOptions {
  /** Surface prefix, e.g. `/api/v1/t`. */
  baseUrl: string;
  /** Refresh endpoint relative to `baseUrl`. */
  refreshPath?: string;
  /** Called when a 401 could not be recovered by a refresh. */
  onAuthFailure?: () => void;
  /** Called after each successful refresh (token rotation). */
  onRefreshed?: (r: TokenResponse) => void;
}

export interface ApiClient {
  request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T>;
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  /** Authenticated download (CSV export…): returns the blob and the suggested file name. */
  download(path: string, opts?: RequestOptions): Promise<{ blob: Blob; filename: string }>;
  /** Single-flight refresh; resolves with the new token or null (no session). */
  refresh(): Promise<TokenResponse | null>;
  setAccessToken(token: string | null, csrfToken?: string | null): void;
  getAccessToken(): string | null;
}

const CSRF_COOKIE = 'hm_csrf';

function readCsrfCookie(): string | null {
  try {
    const m = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`).exec(document.cookie);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

interface ProblemBody {
  title?: string;
  detail?: string;
  code?: string;
  errors?: FieldIssue[];
  meta?: Record<string, unknown>;
  requestId?: string;
}

async function toApiError(res: Response): Promise<ApiError> {
  const p = ((await res.json().catch(() => ({}))) ?? {}) as ProblemBody;
  const reason = typeof p.meta?.['reason'] === 'string' ? p.meta['reason'] : undefined;
  return new ApiError(
    res.status,
    p.detail ?? p.title ?? res.statusText,
    p.code,
    reason,
    Array.isArray(p.errors) ? p.errors : [],
    p.meta,
    p.requestId,
  );
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const refreshPath = options.refreshPath ?? '/auth/refresh';
  let accessToken: string | null = null;
  let csrf: string | null = null;
  let inflight: Promise<TokenResponse | null> | null = null;

  const setAccessToken: ApiClient['setAccessToken'] = (token, csrfToken) => {
    accessToken = token;
    if (csrfToken !== undefined) csrf = csrfToken;
  };

  function refresh(): Promise<TokenResponse | null> {
    inflight ??= (async () => {
      try {
        const token = csrf ?? readCsrfCookie();
        const res = await fetch(`${options.baseUrl}${refreshPath}`, {
          method: 'POST',
          credentials: 'include',
          headers: token ? { 'X-CSRF-Token': token } : {},
        });
        if (!res.ok) {
          accessToken = null;
          return null;
        }
        const data = (await res.json()) as TokenResponse;
        accessToken = data.accessToken;
        if (data.csrfToken) csrf = data.csrfToken;
        options.onRefreshed?.(data);
        return data;
      } catch {
        accessToken = null;
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function send(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (!opts.skipAuth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
    return fetch(`${options.baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(body === undefined ? {} : { body: isForm ? (body as FormData) : JSON.stringify(body) }),
    });
  }

  async function exchange(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions,
  ): Promise<Response> {
    let res = await send(method, path, body, opts);
    if (res.status === 401 && !opts.skipAuth) {
      const renewed = await refresh();
      if (!renewed) {
        options.onAuthFailure?.();
        throw await toApiError(res);
      }
      res = await send(method, path, body, opts);
    }
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    const res = await exchange(method, path, body, opts);
    if (res.status === 204) return undefined as T;
    return (await res.json().catch(() => undefined)) as T;
  }

  return {
    request,
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    put: (path, body, opts) => request('PUT', path, body, opts),
    patch: (path, body, opts) => request('PATCH', path, body, opts),
    delete: (path, opts) => request('DELETE', path, undefined, opts),
    async download(path, opts = {}) {
      const res = await exchange('GET', path, undefined, opts);
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'export.csv';
      return { blob: await res.blob(), filename };
    },
    refresh,
    setAccessToken,
    getAccessToken: () => accessToken,
  };
}

/** Saves a blob through a temporary anchor (CSV export, backup codes). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** i18n keys (namespace `errors`) to try, most specific first, for `t([...keys])`. */
export function apiErrorKeys(err: unknown): string[] {
  if (err instanceof ApiError) {
    return [
      ...(err.reason ? [`errors:reason.${err.reason}`] : []),
      ...(err.code ? [`errors:code.${err.code}`] : []),
      `errors:status.${err.status}`,
      'errors:generic',
    ];
  }
  return ['errors:network', 'errors:generic'];
}
