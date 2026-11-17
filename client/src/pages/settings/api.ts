import { ApiError } from '@hm/ui';

import { apiClient } from '../../auth/session';

/**
 * Staff API (`/api/v1/t`) through the shared client: in-memory bearer token, single-flight
 * refresh on 401, RFC 7807 errors. Kept as `api(method, path, body)` for the settings pages.
 */
export { ApiError };

export function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  return apiClient.request<T>(method, path, body);
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
