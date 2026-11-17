/** Minimal staff API client (`/api/v1/t`); errors follow RFC 7807. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/t${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const p = data as {
      detail?: string;
      title?: string;
      errors?: { path: string; message: string }[];
    };
    throw new ApiError(res.status, p.detail ?? p.title ?? res.statusText, p.errors);
  }
  return data as T;
}

export interface Property {
  id: string;
  name: string;
  currency: string;
  country: string;
}
export interface RoomType {
  id: string;
  code: string;
  name: string;
}
export interface Items<T> {
  items: T[];
}
