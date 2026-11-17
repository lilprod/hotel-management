import { safeColor, safeImageSrc } from './escape.js';

/** Tenant (or platform) branding injected in e-mail layouts and PDF documents. */
export interface Branding {
  displayName: string;
  /** https URL or data URI. */
  logoUrl?: string | undefined;
  /** `#rrggbb`. */
  primaryColor: string;
  accentColor: string;
  /** Legal mentions shown in the e-mail footer (one line each). */
  footerLegal: string[];
}

export const DEFAULT_BRANDING: Branding = {
  displayName: 'Hotel Management',
  primaryColor: '#1f4e79',
  accentColor: '#c8963e',
  footerLegal: [],
};

/** Fills the gaps and drops unsafe values (bad colors, non-https logos). */
export function normalizeBranding(input: Partial<Branding> = {}): Branding {
  const logoUrl = safeImageSrc(input.logoUrl);
  return {
    displayName: input.displayName?.trim() || DEFAULT_BRANDING.displayName,
    ...(logoUrl ? { logoUrl } : {}),
    primaryColor: safeColor(input.primaryColor, DEFAULT_BRANDING.primaryColor),
    accentColor: safeColor(input.accentColor, DEFAULT_BRANDING.accentColor),
    footerLegal: (input.footerLegal ?? [])
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 10),
  };
}
