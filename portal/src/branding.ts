import type { Branding } from '@hm/ui/core';

/**
 * Placeholder tenant branding. The portal will load the real branding from the API
 * (resolved from the request host, never from client input).
 * Colors are chosen to keep WCAG 2.1 AA contrast (checked in tests).
 */
export const tenantBranding: Branding = {
  name: 'Hôtel Exemple',
  primaryColor: '#7a5a14',
  secondaryColor: '#1f2a37',
  logoUrl: null,
};
