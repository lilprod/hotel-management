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

/** `*` covers everything, `a.*` covers `a` and `a.<anything>` (same rules as the server). */
function covers(granted: string, required: string): boolean {
  if (granted === '*' || granted === required) return true;
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -2);
    return required === prefix || required.startsWith(`${prefix}.`);
  }
  return false;
}

export function hasPermission(granted: readonly string[], code: string): boolean {
  return granted.some((g) => covers(g, code));
}

export function hasFeature(granted: readonly string[], code: string): boolean {
  return granted.includes('*') || granted.includes(code);
}

export function canAccess(module: NavModule, e: Entitlements): boolean {
  if (module.requiredFeature && !hasFeature(e.features, module.requiredFeature)) return false;
  if (module.requiredPermission && !hasPermission(e.permissions, module.requiredPermission))
    return false;
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

/** Support ("act as") session carried by the staff token. */
export interface ImpersonationInfo {
  /** Platform user id (`impersonated_by`). */
  by: string;
  byName?: string;
  reason?: string;
  /** ISO date; falls back to the token expiry when unknown. */
  expiresAt?: string;
}

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface SessionData extends Entitlements {
  status: SessionStatus;
  user: SessionUser | null;
  mustChangePassword: boolean;
  /** Latest legal documents pending acceptance (blocks the whole staff API). */
  legalBlocked: boolean;
  impersonation: ImpersonationInfo | null;
}

export interface SessionState extends SessionData {
  setSession: (s: Partial<SessionData>) => void;
  clearSession: () => void;
}

const anonymous: SessionData = {
  status: 'unknown',
  user: null,
  features: [],
  permissions: [],
  mustChangePassword: false,
  legalBlocked: false,
  impersonation: null,
};

/**
 * Session of the current app, fed by the API (`/auth/me`) — never granted client side.
 * `status` is `unknown` until the first bootstrap (refresh + me) completes.
 */
export const useSessionStore = create<SessionState>()((set) => ({
  ...anonymous,
  setSession: (s) => set(s),
  clearSession: () => set({ ...anonymous, status: 'anonymous' }),
}));

export interface GuardOptions {
  permission?: string | undefined;
  feature?: string | undefined;
  /** Pages reachable while a password change / legal acceptance is pending. */
  allowWhilePending?: boolean;
}

export type GuardResult =
  { type: 'loading' } | { type: 'redirect'; to: string } | { type: 'forbidden' } | { type: 'ok' };

/** Pure guard logic shared by the router components of the staff and admin apps. */
export function evaluateGuard(s: SessionData, o: GuardOptions = {}): GuardResult {
  if (s.status === 'unknown') return { type: 'loading' };
  if (s.status === 'anonymous') return { type: 'redirect', to: '/login' };
  if (!o.allowWhilePending) {
    if (s.mustChangePassword) return { type: 'redirect', to: '/change-password' };
    if (s.legalBlocked) return { type: 'redirect', to: '/legal' };
  }
  if (o.feature && !hasFeature(s.features, o.feature)) return { type: 'forbidden' };
  if (o.permission && !hasPermission(s.permissions, o.permission)) return { type: 'forbidden' };
  return { type: 'ok' };
}
