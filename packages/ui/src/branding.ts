export interface Branding {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  name: string;
}

/** Neutral placeholder branding, overridden per tenant once the API provides it. */
export const defaultBranding: Branding = {
  primaryColor: '#7a5a14',
  secondaryColor: '#1f2a37',
  logoUrl: null,
  name: 'Hotel Management',
};

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  let h = m[1];
  if (h.length === 3) {
    h = h
      .split('')
      .map((x) => x + x)
      .join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2.1 contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Returns black or white, whichever reads best on the given background. */
export function readableTextColor(background: string): '#000000' | '#ffffff' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
    ? '#ffffff'
    : '#000000';
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Lightens (or darkens when `direction` is -1) `color` step by step until it reaches `minRatio`
 * against `background`; returns it unchanged when it already does or when it is not a hex color.
 */
export function ensureContrast(
  color: string,
  background: string,
  minRatio = 3,
  direction: 1 | -1 = 1,
): string {
  const rgb = parseHex(color);
  if (!rgb || contrastRatio(color, background) >= minRatio) return color;
  const target = direction === 1 ? 255 : 0;
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex(rgb.map((c) => c + (target - c) * t) as [number, number, number]);
    if (contrastRatio(mixed, background) >= minRatio) return mixed;
  }
  return toHex([target, target, target]);
}

/** Linear mix of two hex colors (`weight` = share of `b`, 0 to 1). */
export function mixColors(a: string, b: string, weight: number): string {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return a;
  return toHex(ra.map((c, i) => c + ((rb[i] ?? c) - c) * weight) as [number, number, number]);
}

export interface SidebarPalette {
  /** Sidebar background: a dark neutral tinted with ~10% of the primary color. */
  background: string;
  /** Menu and brand text (AA, 4.5:1 minimum on `background`). */
  text: string;
  /** Hover overlay (translucent). */
  hover: string;
  /** Selected item pill: the primary color, kept visible on the background. */
  selectedBg: string;
  selectedText: string;
  /** Secondary color, only used as a small accent (active indicator). */
  accent: string;
}

/**
 * Sidebar colors derived from the tenant branding. The background is never the secondary color:
 * it is a dark neutral mixed with a little primary, whatever the tenant palette.
 */
export function sidebarPalette(branding: Branding, mode: 'light' | 'dark'): SidebarPalette {
  const base = mode === 'dark' ? '#0d0f12' : '#111827';
  const background = mixColors(base, branding.primaryColor, mode === 'dark' ? 0.08 : 0.1);
  const text = ensureContrast('#e5e7eb', background, 4.5, 1);
  const selectedBg = ensureContrast(branding.primaryColor, background, 3, 1);
  return {
    background,
    text,
    hover: 'rgba(255, 255, 255, 0.08)',
    selectedBg,
    selectedText: readableTextColor(selectedBg),
    accent: ensureContrast(branding.secondaryColor, background, 3, 1),
  };
}
