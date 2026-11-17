import type { Branding } from '@hm/ui/core';

/**
 * Fallback theme used while the tenant branding loads or when the API is unreachable.
 * Colors keep WCAG 2.1 AA contrast (checked in tests).
 */
export const tenantBranding: Branding = {
  name: 'Hôtel Exemple',
  primaryColor: '#7a5a14',
  secondaryColor: '#1f2a37',
  logoUrl: null,
};
