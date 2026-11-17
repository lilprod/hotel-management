import { resolveTxt } from 'node:dns/promises';
import type { Services } from '../../core/container.js';
import { TenantStorage, type PutObjectInput } from '../../lib/storage.js';

/** The slice of TenantStorage used by the module (a fake is injected in tests). */
export interface BrandingStorage {
  put(input: PutObjectInput): Promise<{ key: string; size: number }>;
  signedUrl(key: string, expiresIn?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

/** TXT lookup used to verify the ownership of a custom domain (injectable for tests). */
export interface DnsTxtResolver {
  /** One string per TXT record (chunks joined). Resolves to [] when the name has no TXT. */
  resolveTxt(hostname: string): Promise<string[]>;
}

export interface BrandingDeps {
  storage: BrandingStorage;
  dns: DnsTxtResolver;
}

export const nodeDnsResolver: DnsTxtResolver = {
  async resolveTxt(hostname) {
    try {
      return (await resolveTxt(hostname)).map((chunks) => chunks.join(''));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
      throw err;
    }
  },
};

let overrides: Partial<BrandingDeps> = {};
const storages = new WeakMap<Services, TenantStorage>();

/** Test hook: replaces the storage and/or DNS resolver. Call with `{}` to reset. */
export function overrideBrandingDeps(next: Partial<BrandingDeps>): void {
  overrides = next;
}

export function brandingDeps(services: Services): BrandingDeps {
  let storage = overrides.storage;
  if (!storage) {
    let s = storages.get(services);
    if (!s) {
      s = TenantStorage.fromConfig(services.config);
      storages.set(services, s);
    }
    storage = s;
  }
  return { storage, dns: overrides.dns ?? nodeDnsResolver };
}
