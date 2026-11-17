import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { HmThemeProvider, defaultBranding, useUiStore } from '@hm/ui';
import type { Branding } from '@hm/ui';

import { api, type Items, type Property } from '../pages/settings/api';

const HEX = /^#[0-9a-f]{6}$/i;

interface StaffBranding {
  primaryColor: string | null;
  secondaryColor: string | null;
  assets?: Partial<Record<string, { url: string } | null>>;
}

/**
 * Tenant branding for the staff app: GET /api/v1/t/branding (colors, logo) plus the first
 * property name as hotel name. Any error (401 before login, network) falls back to the default theme.
 */
export function useTenantBranding(): Branding {
  const mode = useUiStore((s) => s.mode);
  const branding = useQuery({
    queryKey: ['tenant-branding'],
    queryFn: () => api<StaffBranding>('GET', '/branding'),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const properties = useQuery({
    queryKey: ['properties'],
    queryFn: () => api<Items<Property>>('GET', '/lodging/properties'),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const data = branding.data;
  const name = properties.data?.items[0]?.name;
  return useMemo<Branding>(() => {
    if (!data) return { ...defaultBranding, ...(name ? { name } : {}) };
    const logo = (mode === 'dark' ? data.assets?.['logo-dark'] : null) ?? data.assets?.['logo'];
    return {
      primaryColor:
        data.primaryColor && HEX.test(data.primaryColor)
          ? data.primaryColor
          : defaultBranding.primaryColor,
      secondaryColor:
        data.secondaryColor && HEX.test(data.secondaryColor)
          ? data.secondaryColor
          : defaultBranding.secondaryColor,
      logoUrl: logo?.url ?? null,
      name: name ?? defaultBranding.name,
    };
  }, [data, name, mode]);
}

export function TenantThemeProvider({ children }: { children: ReactNode }) {
  const branding = useTenantBranding();
  return <HmThemeProvider branding={branding}>{children}</HmThemeProvider>;
}
