import { readableTextColor } from '@hm/ui/core';
import type { Branding } from '@hm/ui/core';

import { tenantBranding } from './defaults';

/** Shape of `GET /api/v1/portal/branding` (public, tenant resolved from the Host header). */
export interface PublicBranding {
  name: string;
  colors: { primary: string; secondary: string; onPrimary: string };
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  loginBackgroundUrl: string | null;
  loginMessage: string | null;
  languages: string[];
  defaultLocale: string;
  contact: {
    phone: string | null;
    email: string | null;
    address: string | null;
    website: string | null;
  };
}

/** Resolved theme the portal applies: the `Branding` base plus the portal-only fields. */
export interface PortalBranding extends Branding {
  onPrimaryColor: string;
  faviconUrl: string | null;
  loginMessage: string | null;
  languages: string[];
  contact: PublicBranding['contact'] | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export const defaultPortalBranding: PortalBranding = {
  ...tenantBranding,
  onPrimaryColor: readableTextColor(tenantBranding.primaryColor),
  faviconUrl: null,
  loginMessage: null,
  languages: ['fr', 'en'],
  contact: null,
};

export async function fetchPublicBranding(signal?: AbortSignal): Promise<PublicBranding> {
  const res = await fetch('/api/v1/portal/branding', {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`Branding request failed (${res.status})`);
  return (await res.json()) as PublicBranding;
}

/** Maps the API payload to the portal theme; invalid colors fall back to the default theme. */
export function toPortalBranding(p: PublicBranding): PortalBranding {
  const primary = HEX.test(p.colors.primary) ? p.colors.primary : tenantBranding.primaryColor;
  const secondary = HEX.test(p.colors.secondary)
    ? p.colors.secondary
    : tenantBranding.secondaryColor;
  return {
    name: p.name || tenantBranding.name,
    primaryColor: primary,
    secondaryColor: secondary,
    onPrimaryColor: readableTextColor(primary),
    logoUrl: p.logoUrl,
    faviconUrl: p.faviconUrl,
    loginMessage: p.loginMessage,
    languages: p.languages.length ? p.languages : defaultPortalBranding.languages,
    contact: p.contact,
  };
}
