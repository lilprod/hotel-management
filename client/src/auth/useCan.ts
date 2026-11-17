import { hasFeature, hasPermission, useSessionStore } from '@hm/ui';

/** UI-side permission check (the API enforces the same rules: hiding is never the only control). */
export function useCan() {
  const permissions = useSessionStore((s) => s.permissions);
  const features = useSessionStore((s) => s.features);
  return {
    can: (code: string) => hasPermission(permissions, code),
    has: (feature: string) => hasFeature(features, feature),
  };
}
