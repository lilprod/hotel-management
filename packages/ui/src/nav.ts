import { create } from 'zustand';

/** Minimal shape of a navigation module (apps extend it with an icon). */
export interface NavModule {
  key: string;
  /** i18next key, namespaced (e.g. `nav:dashboard`). */
  labelKey: string;
  path: string;
  /** Feature code that must be enabled for the tenant/plan. */
  requiredFeature?: string;
  /** Permission code that the user must hold. */
  requiredPermission?: string;
}

export interface Entitlements {
  features: readonly string[];
  permissions: readonly string[];
}

const hasAll = (granted: readonly string[], code: string) =>
  granted.includes('*') || granted.includes(code);

export function canAccess(module: NavModule, e: Entitlements): boolean {
  if (module.requiredFeature && !hasAll(e.features, module.requiredFeature)) return false;
  if (module.requiredPermission && !hasAll(e.permissions, module.requiredPermission)) return false;
  return true;
}

/** Keeps the modules the current session is entitled to; `*` grants everything. */
export function filterModules<T extends NavModule>(modules: readonly T[], e: Entitlements): T[] {
  return modules.filter((m) => canAccess(m, e));
}

export interface SessionUser {
  name: string;
  email?: string;
}

export interface SessionState extends Entitlements {
  user: SessionUser | null;
  setSession: (s: { user: SessionUser | null; features: string[]; permissions: string[] }) => void;
}

/**
 * Placeholder session until the authentication lot: grants everything to a demo user.
 * Real values will come from the API (never from the client side).
 */
export const useSessionStore = create<SessionState>()((set) => ({
  user: { name: 'Demo User' },
  features: ['*'],
  permissions: ['*'],
  setSession: (s) => set(s),
}));
