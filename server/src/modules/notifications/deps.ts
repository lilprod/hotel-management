import type { Services } from '../../core/container.js';
import { createProviders, type ProviderRegistry } from '../../lib/providers/index.js';
import { TenantStorage, type PutObjectInput } from '../../lib/storage.js';

export interface NotificationStorage {
  put(input: PutObjectInput): Promise<{ key: string; size: number }>;
  signedUrl(key: string, expiresIn?: number): Promise<string>;
}

export interface NotificationDeps {
  providers: ProviderRegistry;
  storage: NotificationStorage;
  fetch: typeof fetch;
}

let overrides: Partial<NotificationDeps> = {};
const providers = new WeakMap<Services, ProviderRegistry>();
const storages = new WeakMap<Services, NotificationStorage>();

/** Test hook: injects fake providers / storage / fetch. Call with `{}` to reset. */
export function overrideNotificationDeps(next: Partial<NotificationDeps>): void {
  overrides = next;
}

export function notificationDeps(services: Services): NotificationDeps {
  let p = overrides.providers ?? providers.get(services);
  if (!p) {
    p = createProviders(services.config, services.logger);
    providers.set(services, p);
  }
  let s = overrides.storage ?? storages.get(services);
  if (!s) {
    s = TenantStorage.fromConfig(services.config);
    storages.set(services, s);
  }
  return { providers: p, storage: s, fetch: overrides.fetch ?? fetch };
}
