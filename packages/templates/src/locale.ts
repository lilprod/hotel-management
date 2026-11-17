/** Locales shipped with the default templates (UI and documents: FR + EN). */
export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

/** `fr-TG` -> `fr`; unsupported or empty -> undefined. */
export function baseLocale(input: string | undefined | null): Locale | undefined {
  const base = input?.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.find((l) => l === base);
}

/**
 * Ordered lookup chain: requested locale, then the tenant default, then the platform default
 * (no duplicates). Used for templates, so an unsupported locale falls back to French.
 */
export function localeChain(requested?: string | null, tenantDefault?: string | null): Locale[] {
  const out: Locale[] = [];
  for (const l of [baseLocale(requested), baseLocale(tenantDefault), DEFAULT_LOCALE])
    if (l && !out.includes(l)) out.push(l);
  return out;
}
