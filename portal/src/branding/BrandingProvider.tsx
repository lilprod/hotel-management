import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import { defaultPortalBranding, fetchPublicBranding, toPortalBranding } from './api';
import type { PortalBranding } from './api';

const BrandingContext = createContext<PortalBranding>(defaultPortalBranding);

/** Current tenant branding (default theme until the public branding has loaded). */
export function useTenantBranding(): PortalBranding {
  return useContext(BrandingContext);
}

/** Writes the theme to CSS variables on <html>, and the favicon link when the tenant has one. */
export function applyBranding(b: PortalBranding): void {
  const root = document.documentElement;
  root.style.setProperty('--hm-primary', b.primaryColor);
  root.style.setProperty('--hm-on-primary', b.onPrimaryColor);
  root.style.setProperty('--hm-secondary', b.secondaryColor);
  if (b.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = b.faviconUrl;
  }
}

/** Fetches the public branding at boot (tenant resolved by the server from the Host). */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['portal-branding'],
    queryFn: ({ signal }) => fetchPublicBranding(signal),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const branding = useMemo(
    () => (query.data ? toPortalBranding(query.data) : defaultPortalBranding),
    [query.data],
  );
  useEffect(() => applyBranding(branding), [branding]);
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
