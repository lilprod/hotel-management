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
